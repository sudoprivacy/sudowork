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

/**
 * 默认租户配置
 * 当接口未返回或字段为空时使用此默认值
 */
export const DEFAULT_TENANT_CONFIG: Required<TenantConfig> = {
  logo: undefined,
  app_name: 'SudoClaw',
  top_name: 'SudoClaw',
  login_desp: 'AgentOps | 办公专家',
  about_name: 'SudoClaw',
  app_company_name: '北京数牍科技有限公司',
};