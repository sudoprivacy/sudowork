/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { create } from 'zustand';
import brand from '@brand';
import type { TenantConfigInput } from '@/common/types/tenantConfig';
import { DEFAULT_WORKSPACE_UPLOAD_LIMIT_BYTES } from '@/common/types/tenantConfig';
import { STORAGE_KEYS } from '@/common/storageKeys';

/**
 * Renderer 统一租户状态。品牌展示和租户行为策略使用同一份扁平状态，
 * 远端配置成功后一次性更新并持久化。
 */
export interface ITenantState {
  logo?: string;
  logoDark?: string;
  appName: string;
  topName: string;
  loginDescription: string;
  aboutName: string;
  companyName: string;
  websiteUrl: string;
  privacyPolicyUrl: string;
  clientCronEnabled: boolean;
  clientShowToolCalls: boolean;
  workspaceUploadLimitBytes: number;
  isPolicyConfirmed: boolean;
  applyRemoteConfig: (config: TenantConfigInput) => ReturnType<typeof resolveRemoteTenant>;
  resetPolicyConfirmation: () => void;
  clearTenantCache: () => void;
}

const logoSchema = z.string().refine((value) => value.startsWith('data:image/') || value.startsWith('https://'));
const tenantDataSchema = z.object({
  logo: logoSchema.optional(),
  logoDark: logoSchema.optional(),
  appName: z.string().min(1),
  topName: z.string().min(1),
  loginDescription: z.string().min(1),
  aboutName: z.string().min(1),
  companyName: z.string().min(1),
  websiteUrl: z.string().url(),
  privacyPolicyUrl: z.string().url(),
  clientCronEnabled: z.boolean(),
  clientShowToolCalls: z.boolean(),
  workspaceUploadLimitBytes: z.number().positive(),
});

const BUILTIN_TENANT = {
  appName: 'Sudowork',
  topName: 'Sudowork',
  loginDescription: 'AgentOps | 办公专家',
  aboutName: 'Sudowork',
  companyName: '北京数牍科技有限公司',
  websiteUrl: 'https://sudowork.sudoprivacy.com',
  privacyPolicyUrl: 'https://sudowork.sudoprivacy.com/privacy.html',
  clientCronEnabled: true,
  clientShowToolCalls: true,
  workspaceUploadLimitBytes: DEFAULT_WORKSPACE_UPLOAD_LIMIT_BYTES,
};

const brandConfig = brand as Partial<{
  displayName: string;
  logo: string;
  logoDark: string;
  tagline: string;
  companyName: string;
  websiteUrl: string;
  privacyPolicyUrl: string;
}>;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validLogo(value: unknown): string | undefined {
  const normalized = nonEmptyString(value);
  return normalized && logoSchema.safeParse(normalized).success ? normalized : undefined;
}

/** 解析品牌配置和内置兜底得到默认租户数据。 */
export function resolveTenantDefaults() {
  const displayName = nonEmptyString(brandConfig.displayName);
  return {
    logo: validLogo(brandConfig.logo),
    logoDark: validLogo(brandConfig.logoDark),
    appName: displayName ?? BUILTIN_TENANT.appName,
    topName: displayName ?? BUILTIN_TENANT.topName,
    loginDescription: nonEmptyString(brandConfig.tagline) ?? BUILTIN_TENANT.loginDescription,
    aboutName: displayName ?? BUILTIN_TENANT.aboutName,
    companyName: nonEmptyString(brandConfig.companyName) ?? BUILTIN_TENANT.companyName,
    websiteUrl: nonEmptyString(brandConfig.websiteUrl) ?? BUILTIN_TENANT.websiteUrl,
    privacyPolicyUrl: nonEmptyString(brandConfig.privacyPolicyUrl) ?? BUILTIN_TENANT.privacyPolicyUrl,
    clientCronEnabled: BUILTIN_TENANT.clientCronEnabled,
    clientShowToolCalls: BUILTIN_TENANT.clientShowToolCalls,
    workspaceUploadLimitBytes: BUILTIN_TENANT.workspaceUploadLimitBytes,
  };
}

/** 按“远端配置 > 品牌配置 > 内置默认值”解析完整租户数据。 */
export function resolveRemoteTenant(config: TenantConfigInput) {
  const fallback = resolveTenantDefaults();
  return {
    logo: validLogo(config.logo) ?? fallback.logo,
    logoDark: validLogo(config.logoDark) ?? fallback.logoDark,
    appName: nonEmptyString(config.app_name) ?? fallback.appName,
    topName: nonEmptyString(config.top_name) ?? fallback.topName,
    loginDescription: nonEmptyString(config.login_desp) ?? fallback.loginDescription,
    aboutName: nonEmptyString(config.about_name) ?? fallback.aboutName,
    companyName: nonEmptyString(config.app_company_name) ?? fallback.companyName,
    websiteUrl: fallback.websiteUrl,
    privacyPolicyUrl: fallback.privacyPolicyUrl,
    clientCronEnabled: config.client_cron_enabled === false ? false : fallback.clientCronEnabled,
    clientShowToolCalls: config.client_show_tool_calls === false ? false : fallback.clientShowToolCalls,
    workspaceUploadLimitBytes: typeof config.workspace_upload_limit_bytes === 'number' && Number.isFinite(config.workspace_upload_limit_bytes) && config.workspace_upload_limit_bytes > 0 ? config.workspace_upload_limit_bytes : fallback.workspaceUploadLimitBytes,
  };
}

function persistTenant(data: z.infer<typeof tenantDataSchema>): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEYS.TENANT, JSON.stringify(data));
}

function clearLegacyCaches(): void {
  localStorage.removeItem('sudowork_effective_brand');
  localStorage.removeItem('sudowork_tenant_policy');
  localStorage.removeItem('sudowork_tenant_config');
}

function readCachedTenant(): ReturnType<typeof resolveTenantDefaults> | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const cached = localStorage.getItem(STORAGE_KEYS.TENANT);
    if (cached) return tenantDataSchema.parse(JSON.parse(cached)) as ReturnType<typeof resolveTenantDefaults>;

    const brandCache = localStorage.getItem('sudowork_effective_brand');
    const policyCache = localStorage.getItem('sudowork_tenant_policy');
    if (brandCache || policyCache) {
      const policy = policyCache ? JSON.parse(policyCache) : {};
      const migrated = tenantDataSchema.parse({
        ...resolveTenantDefaults(),
        ...(brandCache ? JSON.parse(brandCache) : {}),
        clientCronEnabled: policy.client_cron_enabled ?? true,
        clientShowToolCalls: policy.client_show_tool_calls ?? true,
        workspaceUploadLimitBytes: policy.workspace_upload_limit_bytes ?? DEFAULT_WORKSPACE_UPLOAD_LIMIT_BYTES,
      });
      persistTenant(migrated);
      clearLegacyCaches();
      return migrated as ReturnType<typeof resolveTenantDefaults>;
    }

    const legacy = localStorage.getItem('sudowork_tenant_config');
    if (!legacy) return null;
    const migrated = tenantDataSchema.parse(resolveRemoteTenant(JSON.parse(legacy) as TenantConfigInput));
    persistTenant(migrated);
    clearLegacyCaches();
    return migrated as ReturnType<typeof resolveTenantDefaults>;
  } catch {
    localStorage.removeItem(STORAGE_KEYS.TENANT);
    return null;
  }
}

const initialTenant = readCachedTenant() ?? resolveTenantDefaults();

export const useTenantStore = create<ITenantState>((set) => ({
  ...initialTenant,
  isPolicyConfirmed: false,
  applyRemoteConfig: (config) => {
    const tenant = resolveRemoteTenant(config);
    persistTenant(tenant);
    set({ ...tenant, isPolicyConfirmed: true });
    return tenant;
  },
  resetPolicyConfirmation: () => set({ isPolicyConfirmed: false }),
  clearTenantCache: () => {
    const defaults = resolveTenantDefaults();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.TENANT);
      clearLegacyCaches();
    }
    set({ ...defaults, isPolicyConfirmed: false });
  },
}));
