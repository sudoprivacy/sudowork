/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { mainError } from '@process/utils/mainLogger';
import { handlePwdLogin } from '@process/services/pwdLogin/pwdLoginService';
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
}
