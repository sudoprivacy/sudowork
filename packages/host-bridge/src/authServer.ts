/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which server this client authenticates against.
 *
 * The app historically kept two addresses that never met: `system.sudoworkServerUrl`
 * for the consumer entry and `eeclaw.serverUrl` for the enterprise one, with the
 * auth calls hard-wired to the consumer one. That is why pointing the app at a
 * control plane could not produce a phone-code login screen — the login method
 * came from one server while the login request went to another.
 *
 * This resolves the single address the whole auth flow should use, so
 * `/api/v1/system-config` and `/api/v1/auth/*` always describe and address the
 * same server.
 */
import { ConfigStorage } from '@sudowork/common/storage';
import { getSudoworkServerBaseUrl, normalizeSudoworkServerUrl } from '@sudowork/common/sudoworkServer';
import { getAppMode } from './eeclawMode.js';

/**
 * Base URL of the server that owns identity for this client.
 *
 * Enterprise mode answers with the configured control-plane address; every other
 * mode answers with the consumer server. Enterprise mode with no address
 * configured falls back to the consumer server rather than returning nothing, so
 * a half-configured install degrades to the old behaviour instead of failing
 * every request with an unhelpful error.
 */
export async function getAuthServerBaseUrl(): Promise<string> {
  const mode = await getAppMode();
  if (mode === 'e') {
    const raw = await ConfigStorage.get('eeclaw.serverUrl').catch((): string | undefined => undefined);
    const normalized = normalizeSudoworkServerUrl(raw);
    if (normalized) return normalized;
  }
  return getSudoworkServerBaseUrl();
}
