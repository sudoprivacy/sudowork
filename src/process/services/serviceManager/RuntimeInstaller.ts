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

const TAG = 'RuntimeInstaller';

/**
 * Ensures all required runtimes (Node.js, Sudoclaw, Nexus, Bdpan) are installed.
 *
 * Extracted from ServiceManager so that runtime installation is decoupled
 * from service lifecycle management.
 */
class RuntimeInstaller {
  /**
   * Check and install all runtimes as needed.
   * Returns true if startup should proceed to service starts,
   * false if a critical install failure occurred.
   */
  async ensureAll(): Promise<boolean> {
    const isWin32 = process.platform === 'win32';

    // On Windows runtimes are installed by the NSIS installer.
    if (isWin32) {
      mainLog(TAG, 'Skipping runtime installation on Windows (installed by NSIS)');
      initStatusManager.setStatus('ready', '初始化完成', 100);
      return true;
    }

    // ── Fast synchronous pre-check (no awaits, only fs.existsSync) ──────────
    // Running before the first `await` means this executes synchronously in the
    // same event-loop tick as `void serviceManager.startup()`, so
    // initStatusManager is set to 'ready' before the renderer can poll
    // getStatus via IPC.  This prevents the brief "组件安装中" flash on
    // subsequent launches.
    const resDir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');

    const fastNodeOk = isNodeInstalled();

    const sudoclawBinPath = path.join(os.homedir(), '.nexus', 'sudoclaw', 'cli', 'package', 'bin', 'openclaw');
    const fastSudoclawOk = fs.existsSync(sudoclawBinPath);

    const nexusEnvBinPath = path.join(os.homedir(), '.nexus', 'nexus_env', 'bin', 'nexusd');
    const nexusResPath = path.join(resDir, 'nexus.tar.gz');
    const hasNexusResource = (() => {
      try {
        return fs.existsSync(nexusResPath) && fs.statSync(nexusResPath).size >= 1024 * 1024;
      } catch {
        return false;
      }
    })();
    const fastNexusOk = !hasNexusResource || fs.existsSync(nexusEnvBinPath);
    const { isBdpanInstalled: checkBdpanInstalled } = await import('../bdpan/BdpanInstallService');
    const fastBdpanOk = checkBdpanInstalled();

    mainLog(
      TAG,
      `Fast check: Node=${fastNodeOk}, Sudoclaw=${fastSudoclawOk}, Nexus=${fastNexusOk}, Bdpan=${fastBdpanOk} (hasNexusResource=${hasNexusResource})`,
    );

    if (fastNodeOk && fastSudoclawOk && fastNexusOk && fastBdpanOk) {
      mainLog(TAG, 'All runtimes already installed, skipping installation');
      initStatusManager.setStatus('ready', '初始化完成', 100);
      return true;
    }
    // ── End fast check ──────────────────────────────────────────────────────

    // At least one component appears to be missing — do full async check
    mainLog(TAG, 'Checking runtime dependencies...');
    const [
      { dynamicNexusService },
      { ensureSudoclawInstalled, getSudoclawCliPath },
      { isBdpanInstalled, ensureBdpanInstalled },
    ] =
      await Promise.all([
        import('../nexus/DynamicNexusService'),
        import('../sudoclaw/SudoclawInstallService'),
        import('../bdpan/BdpanInstallService'),
      ]);

    const nodeInstalled = isNodeInstalled();
    const sudoclawInstalled = getSudoclawCliPath() !== null;
    const nexusInstalled = await dynamicNexusService.checkInstalled();
    const bdpanInstalled = isBdpanInstalled();

    mainLog(
      TAG,
      `Full check: Node=${nodeInstalled}, Sudoclaw=${sudoclawInstalled}, Nexus=${nexusInstalled}, Bdpan=${bdpanInstalled}`,
    );

    // Full check may confirm everything is fine (fast check had a false negative)
    if (nodeInstalled && sudoclawInstalled && nexusInstalled && bdpanInstalled) {
      mainLog(TAG, 'All runtimes confirmed installed');
      initStatusManager.setStatus('ready', '初始化完成', 100);
      return true;
    }

    // Check which resource files are available.  Only show "组件安装中" and
    // attempt install when the source archive actually exists.
    const nodeResName = `node-${process.platform}-${process.arch}.tar.gz`;
    const hasNodeResource = fs.existsSync(path.join(resDir, nodeResName));
    const hasSudoclawResource = fs.existsSync(path.join(resDir, 'openclaw.tgz'));
    const bdpanPlatformOs = isWin32 ? 'windows' : process.platform;
    const bdpanPlatformArch = process.arch === 'x64' ? 'x64' : process.arch;
    const bdpanResName = `bdpan-installer-${bdpanPlatformOs}-${bdpanPlatformArch}${isWin32 ? '.exe' : ''}`;
    const hasBdpanResource = fs.existsSync(path.join(resDir, bdpanResName));

    const willInstallNode = !nodeInstalled && hasNodeResource;
    const willInstallSudoclaw = !sudoclawInstalled && hasSudoclawResource;
    const willInstallNexus = !nexusInstalled && hasNexusResource;
    const willInstallBdpan = !bdpanInstalled && hasBdpanResource;

    if (!willInstallNode && !willInstallSudoclaw && !willInstallNexus && !willInstallBdpan) {
      mainWarn(
        TAG,
        'Some components missing but no installation resources found, marking ready',
      );
      initStatusManager.setStatus('ready', '初始化完成', 100);
      return true;
    }

    // ── Sequential install of missing components ────────────────────────────

    // Node.js (progress: 10-30%)
    if (willInstallNode) {
      try {
        mainLog(TAG, 'Installing Node.js runtime...');
        initStatusManager.setStatus('installing', '组件安装中', 10);
        const { ensureNodeInstalled } = await import('../claudeCli/NodeRuntimeService');
        await ensureNodeInstalled();
        mainLog(TAG, 'Node.js runtime installed successfully');
      } catch (err) {
        mainError(TAG, 'Node.js runtime install failed', err);
        initStatusManager.setStatus('error', '安装失败', 0, err instanceof Error ? err.message : String(err));
        return false;
      }
    }

    // Sudoclaw (progress: 30-60%)
    if (willInstallSudoclaw) {
      try {
        mainLog(TAG, 'Installing Sudoclaw...');
        initStatusManager.setStatus('installing', '组件安装中', 30);
        const sudoclawResult = await ensureSudoclawInstalled();
        if (!sudoclawResult.installed) {
          mainError(TAG, 'Sudoclaw install failed - missing required files after extraction');
          initStatusManager.setStatus('error', '安装失败', 0, 'Sudoclaw install incomplete, please reinstall the app');
          return false;
        }
        mainLog(TAG, 'Sudoclaw installed successfully');
      } catch (err) {
        mainError(TAG, 'Sudoclaw install failed', err);
        initStatusManager.setStatus('error', '安装失败', 0, err instanceof Error ? err.message : String(err));
        return false;
      }
    }

    // Nexus (progress: 60-85%)
    if (willInstallNexus) {
      try {
        mainLog(TAG, 'Installing Nexus...');
        initStatusManager.setStatus('installing', '组件安装中', 60);
        await dynamicNexusService.install();
        mainLog(TAG, 'Nexus installed successfully, starting...');
        await dynamicNexusService.start();
        mainLog(TAG, 'Nexus started successfully');
      } catch (err) {
        mainError(TAG, 'Nexus install/start failed', err);
        // Not critical, continue
      }
    }

    // Bdpan (progress: 85-95%)
    if (willInstallBdpan) {
      try {
        mainLog(TAG, 'Installing Bdpan...');
        initStatusManager.setStatus('installing', '组件安装中', 85);
        const ok = await ensureBdpanInstalled();
        if (!ok) {
          mainWarn(TAG, 'Bdpan install did not complete successfully');
        } else {
          mainLog(TAG, 'Bdpan installed successfully');
        }
      } catch (err) {
        mainWarn(TAG, `Bdpan install failed: ${err instanceof Error ? err.message : String(err)}`);
        // Optional component - continue startup.
      }
    }

    // All done
    initStatusManager.setStatus('ready', '初始化完成', 100);
    mainLog(TAG, 'Runtime installation complete');
    return true;
  }
}

export const runtimeInstaller = new RuntimeInstaller();
