import useSWR from 'swr';
import type { ListTemplatesParams } from '../api/mcpTemplates';
import type { EnterpriseMcpTemplateListResponse } from '../types';
import { useEnterpriseMcpClient } from './useEnterpriseMcpClient';

export function templatesSwrKey(params: ListTemplatesParams) {
  return ['enterprise-mcp', 'templates', params.category ?? '', params.search ?? '', params.page ?? 1, params.page_size ?? 20] as const;
}

interface UseMcpTemplatesResult {
  data: EnterpriseMcpTemplateListResponse | undefined;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<EnterpriseMcpTemplateListResponse | undefined>;
}

export function useMcpTemplates(params: ListTemplatesParams = {}): UseMcpTemplatesResult {
  const { templates: api } = useEnterpriseMcpClient();
  const { data, error, isLoading, mutate } = useSWR<EnterpriseMcpTemplateListResponse>(templatesSwrKey(params), () => api.list(params), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return {
    data,
    isLoading,
    error: error as Error | undefined,
    mutate: () => mutate(),
  };
}
