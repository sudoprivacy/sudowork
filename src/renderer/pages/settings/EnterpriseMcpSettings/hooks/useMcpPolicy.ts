import useSWR from 'swr';
import { useEnterpriseMcpClient } from './useEnterpriseMcpClient';
import type { EnterpriseMcpPolicyDto } from '../types';

export const MCP_POLICY_SWR_KEY = ['enterprise-mcp', 'policy'] as const;

interface UseMcpPolicyResult {
  policy: EnterpriseMcpPolicyDto | undefined;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<EnterpriseMcpPolicyDto | undefined>;
}

export function useMcpPolicy(): UseMcpPolicyResult {
  const { policy: api } = useEnterpriseMcpClient();
  const { data, error, isLoading, mutate } = useSWR<EnterpriseMcpPolicyDto>(MCP_POLICY_SWR_KEY, () => api.get(), {
    revalidateOnFocus: false,
  });

  return {
    policy: data,
    isLoading,
    error: error as Error | undefined,
    mutate: () => mutate(),
  };
}
