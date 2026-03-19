import { ipcBridge } from '../../common';
import { claudeCliService, geminiCliService, openclawCliService } from '../services/claudeCli/CliInstallService';

export function initClaudeCliBridge(): void {
  // ── Claude CLI ────────────────────────────────────────────────────────────
  ipcBridge.claudeCli.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await claudeCliService.checkInstalled() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.claudeCli.install.provider(async () => {
    try {
      await claudeCliService.install();
      ipcBridge.claudeCli.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.claudeCli.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });

  ipcBridge.claudeCli.uninstall.provider(async () => {
    try {
      await claudeCliService.uninstall();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Gemini CLI ────────────────────────────────────────────────────────────
  ipcBridge.geminiCli.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await geminiCliService.checkInstalled() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.geminiCli.install.provider(async () => {
    try {
      await geminiCliService.install();
      ipcBridge.geminiCli.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.geminiCli.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });

  ipcBridge.geminiCli.uninstall.provider(async () => {
    try {
      await geminiCliService.uninstall();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── OpenClaw CLI ──────────────────────────────────────────────────────────
  ipcBridge.openclawCli.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await openclawCliService.checkInstalled() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.openclawCli.install.provider(async () => {
    try {
      await openclawCliService.install();
      ipcBridge.openclawCli.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.openclawCli.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });

  ipcBridge.openclawCli.uninstall.provider(async () => {
    try {
      await openclawCliService.uninstall();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
