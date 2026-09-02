/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useAuth } from '@/renderer/context/AuthContext';
import { createEnterpriseMcpClient, type EnterpriseMcpClient } from '../api/client';
import { createMcpServersApi, type McpServersApi } from '../api/mcpServers';
import { createMcpTemplatesApi, type McpTemplatesApi } from '../api/mcpTemplates';
import { createMcpPolicyApi, type McpPolicyApi } from '../api/mcpPolicy';

interface EnterpriseMcpApis {
  client: EnterpriseMcpClient;
  servers: McpServersApi;
  templates: McpTemplatesApi;
  policy: McpPolicyApi;
}

/**
 * Build (and memoize) the enterprise MCP client + API wrappers.
 * The client uses the AuthContext's ensureValidToken to fetch / refresh Bearer tokens.
 */
export function useEnterpriseMcpClient(): EnterpriseMcpApis {
  const { ensureValidToken } = useAuth();

  return useMemo(() => {
    const client = createEnterpriseMcpClient((forceRefresh) => ensureValidToken(forceRefresh));
    return {
      client,
      servers: createMcpServersApi(client),
      templates: createMcpTemplatesApi(client),
      policy: createMcpPolicyApi(client),
    };
  }, [ensureValidToken]);
}
