/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { shareoneCliService } from '../services/shareoneCli/ShareoneCliService';

export function initShareoneCliBridge(): void {
  ipcBridge.shareoneCli.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await shareoneCliService.checkInstalled() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.shareoneCli.install.provider(async () => {
    try {
      await shareoneCliService.install();
      ipcBridge.shareoneCli.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.shareoneCli.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });

  ipcBridge.shareoneCli.publishTurn.provider(async ({ markdown, title }) => {
    try {
      const result = await shareoneCliService.publishTurn({ markdown, title });
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as Record<string, unknown>).code as string | undefined;
      return { success: false, msg, code };
    }
  });

  ipcBridge.shareoneCli.publishFile.provider(async ({ filePath }) => {
    try {
      const result = await shareoneCliService.publishFile({ filePath });
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as Record<string, unknown>).code as string | undefined;
      return { success: false, msg, code };
    }
  });
}
