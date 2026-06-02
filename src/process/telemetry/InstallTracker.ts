/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * InstallTracker - 安装过程追踪
 *
 * 追踪内容：
 * - 安装 ID
 * - 安装状态 (success/failed)
 * - 安装时长
 * - 安装类型 (fresh/update)
 * - 错误信息 (如果失败)
 */

import { app } from 'electron';
import crypto from 'crypto';
import { buildVersion } from '../../common/buildInfo';
import { getTelemetryReporter } from './TelemetryBatchReporter';
import type { InstallStatus, InstallType, InstallData } from '../../shared/types/telemetry';
import { mainLog, mainWarn } from '../utils/mainLogger';

// ============================================================
// 类型定义
// ============================================================

/** 安装追踪状态 */
interface InstallTrackingState {
  installId: string;
  startTime: number;
  installType: InstallType;
  previousVersion?: string;
}

// ============================================================
// 常量定义
// ============================================================

/** 安装 ID 存储键 */
const INSTALL_ID_KEY = 'telemetry.installId';

/** 安装类型存储键 */
const INSTALL_TYPE_KEY = 'telemetry.installType';

/** 之前的版本存储键 */
const PREVIOUS_VERSION_KEY = 'telemetry.previousVersion';

// ============================================================
// InstallTracker 类
// ============================================================

/**
 * 安装追踪器
 *
 * 单例模式，追踪应用安装/更新过程
 */
export class InstallTracker {
  private static instance: InstallTracker | null = null;

  /** 安装追踪状态 */
  private trackingState: InstallTrackingState | null = null;

  /** 已生成的安装 ID */
  private installId: string | null = null;

  /** 私有构造函数 */
  private constructor() {}

  /** 获取单例实例 */
  public static getInstance(): InstallTracker {
    if (!InstallTracker.instance) {
      InstallTracker.instance = new InstallTracker();
    }
    return InstallTracker.instance;
  }

  /**
   * 初始化安装追踪
   *
   * 在应用启动时调用，检测安装类型
   */
  public async initialize(): Promise<void> {
    // 生成或获取安装 ID
    const storedId = await this.getStoredInstallId();
    const storedVersion = await this.getStoredPreviousVersion();

    const currentVersion = buildVersion;

    // 判断安装类型
    let installType: InstallType;
    if (storedVersion && storedVersion !== currentVersion) {
      installType = 'update';
      this.installId = storedId; // 保持原有 ID
    } else {
      installType = 'fresh';
      this.installId = this.generateInstallId(); // 生成新 ID
    }

    // 开始追踪
    this.trackingState = {
      installId: this.installId,
      startTime: Date.now(),
      installType,
      previousVersion: storedVersion,
    };
  }

  /**
   * 标记安装成功
   *
   * 在应用完全启动成功后调用
   */
  public async markSuccess(): Promise<void> {
    if (!this.trackingState) {
      mainWarn('InstallTracker', 'No tracking state, cannot mark success');
      return;
    }

    const duration = Date.now() - this.trackingState.startTime;

    const installData: InstallData = {
      install_id: this.trackingState.installId,
      status: 'success',
      duration_ms: duration,
      install_type: this.trackingState.installType,
      previous_version: this.trackingState.previousVersion,
    };

    // 上报安装事件
    getTelemetryReporter().record('install', installData);

    // 存储当前版本和安装 ID
    await this.storeInstallInfo();
  }

  /**
   * 标记安装失败
   *
   * 在安装过程中出错时调用
   */
  public async markFailed(errorMessage: string): Promise<void> {
    if (!this.trackingState) {
      mainWarn('InstallTracker', 'No tracking state, cannot mark failed');
      return;
    }

    const duration = Date.now() - this.trackingState.startTime;

    const installData: InstallData = {
      install_id: this.trackingState.installId,
      status: 'failed',
      duration_ms: duration,
      install_type: this.trackingState.installType,
      previous_version: this.trackingState.previousVersion,
      error_message: errorMessage,
    };

    mainWarn('InstallTracker', `Install failed: ${this.trackingState.installId}, error: ${errorMessage}`);

    // 上报安装失败事件
    getTelemetryReporter().record('install', installData);
  }

  /**
   * 获取安装 ID
   */
  public getInstallId(): string | null {
    return this.installId;
  }

  /**
   * 获取安装类型
   */
  public getInstallType(): InstallType | null {
    return this.trackingState?.installType || null;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 生成安装 ID */
  private generateInstallId(): string {
    return `inst_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /** 获取存储的安装 ID */
  private async getStoredInstallId(): Promise<string | null> {
    try {
      const { ProcessConfig } = require('../initStorage');
      return await ProcessConfig.get(INSTALL_ID_KEY);
    } catch {
      return null;
    }
  }

  /** 获取存储的之前版本 */
  private async getStoredPreviousVersion(): Promise<string | null> {
    try {
      const { ProcessConfig } = require('../initStorage');
      return await ProcessConfig.get(PREVIOUS_VERSION_KEY);
    } catch {
      return null;
    }
  }

  /** 存储安装信息 */
  private async storeInstallInfo(): Promise<void> {
    try {
      const { ProcessConfig } = require('../initStorage');
      const currentVersion = buildVersion;

      await ProcessConfig.set(INSTALL_ID_KEY, this.installId);
      await ProcessConfig.set(PREVIOUS_VERSION_KEY, currentVersion);
    } catch (error) {
      mainWarn('InstallTracker', 'Failed to store install info:', error);
    }
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取安装追踪器实例 */
export const getInstallTracker = (): InstallTracker => {
  return InstallTracker.getInstance();
};

/** 初始化安装追踪 */
export const initInstallTracking = async (): Promise<void> => {
  await getInstallTracker().initialize();
};

/** 标记安装成功 */
export const markInstallSuccess = async (): Promise<void> => {
  await getInstallTracker().markSuccess();
};

/** 标记安装失败 */
export const markInstallFailed = async (errorMessage: string): Promise<void> => {
  await getInstallTracker().markFailed(errorMessage);
};

/** 获取安装 ID */
export const getInstallId = (): string | null => {
  return getInstallTracker().getInstallId();
};

/** 获取安装类型 */
export const getInstallType = (): InstallType | null => {
  return getInstallTracker().getInstallType();
};
