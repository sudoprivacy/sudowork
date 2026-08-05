/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ZZAPI CLI — managed install of @joezhoujinjing/zzapi.
 *
 * Reuses CliInstallService (same shape as Claude Code / ShareOne): the bundled
 * `resources/zzapi.tgz` is extracted to ~/.nexus/cli/zzapi and a wrapper is
 * written to ~/.nexus/bin/zzapi that runs the entry with the bundled Node.js.
 *
 * The wrapper directory is put on the PATH of every agent child process by
 * getEnhancedEnv() (see process/utils/shellEnv.ts), so agents can invoke
 * `zzapi ...` directly from bash.
 */

import { CliInstallService } from '../claudeCli/CliInstallService';
import { ipcBridge } from '@/common';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

export const zzapiCliService = new CliInstallService({
  name: 'zzapi',
  npmPackage: '@joezhoujinjing/zzapi',
  ossName: 'zzapi',
  declinedKey: 'zzapiCli.installDeclined',
  label: 'ZZAPI CLI',
  // Entry is dist/index.js (ESM) — needs a Node runtime; use the bundled one
  // to avoid the macOS Dock bounce from ELECTRON_RUN_AS_NODE.
  useBundledNode: true,
  onProgress: (phase, percent) => {
    ipcBridge.zzapiCli.installProgress.emit({ phase, percent });
  },
});

/**
 * Best-effort background install at startup.
 *
 * Deliberately NOT wired into RuntimeInstaller: zzapi is an optional tool, so a
 * failure here must never gate app startup or surface an error step in the init
 * UI. Safe to call on every launch — install() is skipped once the binary is
 * already present.
 */
export async function ensureZzapiInstalled(): Promise<boolean> {
  try {
    // Logged unconditionally: without it, an early return leaves no trace that
    // this ran at all, which is indistinguishable from the hook never firing.
    mainLog('ZZAPI', 'Checking ZZAPI CLI...');

    if (!zzapiCliService.hasTgzResource()) {
      mainLog('ZZAPI', 'Bundled resource not found, skipping install');
      return false;
    }

    const status = await zzapiCliService.checkInstalled();
    if (status.installed) {
      mainLog('ZZAPI', `Already installed (${status.source}${status.version ? ` ${status.version}` : ''})`);
      return true;
    }

    mainLog('ZZAPI', 'Installing ZZAPI CLI in background...');
    await zzapiCliService.install();
    ipcBridge.zzapiCli.installResult.emit({ success: true });
    mainLog('ZZAPI', 'ZZAPI CLI installed');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mainWarn('ZZAPI', `Background install failed (non-fatal): ${msg}`);
    ipcBridge.zzapiCli.installResult.emit({ success: false, msg });
    return false;
  }
}
