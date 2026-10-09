/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, dialog } from 'electron';
import i18n, { i18nReady } from '@process/i18n';
import { mainError } from '@process/utils/mainLogger';

/**
 * Surface a fatal "couldn't open the local database" notice to the user.
 *
 * Reached only when the DB engine/environment failed (missing or ABI-mismatched
 * native binding, permission denied, locked file) — NOT on file corruption, which
 * the database layer recovers from on its own. The user's data is intact on disk but
 * unreachable this launch; telling them (instead of silently booting an empty
 * file-backed store) is what stops an install problem from looking like data loss.
 * Fire-and-forget — callers must not block startup on the dialog.
 */
export async function notifyDatabaseUnavailable(): Promise<void> {
  try {
    await i18nReady;
    const options = {
      type: 'error' as const,
      title: i18n.t('runtimeError.database_open_failed.title'),
      message: i18n.t('runtimeError.database_open_failed.title'),
      detail: i18n.t('runtimeError.database_open_failed.body'),
      buttons: [i18n.t('common.close')],
      noLink: true,
    };
    const parent = BrowserWindow.getAllWindows()[0];
    if (parent && !parent.isDestroyed()) {
      await dialog.showMessageBox(parent, options);
    } else {
      await dialog.showMessageBox(options);
    }
  } catch (error) {
    mainError('StartupNotice', 'Failed to surface database-unavailable dialog:', error);
  }
}
