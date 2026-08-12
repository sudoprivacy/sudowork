/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IS_OFFLINE_BUILD } from '@/common/buildMode';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { isNodeInstalled } from '../nodeRuntime/NodeRuntimeService';
import { initStatusManager } from '../initStatus';
import { dynamicNexusVfsService as installedNexusService } from '../nexus-vfs/DynamicNexusVfsService';
import { isScodeInstalled as isInstalledScode, ensureScodeInstalled, getScodeVersionState, ensureAgentsMdRules } from '../scode/ScodeInstallService';
import { createNexusSetupLogSnapshot, getNexusStepProgressFromSetupStatus, getNexusStepStateFromSetupStatus, shouldLogNexusSetupStatus, type NexusSetupLogSnapshot } from './nexusSetupStatus';

const TAG = 'RuntimeInstaller';

/**
 * Ensures the core runtimes required for startup (Node.js, Sudocode, Nexus) are installed.
 *
 * Extracted from ServiceManager so that runtime installation is decoupled
 * from service lifecycle management.
 */
class RuntimeInstaller {
  primeStatusForStartup(): void {
    // Always use 'startup' mode for simpler UI
    initStatusManager.setDisplayMode('startup');
  }

  /**
   * Check and install all runtimes as needed.
   * Returns true if startup should proceed to service starts,
   * false if a critical install failure occurred.
   */
  async ensureAll(options?: { startNexus?: () => Promise<void> }): Promise<boolean> {
    // Always ensure AGENTS.md rules are in place on every startup
    ensureAgentsMdRules();

    const isWin32 = process.platform === 'win32';

    // ── Fast synchronous pre-check (no awaits, only sync fs) ────────────────
    // Running before the first `await` means this executes synchronously in the
    // same event-loop tick as `void serviceManager.startup()`, so
    // initStatusManager is set to 'ready' before the renderer can poll
    // getStatus via IPC. This prevents the brief "组件安装中" flash on
    // subsequent launches.
    const resDir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');

    const fastNodeOk = isNodeInstalled();
    const fastScodeOk = isInstalledScode();
    const fastNexusOk = installedNexusService.checkInstalledSync();

    const markFastInstalledSteps = (): void => {
      initStatusManager.setStepState('git', 'done', 'Git 环境检查已跳过');
      initStatusManager.setStepProgress('git', 100, 'Git 环境检查已跳过');
      if (fastNodeOk) {
        initStatusManager.setStepState('node', 'done', 'Node.js 运行时已就绪');
        initStatusManager.setStepProgress('node', 100, 'Node.js 运行时已就绪');
      }

      if (fastScodeOk) {
        initStatusManager.setStepState('scode', 'done', 'Sudocode 文件已就绪');
        initStatusManager.setStepProgress('scode', 100, 'Sudocode 文件已就绪');
      }

      if (fastNexusOk) {
        initStatusManager.setStepState('nexus', options?.startNexus ? 'pending' : 'done', options?.startNexus ? '等待启动 Nexus...' : 'Nexus 文件已就绪');
        initStatusManager.setStepProgress('nexus', options?.startNexus ? 88 : 100, options?.startNexus ? '等待启动 Nexus...' : 'Nexus 文件已就绪');
      }
    };

    mainLog(TAG, `Fast check: Git=skipped, Node=${fastNodeOk}, Sudocode=${fastScodeOk}, Nexus=${fastNexusOk}`);

    const startCriticalServices = async (): Promise<boolean> => {
      if (!options?.startNexus) {
        return true;
      }

      initStatusManager.setStepState('nexus', 'active', '正在启动 Nexus 服务...');
      initStatusManager.setStepProgress('nexus', 92, '正在启动 Nexus 服务...');
      await options.startNexus();
      return true;
    };

    if (fastNodeOk && fastScodeOk && fastNexusOk) {
      const scodeVersionState = getScodeVersionState();

      if (!scodeVersionState.needsUpgrade) {
        mainLog(TAG, 'All runtimes already installed, skipping installation');
        initStatusManager.setDisplayMode('startup');
        markFastInstalledSteps();
        // Ensure browser-panel MCP is registered even when the rest of the
        // install pipeline short-circuits (returning users with everything
        // already in place). Idempotent + never throws.
        try {
          const { ensureBrowserPanelMcpRegistered } = await import('../mcpServices/SudoworkBuiltinMcpRegistration');
          await ensureBrowserPanelMcpRegistered();
        } catch (err) {
          mainLog(TAG, `browser-panel MCP registration skipped: ${String(err)}`);
        }
        return startCriticalServices();
      }

      mainLog(TAG, `Version mismatch: Nexus=ok, Sudocode=${scodeVersionState.needsUpgrade ? `${scodeVersionState.installedVersion}→${scodeVersionState.bundledVersion}` : 'ok'}`);
    }
    // ── End fast check ──────────────────────────────────────────────────────

    // ── At least one component appears to be missing — do full async check ──
    mainLog(TAG, 'Checking runtime dependencies...');
    const [nexusModule, gitModule] = await Promise.all([import('../nexus-vfs/DynamicNexusVfsService'), import('../git/GitInstallService')]);
    const { dynamicNexusVfsService } = nexusModule;
    const { ensureGitInstalled, isGitInstalled } = gitModule;

    const nodeInstalled = isNodeInstalled();
    const scodeInstalled = isInstalledScode();
    const scodeVersionState = getScodeVersionState();
    const nexusInstalledPromise = dynamicNexusVfsService.checkInstalled();
    const gitInstalledPromise = isGitInstalled();
    const [nexusInstalled, gitInstalled] = await Promise.all([nexusInstalledPromise, gitInstalledPromise]);

    const fullCheckSummary = `Git=${gitInstalled}, Node=${nodeInstalled}, Sudocode=${scodeInstalled}, Nexus=${nexusInstalled}, ` + `SudocodeUpgrade=${scodeVersionState.needsUpgrade}`;
    mainLog(TAG, `Full check: ${fullCheckSummary}`);

    // Full check may confirm everything is fine (fast check had a false negative)
    if (nodeInstalled && scodeInstalled && nexusInstalled && !scodeVersionState.needsUpgrade) {
      mainLog(TAG, 'All runtimes confirmed installed');
      initStatusManager.setDisplayMode('startup');
      markFastInstalledSteps();
      return startCriticalServices();
    }

    // Node still requires a local resource bundle. Sudocode installs are
    // version-driven and can fall back to remote download inside
    // ensureScodeInstalled(), so do not gate it on local resources here.
    const nodeResExt = isWin32 ? 'zip' : 'tar.gz';
    const nodeResName = `node-${process.platform}-${process.arch}.${nodeResExt}`;
    const hasNodeResource = fs.existsSync(path.join(resDir, nodeResName));

    const willInstallNode = !nodeInstalled && hasNodeResource;
    const willInstallScode = !scodeInstalled || scodeVersionState.needsUpgrade;
    const willInstallNexus = !nexusInstalled;

    if (willInstallNode || willInstallScode || willInstallNexus) {
      initStatusManager.setDisplayMode('startup');
      initStatusManager.setStatus('installing', '正在并行准备运行环境...', 5);
    }

    type RuntimeStepId = 'git' | 'node' | 'scode' | 'nexus';
    type TaskResult = { step: RuntimeStepId; ok: boolean; required: boolean; error?: string };

    const markStepDone = (step: RuntimeStepId, detail: string): void => {
      initStatusManager.setStepState(step, 'done', detail);
      initStatusManager.setStepProgress(step, 100, detail);
    };

    const markStepActive = (step: RuntimeStepId, detail: string, progress = 0): void => {
      initStatusManager.setStepState(step, 'active', detail);
      initStatusManager.setStepProgress(step, progress, detail);
    };

    const markStepError = (step: RuntimeStepId, detail: string, progress = 0): void => {
      initStatusManager.setStepState(step, 'error', detail);
      initStatusManager.setStepProgress(step, progress, detail);
    };

    const capInstallProgress = (percent: number, cap: number): number => {
      return Math.max(0, Math.min(cap, percent));
    };

    if (gitInstalled) {
      markStepDone('git', 'Git 已就绪');
      // Git 不是离线版 ready 的前置条件，缺失时不能调用 Homebrew 或系统软件源。
    } else if (IS_OFFLINE_BUILD) {
      markStepDone('git', 'Git 未安装，内网版已跳过自动安装');
    } else {
      initStatusManager.setStepState('git', 'pending', '等待安装 Git...');
      initStatusManager.setStepProgress('git', 0, '等待安装 Git...');
    }

    if (nodeInstalled) {
      markStepDone('node', 'Node.js 运行时已就绪');
    } else if (willInstallNode) {
      initStatusManager.setStepState('node', 'pending', '等待安装 Node.js 运行时...');
      initStatusManager.setStepProgress('node', 0, '等待安装 Node.js 运行时...');
    } else {
      markStepError('node', '未找到 Node.js 安装资源');
    }

    if (scodeInstalled && !scodeVersionState.needsUpgrade) {
      markStepDone('scode', 'Sudocode 文件已就绪');
    } else {
      initStatusManager.setStepState('scode', 'pending', '等待安装 Sudocode...');
      initStatusManager.setStepProgress('scode', 0, '等待安装 Sudocode...');
    }

    if (nexusInstalled) {
      if (options?.startNexus) {
        initStatusManager.setStepState('nexus', 'pending', '等待启动 Nexus...');
        initStatusManager.setStepProgress('nexus', 88, '等待启动 Nexus...');
      } else {
        markStepDone('nexus', 'Nexus 文件已就绪');
      }
    } else {
      initStatusManager.setStepState('nexus', 'pending', '等待安装 Nexus...');
      initStatusManager.setStepProgress('nexus', 0, '等待安装 Nexus...');
    }

    const gitTask: Promise<TaskResult> = (async () => {
      if (gitInstalled || IS_OFFLINE_BUILD) {
        return { step: 'git', ok: true, required: false };
      }

      let progress = 0;
      try {
        mainLog(TAG, 'Installing Git (non-blocking)...');
        markStepActive('git', '开始安装 Git...', 0);
        initStatusManager.addLog('开始安装 Git...');

        const ok = await ensureGitInstalled((message) => {
          progress = Math.min(progress + 20, 90);
          initStatusManager.setStepProgress('git', progress, message);
        });

        if (ok) {
          markStepDone('git', 'Git 已安装');
          initStatusManager.addLog('✓ Git 安装完成');
          return { step: 'git', ok: true, required: false };
        }

        const error = 'Git 安装失败，请手动安装';
        markStepError('git', error, Math.max(progress, 10));
        initStatusManager.addLog(`⚠ ${error}`);
        return { step: 'git', ok: false, required: false, error };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        mainError(TAG, 'Git install failed', err);
        markStepError('git', `Git 安装失败: ${error}`, Math.max(progress, 10));
        initStatusManager.addLog(`⚠ Git 安装失败: ${error}`);
        return { step: 'git', ok: false, required: false, error };
      }
    })();

    const nodeTask: Promise<TaskResult> = (async () => {
      if (nodeInstalled) {
        return { step: 'node', ok: true, required: true };
      }
      if (!willInstallNode) {
        return { step: 'node', ok: false, required: true, error: '未找到 Node.js 安装资源' };
      }

      try {
        mainLog(TAG, 'Installing Node.js runtime...');
        markStepActive('node', '准备解压 Node.js 运行时...', 0);
        initStatusManager.addLog('开始安装 Node.js 运行时...');
        const { ensureNodeInstalled } = await import('../nodeRuntime/NodeRuntimeService');
        const ok = await ensureNodeInstalled((percent) => {
          initStatusManager.setStepProgress('node', percent, `正在解压 Node.js 运行时... ${percent}%`);
        });
        if (!ok) {
          const error = 'Node.js 运行时安装未完成';
          markStepError('node', error);
          initStatusManager.addLog(`⚠ ${error}`);
          return { step: 'node', ok: false, required: true, error };
        }
        markStepDone('node', 'Node.js 运行时已安装');
        initStatusManager.addLog('✓ Node.js 运行时安装完成');
        return { step: 'node', ok: true, required: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        mainError(TAG, 'Node.js runtime install failed', err);
        markStepError('node', `Node.js 运行时安装失败: ${error}`);
        initStatusManager.addLog(`⚠ Node.js 运行时安装失败: ${error}`);
        return { step: 'node', ok: false, required: true, error };
      }
    })();

    const scodeTask: Promise<TaskResult> = (async () => {
      if (scodeInstalled && !scodeVersionState.needsUpgrade) {
        return { step: 'scode', ok: true, required: true };
      }

      try {
        const action = scodeVersionState.needsUpgrade ? `升级 Sudocode ${scodeVersionState.installedVersion} → ${scodeVersionState.bundledVersion}` : '安装 Sudocode';
        mainLog(TAG, action);
        markStepActive('scode', '准备安装 Sudocode...', 0);
        initStatusManager.addLog(`开始${action}...`);

        const ok = await ensureScodeInstalled({
          forceReinstall: scodeVersionState.needsUpgrade,
          onProgress: (percent) => {
            const progress = capInstallProgress(percent, 100);
            initStatusManager.setStepProgress('scode', progress, `正在安装 Sudocode... ${percent}%`);
          },
        });

        if (!ok) {
          const error = 'Sudocode 安装未完成';
          mainError(TAG, error);
          markStepError('scode', error);
          initStatusManager.addLog(`⚠ ${error}`);
          return { step: 'scode', ok: false, required: true, error };
        }

        try {
          const { acpDetector } = await import('@/agent/acp/AcpDetector');
          await acpDetector.rescanCliAgents();
          initStatusManager.addLog('✓ Sudocode agent 列表已刷新');
        } catch (error) {
          mainWarn(TAG, 'Sudocode installed but agent rescan failed', error);
          initStatusManager.addLog(`⚠ Sudocode 安装完成，但 agent 列表刷新失败: ${error instanceof Error ? error.message : String(error)}`);
        }

        markStepDone('scode', 'Sudocode 文件已就绪');
        initStatusManager.addLog('✓ Sudocode 安装完成');
        return { step: 'scode', ok: true, required: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        mainError(TAG, 'Sudocode install failed', err);
        markStepError('scode', `Sudocode 安装失败: ${error}`);
        initStatusManager.addLog(`⚠ Sudocode 安装失败: ${error}`);
        return { step: 'scode', ok: false, required: true, error };
      }
    })();

    const nexusTask: Promise<TaskResult> = (async () => {
      if (nexusInstalled) {
        if (!options?.startNexus) {
          return { step: 'nexus', ok: true, required: true };
        }
        try {
          markStepActive('nexus', '正在启动 Nexus 服务...', 92);
          initStatusManager.addLog('开始启动 Nexus 服务...');
          await options.startNexus();
          return { step: 'nexus', ok: true, required: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          markStepError('nexus', `Nexus 启动失败: ${error}`, 92);
          initStatusManager.addLog(`⚠ Nexus 启动失败: ${error}`);
          return { step: 'nexus', ok: false, required: true, error };
        }
      }

      try {
        const action = '安装 Nexus';
        mainLog(TAG, action);
        markStepActive('nexus', '准备安装 Nexus...', 0);
        initStatusManager.addLog(`开始${action}...`);

        let lastLoggedSetupStatus: NexusSetupLogSnapshot | null = null;
        const unsubNexus = dynamicNexusVfsService.onSetupStatus((nexusStatus) => {
          const currentProgress = initStatusManager.getStatus().stepProgress?.nexus ?? 0;
          const progress = getNexusStepProgressFromSetupStatus(nexusStatus, currentProgress);
          const state = getNexusStepStateFromSetupStatus(nexusStatus);
          initStatusManager.setStepState('nexus', state, nexusStatus.message);
          initStatusManager.setStepProgress('nexus', progress, nexusStatus.message);

          if (shouldLogNexusSetupStatus(lastLoggedSetupStatus, nexusStatus)) {
            initStatusManager.addLog(`[Nexus] ${nexusStatus.message}`);
            lastLoggedSetupStatus = createNexusSetupLogSnapshot(nexusStatus);
          }
        });

        try {
          await dynamicNexusVfsService.install();
        } finally {
          unsubNexus();
        }

        if (!options?.startNexus) {
          markStepDone('nexus', 'Nexus 文件已就绪');
          initStatusManager.addLog('✓ Nexus 安装完成');
          return { step: 'nexus', ok: true, required: true };
        }

        markStepActive('nexus', 'Nexus 文件已就绪，正在启动服务...', 92);
        initStatusManager.addLog('✓ Nexus 安装完成，开始启动服务...');
        await options.startNexus();
        return { step: 'nexus', ok: true, required: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        mainError(TAG, 'Nexus install failed', err);
        const prefix = nexusInstalled ? 'Nexus 启动失败' : 'Nexus 安装失败';
        markStepError('nexus', `${prefix}: ${error}`);
        initStatusManager.addLog(`⚠ ${prefix}: ${error}`);
        return { step: 'nexus', ok: false, required: true, error };
      }
    })();

    const results = await Promise.all([gitTask, nodeTask, scodeTask, nexusTask]);
    const failedRequired = results.filter((result) => result.required && !result.ok);
    if (failedRequired.length > 0) {
      const error = `以下组件安装未完成: ${failedRequired.map((item) => item.step).join('、')}`;
      initStatusManager.setStatus('error', '安装失败', 0, error);
      return false;
    }

    try {
      const { ensureBrowserPanelMcpRegistered } = await import('../mcpServices/SudoworkBuiltinMcpRegistration');
      await ensureBrowserPanelMcpRegistered();
    } catch (err) {
      mainLog(TAG, `browser-panel MCP registration skipped: ${String(err)}`);
    }

    initStatusManager.setStatus('installing', '正在校验组件状态...', 96);
    mainLog(TAG, 'Runtime installation complete');
    return true;
  }
}

export const runtimeInstaller = new RuntimeInstaller();
