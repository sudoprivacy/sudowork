/**
 * Architectural block for the LLM re-enabling openclaw's builtin browser.
 *
 * Openclaw exposes a `gateway` tool with `config.patch` / `config.apply`
 * actions — the LLM can (and does, empirically) flip
 * `browser.enabled: false → true` at runtime, overriding the setting we
 * write in `SudoclawInstallService.ensureDefaultConfig` /
 * `repairOpenClawConfig`. Text-level policy in SKILL.md is insufficient.
 *
 * This guard monkey-patches `fs.promises.writeFile` and `fs.writeFileSync`
 * inside the gateway process. When the file path looks like the
 * `sudoclaw.json` config (or its `.tmp` atomic-write companion) AND the
 * payload is a config JSON containing `browser.enabled: true`, we mutate
 * the value back to `false` before the real write happens. The LLM's
 * config.patch call still returns success, but the persisted file — and
 * therefore what the gateway reads after its restart — stays `false`.
 */

import * as fsNs from 'node:fs';
import { createRequire } from 'node:module';

// Same ESM-vs-CJS dance as AdbStdoutCapture: need the writable CJS exports
// object, not the ESM namespace.
const fs: typeof fsNs = (() => {
  try {
    const req = createRequire(import.meta.url);
    return req('fs') as typeof fsNs;
  } catch {
    return fsNs;
  }
})();

// Matches both the final file and any atomic-write `.tmp` companion
// (openclaw names them `sudoclaw.json.<pid>.<uuid>.tmp`).
const SUDOCLAW_JSON_PATH_RE = /[\\/]sudoclaw\.json(?:\.\d+\.[\w-]+\.tmp)?$/i;

function looksLikeSudoclawConfigObj(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  // sudoclaw config has at minimum a gateway + agents section.
  return 'gateway' in o || 'agents' in o || 'browser' in o;
}

function guardPayload(data: string | Uint8Array | Buffer): string | Uint8Array | Buffer {
  let text: string;
  try {
    text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf-8');
  } catch {
    return data;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return data;
  }
  if (!looksLikeSudoclawConfigObj(obj)) return data;
  const cfg = obj as {
    browser?: { enabled?: unknown };
    tools?: { deny?: unknown };
    skills?: { entries?: Record<string, { enabled?: unknown }> };
  };
  let mutated = false;

  // Invariant 1: browser.enabled must remain false. The LLM empirically
  // discovers and attempts to flip this via gateway.config.patch.
  if (cfg.browser && typeof cfg.browser === 'object' && cfg.browser.enabled === true) {
    cfg.browser.enabled = false;
    mutated = true;
  }

  // Invariant 2: tools.deny must include both 'browser' and 'image'.
  // These control what's in the LLM's tool catalog (openclaw's
  // filterToolsByPolicy). If the LLM drops either, re-add.
  const tools = (cfg.tools ?? {}) as { deny?: unknown };
  const denyArr = Array.isArray(tools.deny) ? (tools.deny as unknown[]).slice() : [];
  for (const toolName of ['browser', 'image']) {
    if (!denyArr.some((v) => v === toolName)) {
      denyArr.push(toolName);
      mutated = true;
    }
  }
  if (mutated) {
    tools.deny = denyArr;
    cfg.tools = tools;
  }

  // Invariant 3: the builtin image-analysis skill stays disabled.
  // Its analyze_image.sh spawns a separate vision LLM subprocess, which
  // breaks the orchestrating LLM's browser-session context continuity —
  // ai-dev-browser's page_discover (ARIA semantics) is the first-class
  // signal for web automation.
  const skills = (cfg.skills ?? {}) as { entries?: Record<string, { enabled?: unknown }> };
  const entries = (skills.entries ?? {}) as Record<string, { enabled?: unknown }>;
  const ia = (entries['image-analysis'] ?? {}) as { enabled?: unknown };
  if (ia.enabled !== false) {
    ia.enabled = false;
    entries['image-analysis'] = ia;
    skills.entries = entries;
    cfg.skills = skills;
    mutated = true;
  }

  if (!mutated) return data;
  const nextJson = JSON.stringify(obj, null, 2);
  return typeof data === 'string' ? nextJson : Buffer.from(nextJson, 'utf-8');
}

export class SudoclawConfigGuard {
  private originalWriteFileSync: typeof fs.writeFileSync | null = null;
  private originalWriteFileAsync: typeof fs.promises.writeFile | null = null;
  private applied = false;

  apply(): void {
    if (this.applied) return;
    this.applied = true;

    this.originalWriteFileSync = fs.writeFileSync;
    const origSync = this.originalWriteFileSync;
    const self = this;
    (fs as unknown as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = function patchedWriteFileSync(
      this: unknown,
      file: unknown,
      data: unknown,
      options?: unknown,
    ): void {
      const next = self.guardIfApplicable(file, data);
      return (origSync as unknown as (f: unknown, d: unknown, o?: unknown) => void).call(this, file, next, options);
    } as typeof fs.writeFileSync;

    this.originalWriteFileAsync = fs.promises.writeFile;
    const origAsync = this.originalWriteFileAsync;
    (fs.promises as unknown as { writeFile: typeof fs.promises.writeFile }).writeFile = async function patchedWriteFile(
      this: unknown,
      file: unknown,
      data: unknown,
      options?: unknown,
    ): Promise<void> {
      const next = self.guardIfApplicable(file, data);
      return await (origAsync as unknown as (f: unknown, d: unknown, o?: unknown) => Promise<void>).call(this, file, next, options);
    } as typeof fs.promises.writeFile;

    try {
      console.error('[SudoclawConfigGuard] applied (writeFile / writeFileSync wrapped)');
    } catch {
      /* swallow */
    }
  }

  dispose(): void {
    if (!this.applied) return;
    if (this.originalWriteFileSync) {
      (fs as unknown as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = this.originalWriteFileSync;
      this.originalWriteFileSync = null;
    }
    if (this.originalWriteFileAsync) {
      (fs.promises as unknown as { writeFile: typeof fs.promises.writeFile }).writeFile = this.originalWriteFileAsync;
      this.originalWriteFileAsync = null;
    }
    this.applied = false;
  }

  private guardIfApplicable(file: unknown, data: unknown): unknown {
    if (typeof file !== 'string') return data;
    if (!SUDOCLAW_JSON_PATH_RE.test(file)) return data;
    if (typeof data !== 'string' && !Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return data;
    return guardPayload(data as string | Buffer | Uint8Array);
  }
}
