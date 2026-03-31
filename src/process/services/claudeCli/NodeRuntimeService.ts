/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Node Runtime Service
 *
 * Extracts and manages a bundled Node.js runtime for CLI tools.
 * This avoids the macOS Dock bounce issue when using ELECTRON_RUN_AS_NODE.
 *
 * Node.js is bundled at build time via `bun run node:download`.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDataPath } from '@process/utils';
import type { ICliStatus } from '@/common/ipcBridge';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { extractTarGzWithProgress, extractZipWithProgress, type ArchiveProgressCallback } from '../archiveProgress';

const execAsync = promisify(exec);

/** Node.js LTS version to bundle */
const NODE_VERSION = '22.22.2';

/** Directory to store bundled Node.js */
const getNodeDir = (): string => path.join(getDataPath(), 'node');

/** Get the Node.js binary path for the current platform */
export function getNodeBinaryPath(): string {
  const nodeDir = getNodeDir();
  const platform = process.platform;
  const arch = process.arch;

  // Node.js official download naming:
  // - macOS: node-v22.22.2-darwin-x64/bin/node
  // - Windows: node-v22.22.2-win-x64/node.exe (note: "win" not "win32")
  // - Linux: node-v22.22.2-linux-x64/bin/node
  const nodePlatform = platform === 'win32' ? 'win' : platform;
  const dirName = `node-v${NODE_VERSION}-${nodePlatform}-${arch}`;

  if (platform === 'win32') {
    return path.join(nodeDir, dirName, 'node.exe');
  }
  return path.join(nodeDir, dirName, 'bin', 'node');
}

/** Check if bundled Node.js is installed */
export function isNodeInstalled(): boolean {
  const nodePath = getNodeBinaryPath();
  return fs.existsSync(nodePath);
}

/** Get the bundled resource path */
function getBundledResourcePath(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const resourceName = `node-${platform}-${arch}.${ext}`;

  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, resourceName);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  // Development mode
  const devPath = path.join(app.getAppPath(), 'resources', resourceName);
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

/** Extract tar.gz file */
async function extractTarGz(archivePath: string, targetDir: string, onProgress?: ArchiveProgressCallback): Promise<void> {
  await extractTarGzWithProgress(archivePath, targetDir, onProgress);
}

/** Extract zip file (Windows) using PowerShell */
async function extractZip(archivePath: string, targetDir: string, onProgress?: ArchiveProgressCallback): Promise<void> {
  await extractZipWithProgress(archivePath, targetDir, onProgress);
}

/**
 * Install bundled Node.js from packaged resources.
 * Returns true if installation was successful.
 */
export async function installNode(onProgress?: ArchiveProgressCallback): Promise<boolean> {
  const nodeDir = getNodeDir();
  const nodePath = getNodeBinaryPath();

  // Already installed
  if (fs.existsSync(nodePath)) {
    mainLog('NodeRuntime', 'Node.js already installed at:', nodePath);
    return true;
  }

  // Find bundled resource
  const resourcePath = getBundledResourcePath();
  if (!resourcePath) {
    mainWarn('NodeRuntime', 'Bundled Node.js resource not found');
    return false;
  }

  mainLog('NodeRuntime', 'Installing Node.js', NODE_VERSION);
  mainLog('NodeRuntime', 'Resource:', resourcePath);
  mainLog('NodeRuntime', 'Target:', nodeDir);
  mainLog('NodeRuntime', 'Expected binary:', nodePath);

  fs.mkdirSync(nodeDir, { recursive: true });

  try {
    // Extract
    if (process.platform === 'win32') {
      mainLog('NodeRuntime', 'Using Windows zip extraction');
      await extractZip(resourcePath, nodeDir, onProgress);
    } else {
      mainLog('NodeRuntime', 'Using tar.gz extraction');
      await extractTarGz(resourcePath, nodeDir, onProgress);
    }

    // List extracted contents for debugging
    mainLog('NodeRuntime', 'Extracted contents:', fs.readdirSync(nodeDir));

    // Verify
    if (!fs.existsSync(nodePath)) {
      // Try to find what was actually extracted
      const findNode = (dir: string): string | null => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          if (fs.statSync(fullPath).isDirectory()) {
            const found = findNode(fullPath);
            if (found) return found;
          } else if (item === 'node.exe' || item === 'node') {
            return fullPath;
          }
        }
        return null;
      };
      const actualNode = findNode(nodeDir);
      throw new Error(`Node binary not found at ${nodePath}. Actual node found at: ${actualNode || 'none'}`);
    }

    // Make executable on Unix
    if (process.platform !== 'win32') {
      fs.chmodSync(nodePath, 0o755);
    }

    mainLog('NodeRuntime', 'Node.js installed successfully');
    return true;
  } catch (err) {
    mainError('NodeRuntime', 'Installation failed:', err);
    return false;
  }
}

/**
 * Ensure Node.js is installed (install if not).
 * Call this at app startup.
 */
export async function ensureNodeInstalled(onProgress?: ArchiveProgressCallback): Promise<boolean> {
  if (isNodeInstalled()) {
    return true;
  }
  return installNode(onProgress);
}

/**
 * Get Node.js version
 */
export function getNodeVersion(): string {
  return NODE_VERSION;
}

/**
 * Uninstall bundled Node.js
 */
export function uninstallNode(): void {
  const nodeDir = getNodeDir();
  if (fs.existsSync(nodeDir)) {
    fs.rmSync(nodeDir, { recursive: true, force: true });
  }
}

/**
 * Get the system-installed Node.js path (via `which node`).
 * Returns undefined if no system node is found.
 */
export async function getSystemNodePath(): Promise<string | undefined> {
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node';
    const { stdout } = await execAsync(cmd);
    const nodePath = stdout.trim().split(/\r?\n/)[0];
    if (nodePath && fs.existsSync(nodePath)) {
      // Exclude the bundled node path
      const bundledPath = getNodeBinaryPath();
      if (nodePath === bundledPath) return undefined;
      return nodePath;
    }
  } catch {
    // not in PATH
  }
  return undefined;
}

/**
 * Get the version of a Node.js binary at a given path.
 */
export async function getSystemNodeVersion(nodePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`"${nodePath}" --version`);
    const match = stdout.trim().match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Single facade that returns the Node.js runtime status as ICliStatus.
 * Prefers managed (bundled) Node; falls back to system Node.
 */
export async function checkNodeStatus(): Promise<ICliStatus> {
  if (isNodeInstalled()) {
    return { installed: true, version: getNodeVersion(), path: getNodeBinaryPath(), source: 'managed' };
  }
  const systemPath = await getSystemNodePath();
  if (systemPath) {
    const systemVersion = await getSystemNodeVersion(systemPath);
    return { installed: true, version: systemVersion, path: systemPath, source: 'system' };
  }
  return { installed: false, source: 'none' };
}
