/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EnterpriseMcpPolicyDto } from '../types';
import type { EnterpriseMcpClient } from './client';

interface PolicyResponse {
  success: true;
  data: EnterpriseMcpPolicyDto;
}

export interface McpPolicyApi {
  get(signal?: AbortSignal): Promise<EnterpriseMcpPolicyDto>;
}

export function createMcpPolicyApi(client: EnterpriseMcpClient): McpPolicyApi {
  return {
    async get(signal) {
      const res = await client.request<PolicyResponse>('/api/v1/tenant/mcp-policy', { signal });
      return res.data;
    },
  };
}
