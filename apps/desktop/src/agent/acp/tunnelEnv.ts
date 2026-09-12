/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainWarn } from '@process/utils/mainLogger';

/** Backends routed through the nexus managed_agent tunnel when one is serving. */
const TUNNELLED_BACKENDS = new Set(['scode']);

/**
 * Decides whether a backend's spawn goes through the nexus tunnel, and says so
 * either way.
 *
 * Pulled out of the spawn path so the decision is testable on its own. The
 * value here is not the branch — it is that every outcome is stated. Three
 * things can happen and two of them used to be silent, which made a session
 * that never reached nexus indistinguishable from one that ran entirely over
 * the tunnel.
 *
 * Scoped to scode: it is the only backend proven end-to-end over the tunnel.
 * Others stay local until validated, and that is a deliberate allowlist rather
 * than a capability check.
 */
export function resolveTunnelEnv(backend: string, tunnelEndpoint: string | null): Record<string, string> {
  if (!TUNNELLED_BACKENDS.has(backend)) return {};

  if (!tunnelEndpoint) {
    mainWarn('[AcpAgent]', `nexus tunnel unavailable (nexusd-cluster not serving); spawning ${backend} locally`);
    return {};
  }

  return { ACP_GRPC_ENDPOINT: tunnelEndpoint };
}
