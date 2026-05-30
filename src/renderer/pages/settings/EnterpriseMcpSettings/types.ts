/**
 * Enterprise MCP DTO types — independent from C-side McpServer in src/common/storage.ts
 * Field names follow the server's snake_case responses (16-field server whitelist /
 * 14-field template whitelist). Do not rename to camelCase here; do conversion at
 * the boundary if needed.
 */

export type EnterpriseMcpScope = 'org' | 'department' | 'user';
export type EnterpriseMcpType = 'http' | 'sse' | 'stdio';
export type EnterpriseMcpRiskLevel = 'low' | 'medium' | 'high';
export type EnterpriseMcpStatus = 'enabled' | 'disabled' | 'pending' | string;

/** Server-side response from /me/mcp-servers (16-field whitelist). */
export interface EnterpriseMcpServerDto {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  icon: string | null;
  category: string | null;
  scope: EnterpriseMcpScope;
  mcp_type: EnterpriseMcpType;
  url: string | null;
  risk_level: EnterpriseMcpRiskLevel;
  bound_assistants: string[] | null;
  bound_skills: string[] | null;
  allow_read: boolean;
  allow_write: boolean;
  allow_user_disable: boolean;
  enabled: boolean;
  status: EnterpriseMcpStatus;
  user_disabled: boolean;
  _requires_approval?: boolean;
}

export type EnterpriseMcpUserConfigTarget = 'env' | 'headers';

export interface EnterpriseMcpUserConfigItem {
  name: string;
  key: string;
  required: boolean;
  description?: string;
  target: EnterpriseMcpUserConfigTarget;
}

/** Server-side response from /me/mcp-templates (14-field whitelist). */
export interface EnterpriseMcpTemplateDto {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
  mcp_type: EnterpriseMcpType;
  scope: 'org' | 'department';
  risk_level: EnterpriseMcpRiskLevel;
  downloads: number;
  rating: number;
  user_config_items: EnterpriseMcpUserConfigItem[];
  created_at: number;
  updated_at: number;
}

/** Server-side response from /tenant/mcp-policy. Unknown fields kept via index signature. */
export interface EnterpriseMcpPolicyDto {
  allow_personal_mcp?: boolean;
  allow_stdio_mcp?: boolean;
  allow_http_sse_mcp?: boolean;
  [key: string]: unknown;
}

/** Normalized error from API layer. */
export interface EnterpriseMcpApiError {
  code: string;
  message: string;
  missing_keys?: string[];
  httpStatus?: number;
}

/** Pagination response wrapper for templates. */
export interface EnterpriseMcpTemplateListResponse {
  data: EnterpriseMcpTemplateDto[];
  total: number;
  page: number;
  page_size: number;
}
