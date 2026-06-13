/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { mainError } from '@process/utils/mainLogger';
import { handlePwdLogin, listPwdLoginEntries, registerPwdLoginEntry, deletePwdLoginEntry, savePwdLoginCredential } from '@process/services/pwdLogin/pwdLoginService';
import { PwdLoginErrorCode } from '@process/services/pwdLogin/errors';

/**
 * Wire the pwd_login IPC channel to the trusted handler.
 *
 * The provider is thin on purpose — any diagnostic detail returned to the
 * renderer must remain free of password bytes or anything derived from them
 * (v2 spec §7). The service itself guarantees that; this bridge just
 * forwards.
 */
export function initPwdLoginBridge(): void {
  ipcBridge.pwdLogin.start.provider(async (params) => {
    try {
      return await handlePwdLogin(params);
    } catch (err) {
      // Defence in depth: never let an unhandled exception leak upwards.
      // Log only the error name / type — no stack, no payload.
      mainError('pwdLoginBridge', `unhandled error: ${err instanceof Error ? err.name : typeof err}`);
      return { ok: false, error: PwdLoginErrorCode.AdapterError };
    }
  });

  ipcBridge.pwdLogin.listEntries.provider(async () => {
    try {
      return { success: true, data: await listPwdLoginEntries() };
    } catch (err) {
      mainError('pwdLoginBridge', `listEntries failed: ${err instanceof Error ? err.name : typeof err}`);
      return { success: false, msg: 'list_failed', data: [] };
    }
  });

  ipcBridge.pwdLogin.registerEntry.provider(async (entry) => {
    try {
      await registerPwdLoginEntry(entry);
      return { success: true };
    } catch (err) {
      mainError('pwdLoginBridge', `registerEntry failed: ${err instanceof Error ? err.name : typeof err}`);
      return { success: false, msg: err instanceof Error ? err.message : 'register_failed' };
    }
  });

  ipcBridge.pwdLogin.deleteEntry.provider(async ({ title }) => {
    try {
      await deletePwdLoginEntry(title);
      return { success: true };
    } catch (err) {
      mainError('pwdLoginBridge', `deleteEntry failed: ${err instanceof Error ? err.name : typeof err}`);
      return { success: false, msg: 'delete_failed' };
    }
  });

  // Credential save: the password flows renderer(form)→main→Vault only; the
  // bridge logs nothing derived from it.
  ipcBridge.pwdLogin.saveCredential.provider(async ({ title, username, password }) => {
    try {
      await savePwdLoginCredential(title, username, password);
      return { success: true };
    } catch (err) {
      mainError('pwdLoginBridge', `saveCredential failed: ${err instanceof Error ? err.name : typeof err}`);
      return { success: false, msg: 'save_failed' };
    }
  });
}
