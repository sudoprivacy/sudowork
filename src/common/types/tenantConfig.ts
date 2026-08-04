/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 租户配置接口响应字段
 * Tenant configuration returned by the server.
 */
export interface TenantConfig {
  /** Logo 图片 base64 编码（如：data:image/png;base64,xxx） */
  logo?: string | null;
  /** 暗色模式下使用的 Logo；未配置时暗色模式仍使用 `logo` */
  logoDark?: string | null;
  /** App Name - 登录页标题、首页侧栏名称 */
  app_name?: string | null;
  /** Top Name - 客户端顶部 header（标题栏 Titlebar）显示 */
  top_name?: string | null;
  /** Login Description - 登录页副标题 */
  login_desp?: string | null;
  /** About Name - 关于页标题 */
  about_name?: string | null;
  /** 公司主体名称 - 关于页公司信息 */
  app_company_name?: string | null;
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
   * stream. Controlled by Moss as a default only; null/undefined → shown.
   */
  client_show_tool_calls?: boolean | null;
  /**
   * 企业版客户端上传到会话工作区的单个文件大小上限（字节）。由 Moss 管理端控制，
   * 仅企业模式生效；null/undefined 视为默认 20MB。客户端在上传前用它做大小校验，
   * 服务端同样强制此上限。
   * Max bytes per uploaded workspace file; null/undefined → 20MB.
   */
  workspace_upload_limit_bytes?: number | null;
}

/**
 * 租户配置接口响应结构
 */
export interface TenantConfigResponse {
  success: boolean;
  data?: TenantConfig;
  msg?: string;
}

export type TenantConfigInput = { [K in keyof TenantConfig]?: TenantConfig[K] | null };

/**
 * Default single-file workspace upload limit (20MB) when the tenant config
 * does not specify one. Mirrors the Moss server default.
 */
export const DEFAULT_WORKSPACE_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

/**
 * 解析服务端租户策略。只有显式 `false` 会关闭布尔能力；无效上传限制回退为 20MB。
 */
export function resolveTenantPolicy(config?: TenantConfigInput | Record<string, unknown> | null) {
  return {
    // Only an explicit `false` disables cron; null/undefined → default on.
    client_cron_enabled: config?.client_cron_enabled === false ? false : true,
    // Only an explicit `false` hides tool calls; null/undefined → default shown.
    client_show_tool_calls: config?.client_show_tool_calls === false ? false : true,
    // Use the configured limit only when it is a positive number; otherwise default.
    workspace_upload_limit_bytes: typeof config?.workspace_upload_limit_bytes === 'number' && Number.isFinite(config.workspace_upload_limit_bytes) && config.workspace_upload_limit_bytes > 0 ? config.workspace_upload_limit_bytes : DEFAULT_WORKSPACE_UPLOAD_LIMIT_BYTES,
  };
}
