/**
 * Monkey-patches `node:child_process.spawn` inside the openclaw gateway
 * process so any `python -m ai_dev_browser.tools.*` child has its full stdout
 * teed to the sudowork sidechannel. Sudowork then rewrites the UI event
 * content on the sudowork side so the real JSON + PNG metadata reaches the
 * UI — openclaw's short `meta` description is replaced, not amended.
 *
 * No openclaw bundle modification: we only observe child_process.spawn.
 * Openclaw's own stdout reader still sees every byte unchanged.
 */

import * as childProcessNs from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';

// In ESM contexts (including vitest) the `node:child_process` namespace is
// frozen — we can't reassign `childProcess.spawn`. The CJS module exports
// object, though, is writable in every Node runtime, including vitest. Use
// `createRequire` to reach it so the monkey-patch is consistent across
// production (esbuild output loaded via `-r`) and tests.
const childProcess: typeof childProcessNs = (() => {
  try {
    const req = createRequire(import.meta.url);
    return req('child_process') as typeof childProcessNs;
  } catch {
    return childProcessNs;
  }
})();

const PYTHON_COMMAND_RE = /(?:^|[\\/])(python|python3)(?:\.exe)?$/i;
const ADB_MODULE_RE = /^ai_dev_browser\.tools\./;
// Path form of the same tool — any argv that looks like
// `.../ai_dev_browser/tools/<name>.py` (Windows or POSIX separators).
const ADB_PY_PATH_RE = /(?:^|[\\/])ai_dev_browser[\\/]tools[\\/]([\w_]+)\.py$/i;
// Either form embedded in a shell script. Matches the larger pattern of
// `python ... -m ai_dev_browser.tools.<name>` OR `python ... ai_dev_browser/tools/<name>.py`
// anywhere in the script, used when openclaw wraps the call through
// cmd.exe / bash / sh / pwsh and spawns the shell rather than python
// directly.
const ADB_IN_SHELL_RE = /(?:^|[;\s&|"'])python(?:3|\.exe|3\.exe)?\s+(?:[^;\s&|]*\s+)*?(?:-m\s+ai_dev_browser\.tools\.\w+|[^\s;&|]*ai_dev_browser[\\/]tools[\\/]\w+\.py)/i;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

interface CapturedState {
  callId: string;
  cmdHash: string;
  cmd: string;
  argv: string[];
  pid: number | null;
  ppid: number;
  startedAt: number;
  chunks: Buffer[];
  bytes: number;
  truncated: boolean;
}

interface CaptureOptions {
  sidechannelUrl: string;
  sidechannelSecret: string;
  maxBytes?: number;
}

export class AdbStdoutCapture {
  private readonly url: URL;
  private readonly secret: string;
  private readonly maxBytes: number;
  private readonly byPid = new Map<number, CapturedState>();
  private originalSpawn: typeof childProcess.spawn | null = null;
  private originalProtoSpawn: ((opts: Record<string, unknown>) => unknown) | null = null;
  private applied = false;

  constructor(opts: CaptureOptions) {
    this.url = new URL(opts.sidechannelUrl);
    this.secret = opts.sidechannelSecret;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  apply(): void {
    if (this.applied) return;
    this.applied = true;
    this.originalSpawn = childProcess.spawn;
    // Replace `spawn` on the CJS module.exports object. Covers any CJS
    // `const {spawn} = require('child_process')` consumer, and also works
    // through `createRequire` paths.
    try {
      (childProcess as { spawn: typeof childProcess.spawn }).spawn = this.makeWrappedSpawn(this.originalSpawn);
    } catch {
      /* fall back to prototype patch below */
    }

    // Patch `ChildProcess.prototype.spawn` — the internal instance method
    // that Node's public `spawn()` always delegates to. This catches
    // consumers who captured the module-level `spawn` binding through
    // ESM static imports (e.g. `import { spawn } from 'node:child_process'`),
    // since those calls still route through the prototype method at
    // runtime. This is how we intercept openclaw's `runExecProcess` without
    // needing to break its ESM binding.
    const cp = childProcess as unknown as { ChildProcess?: { prototype: { spawn: (opts: Record<string, unknown>) => unknown } } };
    const proto = cp.ChildProcess?.prototype;
    if (proto && typeof proto.spawn === 'function') {
      const originalProtoSpawn = proto.spawn;
      this.originalProtoSpawn = originalProtoSpawn;
      const self = this;
      proto.spawn = function patchedProtoSpawn(this: Record<string, unknown> & { pid?: number }, options: Record<string, unknown>) {
        let detect: { hashInput: string } | null = null;
        let callId: string | null = null;
        try {
          const fileRaw = options?.file;
          const argsRaw = options?.args;
          const command = typeof fileRaw === 'string' ? fileRaw : '';
          const argv = Array.isArray(argsRaw) ? argsRaw.map((a) => String(a)) : [];
          detect = self.matchAdbInvocation(command, argv);
          if (detect) {
            callId = randomBytes(16).toString('hex');
            // Inject AI_DEV_BROWSER_CALL_ID into the spawn envPairs array.
            // envPairs format: array of "KEY=VALUE" strings.
            const envPairs = options.envPairs;
            if (Array.isArray(envPairs)) {
              envPairs.push(`AI_DEV_BROWSER_CALL_ID=${callId}`);
            }
          }
        } catch { /* any error → fall through unchanged */ }

        const rc = originalProtoSpawn.call(this, options);

        if (detect && callId) {
          try {
            self.attach(this as unknown as childProcess.ChildProcess, {
              callId,
              cmd: typeof options?.file === 'string' ? String(options.file) : '',
              argv: Array.isArray(options?.args) ? (options.args as unknown[]).map((a) => String(a)) : [],
              hashInput: detect.hashInput,
            });
          } catch { /* swallow */ }
        }
        return rc;
      };
    } else {
      console.error('[AdbStdoutCapture] ChildProcess.prototype.spawn not found — falling back to module-level patch only');
    }
  }

  dispose(): void {
    if (!this.applied) return;
    if (this.originalSpawn) {
      try {
        (childProcess as { spawn: typeof childProcess.spawn }).spawn = this.originalSpawn;
      } catch {
        /* ignore */
      }
    }
    if (this.originalProtoSpawn) {
      const cp = childProcess as unknown as { ChildProcess?: { prototype: { spawn: unknown } } };
      const proto = cp.ChildProcess?.prototype;
      if (proto) proto.spawn = this.originalProtoSpawn;
      this.originalProtoSpawn = null;
    }
    this.originalSpawn = null;
    this.applied = false;
    this.byPid.clear();
  }

  private makeWrappedSpawn(originalSpawn: typeof childProcess.spawn): typeof childProcess.spawn {
    const self = this;
    return function spawnWrapper(
      this: unknown,
      command: string,
      ...rest: unknown[]
    ): ReturnType<typeof childProcess.spawn> {
      const [rawArgs, rawOptions] = self.normalizeSpawnArgs(rest);
      const detect = self.matchAdbInvocation(command, rawArgs);
      if (!detect) {
        return (originalSpawn as unknown as (...a: unknown[]) => ReturnType<typeof childProcess.spawn>).call(
          this,
          command,
          ...rest,
        );
      }
      const callId = randomBytes(16).toString('hex');
      const patched = self.injectCallId(rawOptions, callId);
      const patchedRest = self.replaceOptions(rest, patched);
      const child = (originalSpawn as unknown as (...a: unknown[]) => ReturnType<typeof childProcess.spawn>).call(
        this,
        command,
        ...patchedRest,
      );
      self.attach(child, {
        callId,
        cmd: command,
        argv: rawArgs,
        hashInput: detect.hashInput,
      });
      return child;
    } as typeof childProcess.spawn;
  }

  getCapturedByPid(pid: number): { callId: string; stdout: string } | null {
    const entry = this.byPid.get(pid);
    if (!entry) return null;
    return { callId: entry.callId, stdout: Buffer.concat(entry.chunks, entry.bytes).toString('utf8') };
  }

  // ────────────────────────────────────────────────────────────────────────

  private normalizeSpawnArgs(rest: unknown[]): [string[], Record<string, unknown> | undefined] {
    if (rest.length === 0) return [[], undefined];
    const first = rest[0];
    if (Array.isArray(first)) {
      const args = first.map((a) => String(a));
      const opts = rest.length > 1 && rest[1] && typeof rest[1] === 'object' ? (rest[1] as Record<string, unknown>) : undefined;
      return [args, opts];
    }
    if (first && typeof first === 'object') {
      return [[], first as Record<string, unknown>];
    }
    return [[], undefined];
  }

  private replaceOptions(rest: unknown[], newOpts: Record<string, unknown>): unknown[] {
    if (rest.length === 0) return [newOpts];
    if (Array.isArray(rest[0])) {
      return [rest[0], newOpts, ...rest.slice(2)];
    }
    return [newOpts, ...rest.slice(1)];
  }

  private matchAdbInvocation(command: string, args: string[]): { hashInput: string } | null {
    // Case 1a: direct python invocation — `python -m ai_dev_browser.tools.<x> ...`
    if (PYTHON_COMMAND_RE.test(command)) {
      const dashMIdx = args.indexOf('-m');
      if (dashMIdx !== -1 && dashMIdx + 1 < args.length && ADB_MODULE_RE.test(args[dashMIdx + 1] ?? '')) {
        return { hashInput: `${command} ${args.join(' ')}`.trim() };
      }
      // Case 1b: `python <path>/ai_dev_browser/tools/<name>.py ...`
      for (const arg of args) {
        if (typeof arg === 'string' && ADB_PY_PATH_RE.test(arg)) {
          return { hashInput: `${command} ${args.join(' ')}`.trim() };
        }
      }
    }
    // Case 2: shell-wrapped invocation — openclaw's runExecProcess spawns
    // cmd.exe/bash/sh/pwsh with the user's shell script as one of the args.
    // Scan every arg for the module-form OR path-form fragment.
    for (const arg of args) {
      if (typeof arg !== 'string') continue;
      if (ADB_IN_SHELL_RE.test(arg)) {
        return { hashInput: arg.trim() };
      }
    }
    return null;
  }

  private injectCallId(options: Record<string, unknown> | undefined, callId: string): Record<string, unknown> {
    const cloned: Record<string, unknown> = options ? { ...options } : {};
    const env = (cloned.env && typeof cloned.env === 'object' ? cloned.env : process.env) as NodeJS.ProcessEnv;
    cloned.env = { ...env, AI_DEV_BROWSER_CALL_ID: callId };
    return cloned;
  }

  private attach(
    child: childProcess.ChildProcess,
    meta: { callId: string; cmd: string; argv: string[]; hashInput: string },
  ): void {
    // The hash is computed from `hashInput` alone so it lines up with the
    // sudowork-side `computeAdbCmdHash`, which only sees `args.command`
    // (the shell script text) on the tool_call event.
    const cmdHash = createHash('sha1').update(meta.hashInput).digest('hex');
    const state: CapturedState = {
      callId: meta.callId,
      cmdHash,
      cmd: meta.cmd,
      argv: meta.argv,
      pid: child.pid ?? null,
      ppid: process.pid,
      startedAt: Date.now(),
      chunks: [],
      bytes: 0,
      truncated: false,
    };
    if (child.pid) this.byPid.set(child.pid, state);

    if (child.stdout && typeof (child.stdout as NodeJS.ReadableStream).on === 'function') {
      (child.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (state.bytes >= this.maxBytes) {
          state.truncated = true;
          return;
        }
        const remaining = this.maxBytes - state.bytes;
        if (buf.length > remaining) {
          state.chunks.push(buf.subarray(0, remaining));
          state.bytes += remaining;
          state.truncated = true;
          return;
        }
        state.chunks.push(buf);
        state.bytes += buf.length;
      });
    }
    // Also capture stderr — for failing invocations (e.g. Python
    // ImportError from a wrong CLI form) nothing lands on stdout, but the
    // traceback on stderr is exactly what the LLM needs to self-correct
    // the next turn. We surface it as the payload when stdout is empty.
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    if (child.stderr && typeof (child.stderr as NodeJS.ReadableStream).on === 'function') {
      (child.stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (stderrBytes >= this.maxBytes) return;
        const remaining = this.maxBytes - stderrBytes;
        const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
        stderrChunks.push(slice);
        stderrBytes += slice.length;
      });
    }

    const finalize = (exitCode: number | null) => {
      if (state.pid != null) this.byPid.delete(state.pid);
      const stdoutRaw = Buffer.concat(state.chunks, state.bytes).toString('utf8');
      const stderrRaw = Buffer.concat(stderrChunks, stderrBytes).toString('utf8');
      // When stdout is empty (failed invocation, e.g. Python ImportError),
      // surface stderr as the "visible payload" so the LLM can read the
      // real error message on its next turn and self-correct. When stdout
      // has content, keep it as-is and only stash stderr separately.
      const visible = stdoutRaw.trim() ? stdoutRaw : stderrRaw;
      let stdoutJson: unknown;
      const trimmed = visible.trim();
      if (trimmed) {
        try {
          stdoutJson = JSON.parse(trimmed);
        } catch {
          stdoutJson = undefined;
        }
      }
      const payload = {
        callId: state.callId,
        cmd: state.cmd,
        argv: state.argv,
        pid: state.pid ?? -1,
        ppid: state.ppid,
        startedAt: state.startedAt,
        finishedAt: Date.now(),
        exitCode,
        stdoutRaw: visible,
        stdoutJson,
        stderrRaw,
        cmdHash: state.cmdHash,
        truncated: state.truncated,
      };
      this.post(payload);
    };

    let settled = false;
    const onSettle = (code: number | null) => {
      if (settled) return;
      settled = true;
      finalize(code);
    };
    child.once('exit', (code) => onSettle(typeof code === 'number' ? code : null));
    child.once('error', () => onSettle(null));
  }

  private post(payload: Record<string, unknown>): void {
    let body: Buffer;
    try {
      body = Buffer.from(JSON.stringify(payload), 'utf8');
    } catch {
      return;
    }
    const req = http.request({
      method: 'POST',
      host: this.url.hostname,
      port: this.url.port ? Number(this.url.port) : 80,
      path: this.url.pathname || '/capture',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-adb-secret': this.secret,
      },
      timeout: 1500,
    });
    req.on('error', () => {
      /* swallow — sidechannel absence is non-fatal */
    });
    req.on('timeout', () => {
      req.destroy();
    });
    // Consume response to free the socket.
    req.on('response', (res) => {
      res.on('data', () => {});
      res.on('end', () => {});
    });
    req.end(body);
  }
}
