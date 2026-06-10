/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Feishu/Lark OAuth + Open API endpoint resolution and shared constants.
 *
 * Ported from the official lark-cli Go source (D:\sudo\lark\cli):
 *   - internal/core: ResolveEndpoints (Open / Accounts base URLs per brand)
 *   - internal/auth/paths.go: the OAuth + user_info path constants
 *
 * We talk to these endpoints directly with `fetch` from the Electron main
 * process instead of shelling out to the lark-cli binary.
 */

export type LarkBrand = 'feishu' | 'lark';

export interface LarkEndpoints {
  /** Open API base, e.g. https://open.feishu.cn */
  open: string;
  /** Accounts/OAuth base, e.g. https://accounts.feishu.cn */
  accounts: string;
}

/** Resolve the Open API + Accounts base URLs for a brand (mirrors core.ResolveEndpoints). */
export function resolveEndpoints(brand: LarkBrand): LarkEndpoints {
  if (brand === 'lark') {
    return { open: 'https://open.larksuite.com', accounts: 'https://accounts.larksuite.com' };
  }
  return { open: 'https://open.feishu.cn', accounts: 'https://accounts.feishu.cn' };
}

/** Normalize an arbitrary brand string to a LarkBrand (defaults to feishu, like core.ParseBrand). */
export function parseBrand(value: string | undefined): LarkBrand {
  return value === 'lark' ? 'lark' : 'feishu';
}

// OAuth + user_info paths (internal/auth/paths.go).
export const PATH_APP_REGISTRATION = '/oauth/v1/app/registration';
export const PATH_DEVICE_AUTHORIZATION = '/oauth/v1/device_authorization';
export const PATH_OAUTH_TOKEN_V2 = '/open-apis/authen/v2/oauth/token';
export const PATH_USER_INFO_V1 = '/open-apis/authen/v1/user_info';

/**
 * Auto-approve scopes requested during device authorization.
 *
 * Trimmed down to just the Base (multi-dimensional table) and IM (messaging)
 * scopes the assistant actually needs, plus offline_access (required for
 * refresh_token). Requesting the full lark-cli --recommend set (300+ scopes)
 * was rejected by the authorization endpoint as too large, so we keep only the
 * core base:* and im:* scopes here. All are auto-approve, so the QR flow stays
 * a single tap — the user never has to open the developer console.
 *
 * Sourced from lark-cli's recommend set (internal/registry/scope_priorities.json),
 * filtered to the base:* / im:* namespaces.
 */
export const RECOMMENDED_SCOPE = [
  // offline_access — needed to obtain a refresh_token
  'offline_access',
  // Base (multi-dimensional table) — app + table/field/record/view CRUD
  'base:app:create',
  'base:app:read',
  'base:app:update',
  'base:field:create',
  'base:field:delete',
  'base:field:read',
  'base:field:update',
  'base:record:create',
  'base:record:delete',
  'base:record:read',
  'base:record:retrieve',
  'base:record:update',
  'base:table:create',
  'base:table:delete',
  'base:table:read',
  'base:table:update',
  'base:view:read',
  'base:view:write_only',
  'base:workspace:list',
  // IM (messaging) — send/receive/update messages, read chats & members, resources
  'im:chat:read',
  'im:chat:readonly',
  'im:chat.members:read',
  'im:message',
  'im:message:readonly',
  'im:message:send_as_bot',
  'im:message:update',
  'im:resource',
].join(' ');
