/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TFunction } from 'i18next';
import { EnterpriseMcpError } from '@/renderer/pages/settings/enterprise_mcps/api/client';

/** Map moss knowledge errors to localized text; fall back to the server's message. */
export function wikiErrorMessage(t: TFunction, err: unknown): string {
  if (err instanceof EnterpriseMcpError) {
    if (err.code === 'private_root') return t('wiki.errors.privateRoot');
    if (err.code === 'not_cancellable') return t('wiki.errors.notCancellable');
    if (err.httpStatus === 401) return t('wiki.errors.unauthorized');
    if (err.httpStatus === 413) return t('wiki.errors.tooLarge');
    if (err.httpStatus === 409) return t('wiki.errors.conflict', { message: err.message });
    if (err.httpStatus === 404 && err.code !== 'not_found') return t('wiki.errors.notFound');
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** A 404 on the private tree means the moss server predates SudoWork private spaces. */
export function isUnsupportedServer(err: unknown): boolean {
  return err instanceof EnterpriseMcpError && err.httpStatus === 404;
}
