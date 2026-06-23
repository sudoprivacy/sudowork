import type { EnterpriseMcpServerDto, EnterpriseMcpTemplateDto, EnterpriseMcpTemplateListResponse } from '../types';
import type { EnterpriseMcpClient } from './client';

interface ListTemplatesEnvelope {
  success: true;
  data: EnterpriseMcpTemplateDto[];
  total: number;
  page: number;
  page_size: number;
}

interface InstallResponse {
  success: true;
  data: EnterpriseMcpServerDto;
}

export interface ListTemplatesParams {
  category?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface InstallTemplatePayload {
  config_values: Record<string, string>;
  auth_credentials?: Record<string, string>;
  display_name?: string;
}

export interface McpTemplatesApi {
  list(params?: ListTemplatesParams, signal?: AbortSignal): Promise<EnterpriseMcpTemplateListResponse>;
  install(templateId: string, payload: InstallTemplatePayload): Promise<EnterpriseMcpServerDto>;
}

export function createMcpTemplatesApi(client: EnterpriseMcpClient): McpTemplatesApi {
  return {
    async list(params = {}, signal) {
      const env = await client.request<ListTemplatesEnvelope>('/api/v1/me/mcp-templates', {
        query: {
          category: params.category,
          search: params.search,
          page: params.page,
          page_size: params.page_size,
        },
        signal,
      });
      return {
        data: env.data,
        total: env.total,
        page: env.page,
        page_size: env.page_size,
      };
    },
    async install(templateId, payload) {
      const res = await client.request<InstallResponse>(`/api/v1/me/mcp-templates/${encodeURIComponent(templateId)}/install`, {
        method: 'POST',
        body: payload,
      });
      return res.data;
    },
  };
}
