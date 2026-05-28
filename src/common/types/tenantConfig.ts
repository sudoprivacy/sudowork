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
}

/**
 * 租户配置接口响应结构
 */
export interface TenantConfigResponse {
  success: boolean;
  data?: TenantConfig;
  msg?: string;
}

export type TenantConfigInput = Partial<Record<keyof TenantConfig, string | null | undefined>>;

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
};

export function resolveTenantConfig(config?: TenantConfigInput | null): Required<TenantConfig> {
  return {
    logo: config?.logo || DEFAULT_TENANT_CONFIG.logo,
    app_name: config?.app_name || DEFAULT_TENANT_CONFIG.app_name,
    top_name: config?.top_name || DEFAULT_TENANT_CONFIG.top_name,
    login_desp: config?.login_desp || DEFAULT_TENANT_CONFIG.login_desp,
    about_name: config?.about_name || DEFAULT_TENANT_CONFIG.about_name,
    app_company_name: config?.app_company_name || DEFAULT_TENANT_CONFIG.app_company_name,
  };
}
