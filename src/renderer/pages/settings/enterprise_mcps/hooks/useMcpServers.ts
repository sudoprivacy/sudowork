/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import useSWR from 'swr';
import type { EnterpriseMcpServerDto } from '../types';
import { useEnterpriseMcpClient } from './useEnterpriseMcpClient';

export const MCP_SERVERS_SWR_KEY = ['enterprise-mcp', 'servers'] as const;

interface UseMcpServersResult {
  servers: EnterpriseMcpServerDto[];
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<EnterpriseMcpServerDto[] | undefined>;
}

export function useMcpServers(): UseMcpServersResult {
  const { servers: api } = useEnterpriseMcpClient();
  const { data, error, isLoading, mutate } = useSWR<EnterpriseMcpServerDto[]>(MCP_SERVERS_SWR_KEY, () => api.list(), {
    // SSE will explicitly invalidate; avoid noisy revalidation
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });

  return {
    servers: data ?? [],
    isLoading,
    error: error as Error | undefined,
    mutate: () => mutate(),
  };
}
