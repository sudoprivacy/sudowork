/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isNodeInstalled } from '../claudeCli/NodeRuntimeService';
import { initStatusManager } from '../initStatus';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { createNexusSetupLogSnapshot, getNexusStepProgressFromSetupStatus, getNexusStepStateFromSetupStatus, shouldLogNexusSetupStatus, type NexusSetupLogSnapshot } from './nexusSetupStatus';
import { dynamicNexusService as installedNexusService } from '../nexus/DynamicNexusService';

const TAG = 'RuntimeInstaller';

/**
 * Ensures the core runtimes required for startup (Node.js, Sudoclaw, Nexus) are installed.
 *
 * Extracted from ServiceManager so that runtime installation is decoupled
 * from service lifecycle management.
 */
class RuntimeInstaller {
  private getSudoclawVersionStateForRuntimeChecks(getSudoclawVersionState: () => { installedVersion?: string; bundledVersion?: string; needsUpgrade: boolean }): { installedVersion?: string; bundledVersion?: string; needsUpgrade: boolean } {
    if (!app.isPackaged) {
      const versionState = getSudoclawVersionState();
      return {
        installedVersion: versionState.installedVersion,
        bundledVersion: versionState.bundledVersion,
        needsUpgrade: false,
      };
    }

    return getSudoclawVersionState();
  }

  /**
   * Check and install all runtimes as needed.
   * Returns true if startup should proceed to service starts,
   * false if a critical install failure occurred.
   */
  async ensureAll(options?: { startSudoclaw?: (timeoutMs?: number) => Promise<void>; startNexus?: () => Promise<void> }): Promise<boolean> {
    const isWin32 = process.platform === 'win32';

    // ── Fast synchronous pre-check (no awaits, only sync fs) ────────────────
    // Running before the first `await` means this executes synchronously in the
    // same event-loop tick as `void serviceManager.startup()`, so
    // initStatusManager is set to 'ready' before the renderer can poll
    // getStatus via IPC.  This prevents the brief "组件安装中" flash on
    // subsequent launches.
    const resDir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');

    const fastNodeOk = isNodeInstalled();

    const sudoclawBinName = isWin32 ? 'openclaw.cmd' : 'openclaw';
    const sudoclawBinPath = path.join(os.homedir(), '.nexus', 'sudoclaw', 'cli', 'package', 'bin', sudoclawBinName);
    const fastSudoclawOk = fs.existsSync(sudoclawBinPath);

    const nexusResPath = path.join(resDir, 'nexus.tar.gz');
    const hasNexusResource = (() => {
      try {
        return fs.existsSync(nexusResPath) && fs.statSync(nexusResPath).size >= 1024 * 1024;
      } catch {
        return false;
      }
    })();
    const fastNexusOk = !hasNexusResource || installedNexusService.checkInstalledSync();
    const markFastInstalledSteps = (): void => {
      initStatusManager.setStepState('git', 'done', 'Git 环境检查已跳过');
      initStatusManager.setStepProgress('git', 100, 'Git 环境检查已跳过');
      initStatusManager.setStepState('claude', 'done', 'Claude Code CLI 不参与启动判定');
      initStatusManager.setStepProgress('claude', 100, 'Claude Code CLI 不参与启动判定');
      initStatusManager.setStepState('bdpan', 'done', 'bdpan CLI 不参与启动判定');
      initStatusManager.setStepProgress('bdpan', 100, 'bdpan CLI 不参与启动判定');
      if (fastNodeOk) {
        initStatusManager.setStepState('node', 'done', 'Node.js 运行时已就绪');
        initStatusManager.setStepProgress('node', 100, 'Node.js 运行时已就绪');
      }
      if (fastSudoclawOk) {
        initStatusManager.setStepState('sudoclaw', options?.startSudoclaw ? 'pending' : 'done', options?.startSudoclaw ? '等待启动 Sudoclaw...' : 'Sudoclaw 文件已就绪');
        initStatusManager.setStepProgress('sudoclaw', options?.startSudoclaw ? 88 : 100, options?.startSudoclaw ? '等待启动 Sudoclaw...' : 'Sudoclaw 文件已就绪');
      }
      if (fastNexusOk) {
        initStatusManager.setStepState('nexus', options?.startNexus && hasNexusResource ? 'pending' : 'done', options?.startNexus && hasNexusResource ? '等待启动 Nexus...' : 'Nexus 文件已就绪');
        initStatusManager.setStepProgress('nexus', options?.startNexus && hasNexusResource ? 88 : 100, options?.startNexus && hasNexusResource ? '等待启动 Nexus...' : 'Nexus 文件已就绪');
      }
    };

    mainLog(TAG, `Fast check: Git=skipped, Node=${fastNodeOk}, Sudoclaw=${fastSudoclawOk}, Nexus=${fastNexusOk} (hasNexusResource=${hasNexusResource})`);

    const startCriticalServices = async (): Promise<boolean> => {
      const serviceStartTasks: Promise<void>[] = [];

      if (options?.startSudoclaw) {
        initStatusManager.setStepState('sudoclaw', 'active', '正在启动 Sudoclaw 服务...');
        initStatusManager.setStepProgress('sudoclaw', 92, '正在启动 Sudoclaw 服务...');
        serviceStartTasks.push(options.startSudoclaw());
      }

      if (options?.startNexus && hasNexusResource) {
        initStatusManager.setStepState('nexus', 'active', '正在启动 Nexus 服务...');
        initStatusManager.setStepProgress('nexus', 92, '正在启动 Nexus 服务...');
        serviceStartTasks.push(options.startNexus());
      }

      if (serviceStartTasks.length === 0) {
        return true;
      }

      await Promise.all(serviceStartTasks);
      return true;
    };

    if (fastNodeOk && fastSudoclawOk && fastNexusOk) {
      const { getSudoclawVersionState } = await import('../sudoclaw/SudoclawInstallService');
      const nexusVersionState = hasNexusResource ? await installedNexusService.getVersionState() : { needsUpgrade: false, installedVersion: undefined, bundledVersion: undefined };
      const sudoclawVersionState = this.getSudoclawVersionStateForRuntimeChecks(getSudoclawVersionState);

      if (!nexusVersionState.needsUpgrade && !sudoclawVersionState.needsUpgrade) {
        mainLog(TAG, 'All runtimes already installed, skipping installation');
        initStatusManager.setDisplayMode('startup');
        markFastInstalledSteps();
        return startCriticalServices();
      }

      mainLog(TAG, `Version mismatch: Nexus=${nexusVersionState.needsUpgrade ? `${nexusVersionState.installedVersion}→${nexusVersionState.bundledVersion}` : 'ok'}, Sudoclaw=${sudoclawVersionState.needsUpgrade ? `${sudoclawVersionState.installedVersion}→${sudoclawVersionState.bundledVersion}` : 'ok'}`);
    }
    // ── End fast check ──────────────────────────────────────────────────────

    // ── At least one component appears to be missing — do full async check ──
    mainLog(TAG, 'Checking runtime dependencies...');
    const runtimeModules = await Promise.all([import('../nexus/DynamicNexusService'), import('../sudoclaw/SudoclawInstallService')]);
    const [nexusModule, sudoclawModule] = runtimeModules;
    const { dynamicNexusService } = nexusModule;
    const { ensureSudoclawInstalled, getSudoclawCliPath, getSudoclawVersionState } = sudoclawModule;

    const nodeInstalled = isNodeInstalled();
    const sudoclawInstalled = getSudoclawCliPath() !== null;
    const sudoclawVersionState = this.getSudoclawVersionStateForRuntimeChecks(getSudoclawVersionState);
    const nexusInstalledPromise = dynamicNexusService.checkInstalled();
    const nexusVersionStatePromise = hasNexusResource ? dynamicNexusService.getVersionState() : Promise.resolve({ needsUpgrade: false, installedVersion: undefined, bundledVersion: undefined });
    const [nexusInstalled, nexusVersionState] = await Promise.all([nexusInstalledPromise, nexusVersionStatePromise]);

    mainLog(TAG, `Full check: Node=${nodeInstalled}, Sudoclaw=${sudoclawInstalled}, Nexus=${nexusInstalled}, SudoclawUpgrade=${sudoclawVersionState.needsUpgrade}, NexusUpgrade=${nexusVersionState.needsUpgrade}`);

    // Full check may confirm everything is fine (fast check had a false negative)
    if (nodeInstalled && sudoclawInstalled && nexusInstalled && !sudoclawVersionState.needsUpgrade && !nexusVersionState.needsUpgrade) {
      mainLog(TAG, 'All runtimes confirmed installed');
      initStatusManager.setDisplayMode('startup');
      markFastInstalledSteps();
      return startCriticalServices();
    }

    // Check which resource files are available.  Only show "组件安装中" and
    // attempt install when the source archive actually exists.
    const nodeResExt = isWin32 ? 'zip' : 'tar.gz';
    const nodeResName = `node-${process.platform}-${process.arch}.${nodeResExt}`;
    const hasNodeResource = fs.existsSync(path.join(resDir, nodeResName));
    const hasSudoclawResource = fs.existsSync(path.join(resDir, 'openclaw.tgz'));

    const willInstallNode = !nodeInstalled && hasNodeResource;
    const willInstallSudoclaw = hasSudoclawResource && (!sudoclawInstalled || sudoclawVersionState.needsUpgrade);
    const willInstallNexus = hasNexusResource && (!nexusInstalled || nexusVersionState.needsUpgrade);

    if (willInstallNode || willInstallSudoclaw || willInstallNexus) {
      initStatusManager.setDisplayMode('full');
      initStatusManager.setStatus('installing', '正在并行准备运行环境...', 5);
    }

    if (!willInstallNode && !willInstallSudoclaw && !willInstallNexus) {
      mainWarn(TAG, 'Some components missing but no installation resources found, starting services');
      initStatusManager.setDisplayMode('startup');
      markFastInstalledSteps();
      return startCriticalServices();
    }

    type RuntimeStepId = 'git' | 'node' | 'claude' | 'sudoclaw' | 'nexus' | 'bdpan';
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

    markStepDone('git', 'Git 环境检查已跳过');

    if (nodeInstalled) {
      markStepDone('node', 'Node.js 运行时已就绪');
    } else if (willInstallNode) {
      initStatusManager.setStepState('node', 'pending', '等待安装 Node.js 运行时...');
      initStatusManager.setStepProgress('node', 0, '等待安装 Node.js 运行时...');
    } else {
      markStepError('node', '未找到 Node.js 安装资源');
    }

    markStepDone('claude', 'Claude Code CLI 不参与启动判定');

    if (sudoclawInstalled && !sudoclawVersionState.needsUpgrade) {
      if (options?.startSudoclaw) {
        initStatusManager.setStepState('sudoclaw', 'pending', '等待启动 Sudoclaw...');
        initStatusManager.setStepProgress('sudoclaw', 88, '等待启动 Sudoclaw...');
      } else {
        markStepDone('sudoclaw', 'Sudoclaw 文件已就绪');
      }
    } else if (willInstallSudoclaw) {
      initStatusManager.setStepState('sudoclaw', 'pending', '等待安装 Sudoclaw...');
      initStatusManager.setStepProgress('sudoclaw', 0, '等待安装 Sudoclaw...');
    } else {
      markStepError('sudoclaw', '未找到 Sudoclaw 安装资源');
    }

    if (!hasNexusResource) {
      markStepDone('nexus', '当前构建未包含 Nexus，已跳过');
    } else if (nexusInstalled && !nexusVersionState.needsUpgrade) {
      if (options?.startNexus) {
        initStatusManager.setStepState('nexus', 'pending', '等待启动 Nexus...');
        initStatusManager.setStepProgress('nexus', 88, '等待启动 Nexus...');
      } else {
        markStepDone('nexus', 'Nexus 文件已就绪');
      }
    } else if (willInstallNexus) {
      initStatusManager.setStepState('nexus', 'pending', '等待安装 Nexus...');
      initStatusManager.setStepProgress('nexus', 0, '等待安装 Nexus...');
    } else {
      markStepError('nexus', '未找到 Nexus 安装资源');
    }

    markStepDone('bdpan', 'bdpan CLI 不参与启动判定');

    const gitTask: Promise<TaskResult> = Promise.resolve({ step: 'git', ok: true, required: false });

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
        const { ensureNodeInstalled } = await import('../claudeCli/NodeRuntimeService');
        const ok = await Promise.resolve().then(() =>
          ensureNodeInstalled((percent) => {
            initStatusManager.setStepProgress('node', percent, `正在解压 Node.js 运行时... ${percent}%`);
          })
        );
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

    const claudeTask: Promise<TaskResult> = (async () => {
      return { step: 'claude', ok: true, required: false };
    })();

    const sudoclawTask: Promise<TaskResult> = (async () => {
      if (sudoclawInstalled && !sudoclawVersionState.needsUpgrade) {
        if (!options?.startSudoclaw) {
          return { step: 'sudoclaw', ok: true, required: true };
        }
        try {
          markStepActive('sudoclaw', '正在启动 Sudoclaw 服务...', 92);
          initStatusManager.addLog('开始启动 Sudoclaw 服务...');
          await options.startSudoclaw();
          return { step: 'sudoclaw', ok: true, required: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          markStepError('sudoclaw', `Sudoclaw 启动失败: ${error}`, 92);
          initStatusManager.addLog(`⚠ Sudoclaw 启动失败: ${error}`);
          return { step: 'sudoclaw', ok: false, required: true, error };
        }
      }
      if (!willInstallSudoclaw) {
        return { step: 'sudoclaw', ok: false, required: true, error: '未找到 Sudoclaw 安装资源' };
      }

      try {
        const isUpgrade = sudoclawVersionState.needsUpgrade;
        const action = isUpgrade ? `升级 Sudoclaw ${sudoclawVersionState.installedVersion} → ${sudoclawVersionState.bundledVersion}` : '安装 Sudoclaw';
        mainLog(TAG, action);
        markStepActive('sudoclaw', '准备解压 Sudoclaw...', 0);
        initStatusManager.addLog(`开始${action}...`);
        const result = await ensureSudoclawInstalled({
          forceReinstall: isUpgrade,
          onProgress: (percent) => {
            const progress = capInstallProgress(percent, 88);
            initStatusManager.setStepProgress('sudoclaw', progress, `正在解压 Sudoclaw... ${percent}%`);
          },
        });
        if (!result.installed) {
          const error = result.error ?? 'Sudoclaw 安装未完成';
          mainError(TAG, error);
          markStepError('sudoclaw', error);
          initStatusManager.addLog(`⚠ ${error}`);
          return { step: 'sudoclaw', ok: false, required: true, error };
        }
        if (!options?.startSudoclaw) {
          markStepDone('sudoclaw', 'Sudoclaw 文件已就绪');
          initStatusManager.addLog('✓ Sudoclaw 安装完成');
          return { step: 'sudoclaw', ok: true, required: true };
        }
        markStepActive('sudoclaw', 'Sudoclaw 文件已就绪，正在启动服务...', 92);
        initStatusManager.addLog('✓ Sudoclaw 安装完成，开始启动服务...');
        await options.startSudoclaw();
        return { step: 'sudoclaw', ok: true, required: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        mainError(TAG, 'Sudoclaw install failed', err);
        const prefix = sudoclawInstalled && !sudoclawVersionState.needsUpgrade ? 'Sudoclaw 启动失败' : 'Sudoclaw 安装失败';
        markStepError('sudoclaw', `${prefix}: ${error}`);
        initStatusManager.addLog(`⚠ ${prefix}: ${error}`);
        return { step: 'sudoclaw', ok: false, required: true, error };
      }
    })();

    const nexusTask: Promise<TaskResult> = (async () => {
      if (!hasNexusResource) {
        return { step: 'nexus', ok: true, required: false };
      }
      if (nexusInstalled && !nexusVersionState.needsUpgrade) {
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
      if (!willInstallNexus) {
        return { step: 'nexus', ok: false, required: true, error: '未找到 Nexus 安装资源' };
      }

      try {
        const isUpgrade = nexusVersionState.needsUpgrade;
        const action = isUpgrade ? `升级 Nexus ${nexusVersionState.installedVersion} → ${nexusVersionState.bundledVersion}` : '安装 Nexus';
        mainLog(TAG, action);
        markStepActive('nexus', '准备安装 Nexus...', 0);
        initStatusManager.addLog(`开始${action}...`);

        let lastLoggedSetupStatus: NexusSetupLogSnapshot | null = null;
        const unsubNexus = dynamicNexusService.onSetupStatus((nexusStatus) => {
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
          await dynamicNexusService.install();
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
        const prefix = nexusInstalled && !nexusVersionState.needsUpgrade ? 'Nexus 启动失败' : 'Nexus 安装失败';
        markStepError('nexus', `${prefix}: ${error}`);
        initStatusManager.addLog(`⚠ ${prefix}: ${error}`);
        return { step: 'nexus', ok: false, required: true, error };
      }
    })();

    const bdpanTask: Promise<TaskResult> = (async () => {
      return { step: 'bdpan', ok: true, required: false };
    })();

    const results = await Promise.all([gitTask, nodeTask, claudeTask, sudoclawTask, nexusTask, bdpanTask]);
    const failedRequired = results.filter((result) => result.required && !result.ok);
    if (failedRequired.length > 0) {
      const error = `以下组件安装未完成: ${failedRequired.map((item) => item.step).join('、')}`;
      initStatusManager.setStatus('error', '安装失败', 0, error);
      return false;
    }

    initStatusManager.setStatus('installing', '正在校验组件状态...', 96);
    mainLog(TAG, 'Runtime installation complete');
    return true;
  }
}

export const runtimeInstaller = new RuntimeInstaller();
