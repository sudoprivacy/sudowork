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

import { execFile } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import { getDataPath } from '@process/utils';

/** Node.js LTS version to bundle */
const NODE_VERSION = '24.9.0';

/** Directory to store bundled Node.js */
const getNodeDir = (): string => path.join(getDataPath(), 'node');

/** Get the Node.js binary path for the current platform */
export function getNodeBinaryPath(): string {
  const nodeDir = getNodeDir();
  const platform = process.platform;
  const arch = process.arch;

  // Extracted directory structure: node/node-v24.9.0-darwin-x64/bin/node
  const dirName = `node-v${NODE_VERSION}-${platform}-${arch}`;

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
async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  await tar.x({
    file: archivePath,
    cwd: targetDir,
  });
}

/** Extract zip file (Windows) using PowerShell */
async function extractZip(archivePath: string, targetDir: string): Promise<void> {
  const execFileAsync = promisify(execFile);

  // Escape paths for PowerShell (single quotes handle most special characters)
  const escapedArchive = archivePath.replace(/'/g, "''");
  const escapedTarget = targetDir.replace(/'/g, "''");

  const psCommand = `Expand-Archive -Path '${escapedArchive}' -DestinationPath '${escapedTarget}' -Force`;

  console.log('[NodeRuntime] Extracting with PowerShell:', psCommand);

  await execFileAsync('powershell', ['-NoProfile', '-Command', psCommand]);
}

/**
 * Install bundled Node.js from packaged resources.
 * Returns true if installation was successful.
 */
export async function installNode(): Promise<boolean> {
  const nodeDir = getNodeDir();
  const nodePath = getNodeBinaryPath();

  // Already installed
  if (fs.existsSync(nodePath)) {
    console.log('[NodeRuntime] Node.js already installed at:', nodePath);
    return true;
  }

  // Find bundled resource
  const resourcePath = getBundledResourcePath();
  if (!resourcePath) {
    console.warn('[NodeRuntime] Bundled Node.js resource not found');
    return false;
  }

  console.log('[NodeRuntime] Installing Node.js', NODE_VERSION);
  console.log('[NodeRuntime] Resource:', resourcePath);
  console.log('[NodeRuntime] Target:', nodeDir);
  console.log('[NodeRuntime] Expected binary:', nodePath);

  fs.mkdirSync(nodeDir, { recursive: true });

  try {
    // Extract
    if (process.platform === 'win32') {
      console.log('[NodeRuntime] Using Windows zip extraction');
      await extractZip(resourcePath, nodeDir);
    } else {
      console.log('[NodeRuntime] Using tar.gz extraction');
      await extractTarGz(resourcePath, nodeDir);
    }

    // List extracted contents for debugging
    console.log('[NodeRuntime] Extracted contents:', fs.readdirSync(nodeDir));

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

    console.log('[NodeRuntime] Node.js installed successfully');
    return true;
  } catch (err) {
    console.error('[NodeRuntime] Installation failed:', err);
    return false;
  }
}

/**
 * Ensure Node.js is installed (install if not).
 * Call this at app startup.
 */
export async function ensureNodeInstalled(): Promise<boolean> {
  if (isNodeInstalled()) {
    return true;
  }
  return installNode();
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
