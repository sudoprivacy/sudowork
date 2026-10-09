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
import { getMossServerPolicy } from '@sudowork/common/sudoworkServer';

/**
 * Base URL of the server that owns identity for this client.
 *
 * Online authentication always uses this Moss policy, independent of the
 * internal local/remote execution mode.
 */
export async function getAuthServerBaseUrl(): Promise<string> {
  return (await getMossServerPolicy()).serverUrl;
}
