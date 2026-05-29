import type { EnterpriseMcpClient } from './client';
import type { EnterpriseMcpServerDto, EnterpriseMcpUserConfigItem } from '../types';

interface ListServersResponse {
  success: true;
  data: EnterpriseMcpServerDto[];
}

interface SingleServerResponse {
  success: true;
  data: EnterpriseMcpServerDto;
}

interface UserConfigResponse {
  success: true;
  data: {
    schema: EnterpriseMcpUserConfigItem[];
    values: Record<string, string>;
  };
}

interface TestResponse {
  success: true;
  data: {
    ok: boolean;
    message?: string;
    [key: string]: unknown;
  };
}

export interface McpServersApi {
  list(signal?: AbortSignal): Promise<EnterpriseMcpServerDto[]>;
  patch(id: string, patch: Partial<{ display_name: string; enabled: boolean }>): Promise<EnterpriseMcpServerDto>;
  remove(id: string): Promise<void>;
  test(id: string): Promise<TestResponse['data']>;
  getUserConfig(id: string): Promise<UserConfigResponse['data']>;
  updateUserConfig(id: string, config_values: Record<string, string>): Promise<void>;
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
}

export function createMcpServersApi(client: EnterpriseMcpClient): McpServersApi {
  return {
    async list(signal) {
      const res = await client.request<ListServersResponse>('/api/v1/me/mcp-servers', { signal });
      return res.data;
    },
    async patch(id, patch) {
      const res = await client.request<SingleServerResponse>(`/api/v1/me/mcp-servers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
      });
      return res.data;
    },
    async remove(id) {
      await client.request<{ success: true }>(`/api/v1/me/mcp-servers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    async test(id) {
      const res = await client.request<TestResponse>(`/api/v1/me/mcp-servers/${encodeURIComponent(id)}/test`, {
        method: 'POST',
      });
      return res.data;
    },
    async getUserConfig(id) {
      const res = await client.request<UserConfigResponse>(`/api/v1/me/mcp-servers/${encodeURIComponent(id)}/user-config`);
      return res.data;
    },
    async updateUserConfig(id, config_values) {
      await client.request<{ success: true }>(`/api/v1/me/mcp-servers/${encodeURIComponent(id)}/user-config`, {
        method: 'PUT',
        body: { config_values },
      });
    },
    async enable(id) {
      await client.request<{ success: true }>(`/api/v1/me/mcp-servers/${encodeURIComponent(id)}/enable`, {
        method: 'PUT',
      });
    },
    async disable(id) {
      await client.request<{ success: true }>(`/api/v1/me/mcp-servers/${encodeURIComponent(id)}/disable`, {
        method: 'PUT',
      });
    },
  };
}
