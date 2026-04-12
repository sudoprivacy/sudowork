/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { serviceManager } from './ServiceManager';

const TAG = 'ComponentHealthMonitor';

interface ComponentStatus {
  installed: boolean;
  running?: boolean;
  needsAction: boolean;
  actionType?: 'install' | 'start';
}

/**
 * 自动组件健康监控服务
 *
 * 启动 3 分钟后开始检测核心服务健康状态，之后每隔 3 分钟执行一次。
 * 每次自动安装/启动成功后，会进入 3 分钟宽限期，再判断端口是否真的就绪。
 */
class ComponentHealthMonitor {
  private pollingInterval: NodeJS.Timeout | null = null;
  private startupDelayTimer: NodeJS.Timeout | null = null;
  private isChecking = false;
  private consecutiveFailures = new Map<string, number>();
  private readonly startupGraceUntil = new Map<string, number>();
  private readonly MAX_FAILURES = 3;
  private readonly CHECK_INTERVAL_MS = 3 * 60 * 1000;
  private readonly INITIAL_DELAY_MS = 3 * 60 * 1000;
  private readonly STARTUP_GRACE_MS = 3 * 60 * 1000;

  private readonly COMPONENTS = ['sudoclaw', 'nexus'] as const;

  /**
   * 启动健康监控
   */
  async start(): Promise<void> {
    mainLog(TAG, 'Starting component health monitor...');

    if (this.pollingInterval || this.startupDelayTimer) {
      mainLog(TAG, 'Component health monitor is already scheduled');
      return;
    }

    // 延迟 3 分钟启动，等待核心进程完成拉起
    this.startupDelayTimer = setTimeout(() => {
      this.startupDelayTimer = null;
      this.pollingInterval = setInterval(() => {
        void this.checkAndHeal();
      }, this.CHECK_INTERVAL_MS);
      void this.checkAndHeal();
    }, this.INITIAL_DELAY_MS);
  }

  /**
   * 停止健康监控
   */
  async stop(): Promise<void> {
    mainLog(TAG, 'Stopping component health monitor...');
    if (this.startupDelayTimer) {
      clearTimeout(this.startupDelayTimer);
      this.startupDelayTimer = null;
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * 执行健康检查和自愈
   */
  private async checkAndHeal(): Promise<void> {
    if (this.isChecking) {
      mainLog(TAG, 'Previous check still in progress, skipping');
      return;
    }
    this.isChecking = true;

    try {
      for (const component of this.COMPONENTS) {
        const graceUntil = this.startupGraceUntil.get(component) || 0;
        if (graceUntil > Date.now()) {
          const remainingMs = graceUntil - Date.now();
          mainLog(TAG, `Skipping ${component} health check during startup grace period (${remainingMs}ms remaining)`);
          continue;
        }

        const failures = this.consecutiveFailures.get(component) || 0;
        mainLog(TAG, `Checking ${component} (failures: ${failures}, interval: ${this.CHECK_INTERVAL_MS}ms)`);

        const status = await this.checkComponentHealth(component);

        if (status.needsAction) {
          if (failures >= this.MAX_FAILURES) {
            mainWarn(TAG, `${component} 连续失败 ${failures} 次，跳过本次检查`);
            continue;
          }

          const healed = await this.healComponent(component, status);
          if (healed) {
            this.startupGraceUntil.set(component, Date.now() + this.STARTUP_GRACE_MS);
            this.consecutiveFailures.delete(component);
            mainLog(TAG, `${component} 自愈成功，进入 ${this.STARTUP_GRACE_MS}ms 启动宽限期`);
          } else {
            this.consecutiveFailures.set(component, failures + 1);
            mainWarn(TAG, `${component} 自愈失败，连续失败次数：${failures + 1}`);
          }
          // 每次只处理一个组件，避免并发冲突
          break;
        } else {
          // 组件正常，重置失败计数
          this.consecutiveFailures.delete(component);
        }
      }
    } catch (err) {
      mainError(TAG, 'Health check failed', err);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 检查单个组件的健康状态
   */
  private async checkComponentHealth(component: string): Promise<ComponentStatus> {
    switch (component) {
      case 'sudoclaw':
        return this.checkSudoclawHealth();
      case 'nexus':
        return this.checkNexusHealth();
      default:
        return { installed: false, needsAction: false };
    }
  }

  /**
   * 检查 Sudoclaw 状态
   */
  private async checkSudoclawHealth(): Promise<ComponentStatus> {
    const { isSudoclawInstalled } = await import('../sudoclaw/SudoclawInstallService');
    const { checkSudoclawHealth } = await import('../sudoclaw/sudoclawHealth');
    const installed = isSudoclawInstalled();

    if (!installed) {
      return { installed: false, needsAction: true, actionType: 'install' };
    }

    try {
      const running = await checkSudoclawHealth('127.0.0.1', 17863, 2000);
      return { installed: true, running, needsAction: !running, actionType: 'start' };
    } catch (err) {
      mainLog(TAG, `Sudoclaw health check failed: ${err instanceof Error ? err.message : String(err)}`);
      return { installed: true, running: false, needsAction: true, actionType: 'start' };
    }
  }

  /**
   * 检查 Nexus 状态
   */
  private async checkNexusHealth(): Promise<ComponentStatus> {
    const { dynamicNexusService } = await import('../nexus/DynamicNexusService');
    const installed = await dynamicNexusService.checkInstalled();

    if (!installed) {
      return { installed: false, needsAction: true, actionType: 'install' };
    }

    // 检查 HTTP 健康
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch('http://localhost:12012/health', { signal: controller.signal });
      clearTimeout(timeoutId);
      const running = res.ok;
      return { installed: true, running, needsAction: !running, actionType: 'start' };
    } catch (err) {
      mainLog(TAG, `Nexus health check failed: ${err instanceof Error ? err.message : String(err)}`);
      return { installed: true, running: false, needsAction: true, actionType: 'start' };
    }
  }

  /**
   * 自愈组件
   */
  private async healComponent(component: string, status: ComponentStatus): Promise<boolean> {
    try {
      if (status.actionType === 'install') {
        mainLog(TAG, `开始安装 ${component}...`);
        return await this.installComponent(component);
      } else if (status.actionType === 'start') {
        mainLog(TAG, `开始启动 ${component}...`);
        return await this.startComponent(component);
      }
      return false;
    } catch (err) {
      mainError(TAG, `${component} 自愈失败`, err);
      return false;
    }
  }

  /**
   * 安装组件
   */
  private async installComponent(component: string): Promise<boolean> {
    try {
      switch (component) {
        case 'sudoclaw': {
          const { ensureSudoclawInstalled } = await import('../sudoclaw/SudoclawInstallService');
          const result = await ensureSudoclawInstalled({ forceReinstall: false });
          return result.installed;
        }
        case 'nexus': {
          const { dynamicNexusService } = await import('../nexus/DynamicNexusService');
          await dynamicNexusService.install();
          return true;
        }
        default:
          return false;
      }
    } catch (err) {
      mainError(TAG, `${component} install failed`, err);
      return false;
    }
  }

  /**
   * 启动组件服务
   */
  private async startComponent(component: string): Promise<boolean> {
    try {
      switch (component) {
        case 'sudoclaw':
          await serviceManager.startOpenClaw();
          return true;
        case 'nexus':
          await serviceManager.startNexus();
          return true;
        default:
          return false;
      }
    } catch (err) {
      mainError(TAG, `${component} start failed`, err);
      return false;
    }
  }
}

export const componentHealthMonitor = new ComponentHealthMonitor();
