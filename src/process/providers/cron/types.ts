/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CronJob } from '@process/services/cron/CronStore';
import type { CreateCronJobParams } from '@process/services/cron/CronService';

/**
 * Cron Provider interface
 * 定时任务 Provider 接口
 *
 * Unified abstraction for cron job CRUD and execution.
 * 定时任务 CRUD 和执行的统一抽象层。
 * Supports both local (database-backed) and remote (Moss Server) implementations.
 * 支持本地（数据库）和远程（Moss Server）两种实现。
 */
export interface ICronProvider {
  /** Provider type identifier / Provider 类型标识 */
  readonly type: 'local' | 'remote';

  // ========== Job CRUD / 任务 CRUD ==========

  /**
   * List all cron jobs
   * 列出所有定时任务
   */
  listJobs(): Promise<CronJob[]>;

  /**
   * List cron jobs bound to a specific conversation
   * 列出绑定到特定会话的定时任务
   */
  listJobsByConversation(conversationId: string): Promise<CronJob[]>;

  /**
   * List cron jobs owned by a digital employee
   * 列出某个数字员工所属的定时任务
   */
  listJobsByDigitalEmployee(employeeId: string): Promise<CronJob[]>;

  /**
   * Get a single cron job by ID
   * 根据 ID 获取单个定时任务
   */
  getJob(jobId: string): Promise<CronJob | null>;

  /**
   * Add a new cron job
   * 添加新的定时任务
   */
  addJob(params: CreateCronJobParams): Promise<CronJob>;

  /**
   * Update a cron job
   * 更新定时任务
   */
  updateJob(jobId: string, updates: Partial<CronJob>): Promise<CronJob>;

  /**
   * Remove a cron job
   * 删除定时任务
   */
  removeJob(jobId: string): Promise<void>;

  /**
   * Trigger a job immediately
   * 立即触发任务
   */
  triggerJob(jobId: string): Promise<void>;

  // ========== Power Management (Local only) / 电源管理（仅本地） ==========

  /**
   * Get power save active status
   * 获取省电模式状态
   * Only available in local provider
   */
  getPowerSaveActive?(): Promise<boolean>;

  /**
   * Set power save mode
   * 设置省电模式
   * Only available in local provider
   */
  setPowerSave?(enabled: boolean): Promise<void>;
}
