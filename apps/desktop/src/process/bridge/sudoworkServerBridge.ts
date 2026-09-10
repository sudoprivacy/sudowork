/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { sudoworkServer } from '@sudowork/host-bridge/ipcBridge';
import { getAuthServerBaseUrl } from '@sudowork/host-bridge/authServer';

export function initSudoworkServerBridge(): void {
  sudoworkServer.getConfig.provider(async () => {
    // The server that owns this client's identity — not a separately-resolved
    // consumer address.
    //
    // Everything reached through this channel (points, usage, orders, tenant
    // config, config items) is scoped to the signed-in user, so it has to be
    // asked of the server that signed them in. While the two were resolved
    // independently, anyone authenticated against a control plane sent that
    // server's token to the consumer server, which does not know it: the points
    // panel came back empty and nothing reported an error.
    //
    // Resolved on every call so a change of server takes effect immediately.
    return { baseUrl: await getAuthServerBaseUrl() };
  });

  sudoworkServer.updateConfig.provider(async (_config) => {
    // No-op: this legacy IPC channel does not own writes to the new
    // `system.sudoworkServerUrl` setting (ModeSetup writes ConfigStorage directly).
    // Kept for backward compatibility with renderer code that may still invoke it.
  });
}
