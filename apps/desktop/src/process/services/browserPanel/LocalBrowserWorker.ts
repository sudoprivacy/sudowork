import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, closeSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

interface ILocalBrowserWorkerOptions {
  root: string;
  python: string;
  binding: { orgId: string; userId: string; sessionId: string };
  env?: NodeJS.ProcessEnv;
  chromeArgs?: string[];
  existingExtensionRoot?: string;
}

/** Private host handoff, absent from the renderer and agent action schemas. */
export interface IHostPageNavigation {
  url: string;
  cookie: { name: string; value: string; url: string; path: string; httpOnly: true; sameSite: 'Strict'; expires: number };
}

/** Process and authenticated transport adapter; browser behavior belongs to adb. */
export class LocalBrowserWorker {
  private readonly hostToken = randomBytes(32).toString('hex');
  private readonly aiToken = randomBytes(32).toString('hex');
  private readonly controller: string;
  private child: ChildProcess | undefined;
  private origin = '';
  private startup: Promise<void> | undefined;
  private isClosed = false;
  private nativeWindowHelper: { python: string; script: string } | undefined;

  constructor(private readonly options: ILocalBrowserWorkerOptions) {
    let controller = `user-${randomBytes(16).toString('hex')}`;
    const journal = path.join(options.root, 'control.json');
    if (existsSync(journal)) {
      const saved = JSON.parse(readFileSync(journal, 'utf8')) as { binding?: Record<string, unknown>; controller?: unknown };
      if (!saved.binding || Object.entries(options.binding).some(([key, value]) => saved.binding![key] !== value)) throw new Error('Local browser profile belongs to a different conversation');
      if (saved.controller !== undefined && saved.controller !== null) {
        if (typeof saved.controller !== 'string' || !/^user-[a-f0-9]{32}$/.test(saved.controller)) throw new Error('Local browser controller requires recovery');
        controller = saved.controller;
      }
    }
    this.controller = controller;
  }

  get isDisconnected(): boolean {
    return this.isClosed || !!(this.child && (this.child.exitCode !== null || this.child.signalCode !== null));
  }

  async start(): Promise<void> {
    if (this.isClosed) throw new Error('Local browser worker is closed');
    this.startup ??= this.launch().catch(async (error) => {
      await this.terminateProcess();
      this.isClosed = true;
      throw error;
    });
    await this.startup;
  }

  private async launch(): Promise<void> {
    mkdirSync(this.options.root, { recursive: true });
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Local browser port is unavailable');
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
    this.origin = `http://127.0.0.1:${port}`;
    const log = openSync(path.join(this.options.root, 'worker.log'), 'a', 0o600);
    let launchError: Error | undefined;
    try {
      this.child = spawn(
        this.options.python,
        [
          '-m',
          'ai_dev_browser.remote.worker',
          '--profile-root',
          this.options.root,
          '--display',
          'native',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          ...(this.options.existingExtensionRoot ? ['--existing-extension-root', this.options.existingExtensionRoot] : []),
          ...(this.options.chromeArgs || []).map((arg) => `--chrome-arg=${arg}`),
        ],
        {
          windowsHide: true,
          stdio: ['ignore', log, log],
          env: { ...process.env, PYTHONPATH: '', ...this.options.env, AI_DEV_BROWSER_WORKER_HOST_TOKEN: this.hostToken, AI_DEV_BROWSER_WORKER_AI_TOKEN: this.aiToken },
        }
      );
      this.child.once('error', (error) => {
        launchError = error;
      });
    } finally {
      closeSync(log);
    }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (launchError || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('Local browser worker could not start; see its private worker log');
      let isReady = false;
      try {
        const response = await fetch(`${this.origin}/binding`, { headers: { Authorization: `Bearer ${this.hostToken}` }, signal: AbortSignal.timeout(1_000) });
        isReady = response.ok;
        // A process that won the port race cannot satisfy our random token.
        if (!isReady) throw new Error('Local browser port belongs to another process');
        const binding = (await response.json()) as { nativeWindowHelper?: { python?: unknown; script?: unknown } | null };
        const helper = binding.nativeWindowHelper;
        if (process.platform === 'win32' && helper) {
          const interpreterDirectory = path.dirname(this.options.python);
          const runtimeRoot = path.basename(interpreterDirectory).toLowerCase() === 'scripts' ? path.dirname(interpreterDirectory) : interpreterDirectory;
          const expected = path.join(runtimeRoot, 'Lib', 'site-packages', 'ai_dev_browser', 'remote', 'native_window.py');
          if (typeof helper.python !== 'string' || !path.isAbsolute(helper.python) || path.basename(helper.python).toLowerCase() !== 'python.exe' || typeof helper.script !== 'string' || path.resolve(helper.script).toLowerCase() !== path.resolve(expected).toLowerCase())
            throw new Error('Local browser native helper is outside its pinned runtime');
          this.nativeWindowHelper = { python: helper.python, script: helper.script };
        }
      } catch (error) {
        if (error instanceof Error && (error.message === 'Local browser port belongs to another process' || error.message === 'Local browser native helper is outside its pinned runtime')) throw error;
      }
      if (isReady) {
        await this.invoke({ kind: 'state' });
        return;
      }
      await delay(50);
    }
    throw new Error('Local browser worker startup timed out');
  }

  private async request(route: string, value: unknown, token: string): Promise<unknown> {
    if (this.isClosed || !this.origin || !this.child || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('Local browser worker is disconnected');
    const response = await fetch(`${this.origin}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-ADB-Browser-Context': JSON.stringify(this.options.binding), 'X-ADB-Browser-Session': this.options.binding.sessionId },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(90_000),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const code = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'local_browser_request_failed';
      throw new Error(code);
    }
    return result;
  }

  /** Host calls carry the controller; AI never receives this credential. */
  async invoke(action: unknown): Promise<unknown> {
    if (action && typeof action === 'object' && 'kind' in action && action.kind === 'show-window') {
      if (process.platform === 'win32') return this.showNativeWindow(action);
      return this.request('/invoke', { binding: this.options.binding, controller: this.controller, action: { ...action, kind: 'select-tab' } }, this.hostToken);
    }
    return this.request('/invoke', { binding: this.options.binding, controller: this.controller, action }, this.hostToken);
  }

  private async showNativeWindow(action: object): Promise<unknown> {
    const helper = this.nativeWindowHelper;
    if (!helper) throw new Error('native_window_runtime_upgrade_required');
    if (this.isClosed || !this.origin || !this.child || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('Local browser worker is disconnected');
    // The actual interpreter must be a direct child of foreground Electron.
    // The Windows venv redirector introduces another process and loses that
    // normal foreground eligibility. The pinned SDK supplies both paths.
    return new Promise((resolve, reject) => {
      const child = spawn(helper.python, ['-I', helper.script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let isFinished = false;
      const finish = (error?: Error, value?: unknown) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('native_window_activation_timed_out'));
      }, 8_000);
      child.once('error', finish);
      child.stdin.once('error', finish);
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString('utf8');
        if (output.length > 1024 * 1024) {
          child.kill();
          finish(new Error('native_window_reply_invalid'));
        }
      });
      child.stderr.resume();
      child.once('close', (code) => {
        try {
          const reply = JSON.parse(output) as { error?: unknown; nativeWindow?: { foreground?: unknown } };
          if (code !== 0 || reply.nativeWindow?.foreground !== true) finish(new Error(typeof reply.error === 'string' ? reply.error : 'native_window_activation_unavailable'));
          else finish(undefined, reply);
        } catch {
          finish(new Error('native_window_reply_invalid'));
        }
      });
      // Credentials are absent from command arguments, environment and files.
      child.stdin.end(JSON.stringify({ origin: this.origin, token: this.hostToken, binding: this.options.binding, controller: this.controller, action: { ...action, kind: 'prepare-native-window' }, parentPid: process.pid }));
    });
  }

  async mcp(request: unknown): Promise<unknown> {
    return this.request('/mcp', request, this.aiToken);
  }

  async upload(input: { name: string; controlEpoch: number; targetEpoch: number; data: Uint8Array }): Promise<unknown> {
    const response = await fetch(`${this.origin}/files/receive`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.hostToken}`,
        'X-ADB-Browser-Context': encodeURIComponent(JSON.stringify({ binding: this.options.binding, controller: this.controller, controlEpoch: input.controlEpoch, targetEpoch: input.targetEpoch })),
        'X-ADB-Browser-File-Name': encodeURIComponent(input.name),
      },
      body: Buffer.from(input.data),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Local browser upload failed');
    return response.json();
  }

  async download(fileId: string): Promise<Uint8Array> {
    const response = await fetch(`${this.origin}/files/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.hostToken}`, 'X-ADB-Browser-Context': encodeURIComponent(JSON.stringify({ binding: this.options.binding, controller: this.controller, fileId })) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Local browser download failed');
    return new Uint8Array(await response.arrayBuffer());
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    // Explicitly stop the owned Chrome before terminating Python on Windows,
    // where SIGTERM cannot run asyncio's graceful shutdown handlers.
    if (this.child?.exitCode === null && this.child.signalCode === null) {
      let reply = (await this.invoke({ kind: 'state' })) as { session: { state: string; isController: boolean; controlEpoch: number; targetEpoch: number; personalExtension?: unknown } };
      if (reply.session.personalExtension) {
        if (!reply.session.isController && reply.session.state !== 'stopped') reply = (await this.invoke({ kind: 'take', controlEpoch: reply.session.controlEpoch, targetEpoch: reply.session.targetEpoch })) as typeof reply;
        await this.invoke({ kind: 'disconnect-existing-extension', controlEpoch: reply.session.controlEpoch, targetEpoch: reply.session.targetEpoch });
      } else if (reply.session.state !== 'stopped') {
        const epochs = { controlEpoch: reply.session.controlEpoch, targetEpoch: reply.session.targetEpoch };
        if (reply.session.state === 'ai') {
          const result = (await this.mcp({ jsonrpc: '2.0', id: 'shutdown', method: 'tools/call', params: { name: 'browser_stop', arguments: epochs } })) as { result?: { isError?: boolean } };
          if (!result.result || result.result.isError) throw new Error('Local browser refused shutdown');
        } else if (reply.session.isController) await this.invoke({ kind: 'stop', ...epochs });
        else throw new Error('Local browser control must be recovered before shutdown');
      }
      await this.terminateProcess();
    }
    this.isClosed = true;
  }

  private async terminateProcess(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill();
    await Promise.race([
      exited,
      delay(5_000, undefined, { ref: false }).then(() => {
        throw new Error('Local browser worker has not stopped');
      }),
    ]);
  }
}
