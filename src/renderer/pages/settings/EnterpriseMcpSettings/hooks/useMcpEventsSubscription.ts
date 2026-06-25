import { useEffect } from 'react';
import { mutate } from 'swr';
import { subscribeMcpEvents } from '../api/mcpEvents';
import { useEnterpriseMcpClient } from './useEnterpriseMcpClient';
import { MCP_SERVERS_SWR_KEY } from './useMcpServers';
import { MCP_POLICY_SWR_KEY } from './useMcpPolicy';

/**
 * Subscribe to enterprise MCP SSE events for the lifetime of the mounting component
 * and trigger SWR re-fetches when relevant.
 *
 * - `mcp.changed`        → invalidate /me/mcp-servers and any /me/mcp-templates pages
 * - `mcp.policy.changed` → invalidate /tenant/mcp-policy
 */
export function useMcpEventsSubscription(enabled: boolean = true): void {
  const { client } = useEnterpriseMcpClient();

  useEffect(() => {
    if (!enabled) return;

    const handle = subscribeMcpEvents(client, {
      onChanged: () => {
        void mutate(MCP_SERVERS_SWR_KEY);
        // invalidate every templates page (key tuple starts with these two strings)
        void mutate((key: unknown) => Array.isArray(key) && key[0] === 'enterprise-mcp' && key[1] === 'templates');
      },
      onPolicyChanged: () => {
        void mutate(MCP_POLICY_SWR_KEY);
      },
    });

    return () => handle.close();
  }, [client, enabled]);
}
