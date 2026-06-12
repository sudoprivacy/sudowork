/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tenant configuration types
 * 租户配置类型定义
 */

/**
 * 租户配置接口响应字段
 */
export interface TenantConfig {
  /** Logo 图片 base64 编码（如：data:image/png;base64,xxx） */
  logo?: string;
  /** App Name - 登录页标题、首页侧栏名称 */
  app_name?: string;
  /** Top Name - 客户端顶部 header（标题栏 Titlebar）显示 */
  top_name?: string;
  /** Login Description - 登录页副标题 */
  login_desp?: string;
  /** About Name - 关于页标题 */
  about_name?: string;
  /** 公司主体名称 - 关于页公司信息 */
  app_company_name?: string;
  /**
   * 是否允许企业版客户端使用定时任务（cron）功能。
   * 由 Moss 管理端控制，仅企业模式生效；null/undefined 视为开启（默认 true）。
   * Whether the enterprise client may use the cron feature. Controlled by the
   * Moss admin; enterprise mode only. null/undefined → enabled (default true).
   */
  client_cron_enabled?: boolean | null;
  /**
   * 企业版客户端对话流中是否默认显示工具调用。由 Moss 管理端控制，仅为默认值，
   * 客户端用户可在本地设置中覆盖；null/undefined 视为显示（默认 true）。
   * Default for whether the enterprise client shows tool calls in the chat
   * stream. Controlled by the Moss admin as a default only — client users may
   * override locally. null/undefined → shown (default true).
   */
  client_show_tool_calls?: boolean | null;
}

/**
 * 租户配置接口响应结构
 */
export interface TenantConfigResponse {
  success: boolean;
  data?: TenantConfig;
  msg?: string;
}

export type TenantConfigInput = Partial<Record<keyof TenantConfig, string | boolean | null | undefined>>;

export const TENANT_CONFIG_STORAGE_KEY = 'sudowork_tenant_config';

/**
 * 默认租户配置
 * 当接口未返回或字段为空时使用此默认值
 */
export const DEFAULT_TENANT_CONFIG: Required<TenantConfig> = {
  logo: undefined,
  app_name: 'SudoWork',
  top_name: 'SudoWork',
  login_desp: 'AgentOps | 办公专家',
  about_name: 'SudoWork',
  app_company_name: '北京数牍科技有限公司',
  client_cron_enabled: true,
  client_show_tool_calls: true,
};

export function resolveTenantConfig(config?: TenantConfigInput | null): Required<TenantConfig> {
  return {
    logo: (config?.logo as string | undefined) || DEFAULT_TENANT_CONFIG.logo,
    app_name: (config?.app_name as string | undefined) || DEFAULT_TENANT_CONFIG.app_name,
    top_name: (config?.top_name as string | undefined) || DEFAULT_TENANT_CONFIG.top_name,
    login_desp: (config?.login_desp as string | undefined) || DEFAULT_TENANT_CONFIG.login_desp,
    about_name: (config?.about_name as string | undefined) || DEFAULT_TENANT_CONFIG.about_name,
    app_company_name: (config?.app_company_name as string | undefined) || DEFAULT_TENANT_CONFIG.app_company_name,
    // Only an explicit `false` disables cron; null/undefined → default on.
    client_cron_enabled: config?.client_cron_enabled === false ? false : true,
    // Only an explicit `false` hides tool calls; null/undefined → default shown.
    client_show_tool_calls: config?.client_show_tool_calls === false ? false : true,
  };
}
