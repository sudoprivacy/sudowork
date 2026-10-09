/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structured error codes for pwd_login. Returned to the caller as the
 * `error` field of IPwdLoginResult. These are the ONLY strings allowed
 * in the error channel — no free text, no password-containing details.
 */
export enum PwdLoginErrorCode {
  /** vault title does not exist in nexus */
  EntryNotFound = 'entry_not_found',
  /** user declined the approval dialog */
  ApprovalRejected = 'approval_rejected',
  /** user did not respond within the approval window */
  ApprovalTimeout = 'approval_timeout',
  /** neither adapter lookup nor generic heuristic could locate the login form */
  LoginFormNotFound = 'login_form_not_found',
  /** form was filled + submitted but page still shows login UI */
  LoginSubmitFailed = 'login_submit_failed',
  /** nexus HTTP error (network / 5xx) */
  NexusUnreachable = 'nexus_unreachable',
  /** known-site adapter threw (specific adapter name only in main-process logs, not in returned error) */
  AdapterError = 'adapter_error',
}

export type PwdLoginError = {
  code: PwdLoginErrorCode;
  /** Optional detail for UI — MUST NOT contain password bytes or anything derived from them. */
  detail?: string;
};
