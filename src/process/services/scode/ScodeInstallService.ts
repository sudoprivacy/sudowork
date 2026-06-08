/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scode Install Service
 *
 * Installs the bundled/downloaded scode CLI into its dedicated runtime root at
 * ~/.nexus/sudocode so startup can verify the default ACP runtime.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';
import { extractTarGzWithProgress, extractZipWithProgress, listTarGzEntries, listZipEntries } from '../archiveProgress';

const TAG = 'ScodeInstallService';

/** OS name mapping: Node.js process.platform → scode archive OS name */
const SCODE_OS_NAME_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows' };
/** Architecture mapping: Node.js process.arch → scode archive arch name */
const SCODE_ARCH_NAME_MAP: Record<string, string> = { arm64: 'arm64', x64: 'x64' };

/** Scode root: ~/.nexus/sudocode */
export const SCODE_DIR = path.join(os.homedir(), '.nexus', 'sudocode');

/** Marker filename to record installed version */
const SCODE_READY_MARKER = '.scode-bin-ready';

/** GitHub release base URL for scode downloads */
const SCODE_GITHUB_RELEASE_BASE_URL = 'https://github.com/sudoprivacy/sudocode/releases/download';
const SCODE_SKILLS_DIR = path.join(SCODE_DIR, 'skills');
const SCODE_LEGACY_MANAGED_SKILLS_FILE = path.join(SCODE_DIR, '.sudowork-managed-skills.json');
const SCODE_PRESERVED_ENTRY_NAMES = new Set(['sudocode.json', 'scode.json', 'settings.json', 'skills', 'AGENTS.md']);

/** Marker used to identify the safety-rules section inside AGENTS.md */
const AGENTS_MD_SAFETY_MARKER = '<!-- SUDOCODE_DELETE_SAFETY_RULES -->';

/** Marker used to identify the identity-statement section inside AGENTS.md */
const AGENTS_MD_IDENTITY_MARKER = '<!-- SUDOCODE_IDENTITY_STATEMENT -->';

/** Marker used to identify the date-time-query section inside AGENTS.md */
const AGENTS_MD_DATE_TIME_MARKER = '<!-- SUDOCODE_DATE_TIME_QUERY -->';

/** Marker used to identify the memory-storage section inside AGENTS.md */
const AGENTS_MD_MEMORY_MARKER = '<!-- SUDOCODE_MEMORY_STORAGE -->';

const AGENTS_MD_MANAGED_MARKERS = [AGENTS_MD_SAFETY_MARKER, AGENTS_MD_IDENTITY_MARKER, AGENTS_MD_DATE_TIME_MARKER, AGENTS_MD_MEMORY_MARKER];

function readLegacyManagedScodeSkillEntries(): Map<string, string> {
  try {
    const raw = fs.readFileSync(SCODE_LEGACY_MANAGED_SKILLS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown> };
    if (!parsed.entries || typeof parsed.entries !== 'object') {
      return new Map();
    }

    return new Map(
      Object.entries(parsed.entries)
        .filter(([, target]) => typeof target === 'string' && target.trim().length > 0)
        .map(([name, target]) => [name, path.resolve(target as string)])
    );
  } catch {
    return new Map();
  }
}

function readSymlinkTarget(linkPath: string): string | null {
  try {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
      return null;
    }

    return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
  } catch {
    return null;
  }
}

function cleanupLegacyManagedScodeSkills(): void {
  if (!fs.existsSync(SCODE_LEGACY_MANAGED_SKILLS_FILE)) {
    return;
  }

  const managedEntries = readLegacyManagedScodeSkillEntries();
  for (const [name, previousTarget] of managedEntries) {
    const linkPath = path.join(SCODE_SKILLS_DIR, name);
    const currentTarget = readSymlinkTarget(linkPath);
    if (!currentTarget || currentTarget !== previousTarget) {
      continue;
    }

    fs.rmSync(linkPath, { recursive: true, force: true });
  }

  try {
    if (fs.existsSync(SCODE_SKILLS_DIR) && fs.readdirSync(SCODE_SKILLS_DIR).length === 0) {
      fs.rmSync(SCODE_SKILLS_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    mainWarn(TAG, `Failed to clean legacy scode skills directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  fs.rmSync(SCODE_LEGACY_MANAGED_SKILLS_FILE, { force: true });
}

/** Get the scode executable name for the current platform */
function getScodeExeName(): string {
  return process.platform === 'win32' ? 'scode.exe' : 'scode';
}

/** Get the archive file extension */
function getArchiveExtension(): string {
  return process.platform === 'win32' ? '.zip' : '.tar.gz';
}

/** Get the platform-specific archive name */
function getPlatformArchiveName(): string {
  const osName = SCODE_OS_NAME_MAP[process.platform];
  const archName = SCODE_ARCH_NAME_MAP[process.arch];
  if (!osName || !archName) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
  return `scode-${osName}-${archName}${getArchiveExtension()}`;
}

/** Get the versioned archive filename */
function getVersionedArchiveName(): string {
  const version = getScodeVersion();
  return `v${version}-${getPlatformArchiveName()}`;
}

/** Get the scode version from runtime-versions.json */
function getScodeVersion(): string {
  const value = runtimeVersions.scode;
  return typeof value === 'string' && value.trim() ? value.trim() : '0.1.1';
}

/** Get the installed scode binary path */
function getInstalledScodePath(): string {
  return path.join(SCODE_DIR, getScodeExeName());
}

/** Get the ready marker path */
function getReadyMarkerPath(): string {
  return path.join(SCODE_DIR, SCODE_READY_MARKER);
}

/** Check if marker file content matches current version */
function isMarkerCurrent(): boolean {
  const markerPath = getReadyMarkerPath();
  if (!fs.existsSync(markerPath)) return false;
  try {
    const content = fs.readFileSync(markerPath, 'utf-8').trim();
    return content === getScodeVersion();
  } catch {
    return false;
  }
}

/** Get the installed scode version from marker */
function getInstalledScodeVersion(): string | undefined {
  const markerPath = getReadyMarkerPath();
  if (!fs.existsSync(markerPath)) return undefined;
  try {
    const content = fs.readFileSync(markerPath, 'utf-8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

/** Get version state for upgrade detection */
export function getScodeVersionState(): { installedVersion?: string; bundledVersion?: string; needsUpgrade: boolean } {
  const installedVersion = getInstalledScodeVersion();
  const bundledVersion = getScodeVersion();

  if (!installedVersion) {
    // Not installed - needs upgrade (install)
    return { installedVersion, bundledVersion, needsUpgrade: true };
  }

  if (!bundledVersion) {
    return { installedVersion, bundledVersion, needsUpgrade: false };
  }

  return {
    installedVersion,
    bundledVersion,
    needsUpgrade: installedVersion !== bundledVersion,
  };
}

/** Check if scode is installed and version matches */
export function isScodeInstalled(): boolean {
  const scodePath = getInstalledScodePath();
  return fs.existsSync(scodePath) && isMarkerCurrent();
}

/** Get the bundled scode resource path */
function getBundledScodePath(): string | null {
  const versionedName = getVersionedArchiveName();

  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, versionedName);
    if (fs.existsSync(packagedPath)) {
      const stats = fs.statSync(packagedPath);
      if (stats.size >= 1024 * 100) {
        return packagedPath;
      }
    }
  }

  const devPath = path.join(app.getAppPath(), 'resources', versionedName);
  if (fs.existsSync(devPath)) {
    const stats = fs.statSync(devPath);
    if (stats.size >= 1024 * 100) {
      return devPath;
    }
  }

  return null;
}

/** Analyze archive structure to determine strip level */
async function analyzeArchiveStructure(archivePath: string): Promise<{ strip: number; topLevelNames: Set<string> }> {
  const entries = archivePath.endsWith('.zip') ? await listZipEntries(archivePath) : await listTarGzEntries(archivePath);
  const scodeName = getScodeExeName();

  const topLevelDirs = new Set<string>();
  for (const entry of entries) {
    const first = entry.split('/')[0];
    if (first) topLevelDirs.add(first);
  }

  if (topLevelDirs.size === 1) {
    const prefix = [...topLevelDirs][0];
    const names = new Set<string>();
    for (const entry of entries) {
      const rest = entry.slice(prefix.length + 1);
      if (rest) {
        const firstPart = rest.split('/')[0];
        if (firstPart) names.add(firstPart);
      }
    }

    if (names.has(scodeName)) {
      return { strip: 1, topLevelNames: names };
    }
  }

  const names = new Set<string>();
  for (const entry of entries) {
    const first = entry.split('/')[0];
    if (first) names.add(first);
  }
  return { strip: 0, topLevelNames: names };
}

/** Set executable permissions on scode binary (Unix only) */
function setInstalledPermissions(dir: string): void {
  if (process.platform === 'win32') return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      setInstalledPermissions(fullPath);
    } else if (entry.name === getScodeExeName() || entry.name.endsWith('.so') || entry.name.includes('.so.') || entry.name.endsWith('.dylib')) {
      fs.chmodSync(fullPath, 0o755);
    }
  }
}

/** Extract scode archive to target directory */
async function extractArchive(archivePath: string, targetDir: string, strip: number, onProgress?: (percent: number) => void): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    await extractZipWithProgress(archivePath, targetDir, onProgress, { strip });
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await extractTarGzWithProgress(archivePath, targetDir, onProgress, { strip });
  } else {
    throw new Error(`Unsupported archive format: ${archivePath}`);
  }
}

/** Download scode from GitHub release */
async function downloadScode(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
  const https = await import('https');
  const http = await import('http');

  return new Promise<void>((resolve, reject) => {
    let redirects = 0;
    const maxRedirects = 10;

    const doRequest = (requestUrl: string): void => {
      if (redirects > maxRedirects) {
        reject(new Error('Too many redirects'));
        return;
      }

      const mod = requestUrl.startsWith('https') ? https : http;
      const req = mod.get(requestUrl, (response: import('http').IncomingMessage) => {
        if ([301, 302, 307, 308].includes(response.statusCode!) && response.headers.location) {
          redirects++;
          mainLog(TAG, `Download redirect → ${response.headers.location}`);
          doRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = fs.createWriteStream(destPath);

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (totalSize > 0) {
            const percent = Math.round((downloaded / totalSize) * 100);
            mainLog(TAG, `Downloading scode... ${percent}%`);
            onProgress?.(percent);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          onProgress?.(100);
          resolve();
        });

        file.on('error', (err: Error) => {
          try {
            fs.unlinkSync(destPath);
          } catch {
            /* ignore */
          }
          reject(err);
        });
      });

      req.on('error', (err: Error) => {
        try {
          fs.unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        reject(err);
      });
    };

    doRequest(url);
  });
}

/** Get GitHub download URL for scode */
function getGitHubDownloadUrl(): string {
  const version = getScodeVersion();
  return `${SCODE_GITHUB_RELEASE_BASE_URL}/v${version}/${getPlatformArchiveName()}`;
}

/**
 * Install scode from bundled resources or download from GitHub.
 * Silent installation - no UI, just background install.
 */
export async function ensureScodeInstalled(options?: { forceReinstall?: boolean; onProgress?: (percent: number) => void }): Promise<boolean> {
  const forceReinstall = options?.forceReinstall === true;
  cleanupLegacyManagedScodeSkills();

  if (!forceReinstall && isScodeInstalled()) {
    mainLog(TAG, `Scode ${getScodeVersion()} already installed, skipping`);
    options?.onProgress?.(100);
    return true;
  }

  const binDir = SCODE_DIR;
  let archivePath: string | null = null;
  const downloadDir = path.join(os.tmpdir(), 'scode-download');
  const downloadDest = path.join(downloadDir, getVersionedArchiveName());

  // Try bundled resource first
  const bundledPath = getBundledScodePath();
  if (bundledPath) {
    archivePath = bundledPath;
    mainLog(TAG, `Using bundled scode archive from ${bundledPath}`);
    options?.onProgress?.(5);
  } else {
    // Download from GitHub
    mainLog(TAG, 'Bundled scode not found, attempting download from GitHub...');
    fs.mkdirSync(downloadDir, { recursive: true });

    const downloadAttempts = [{ label: 'GitHub', url: getGitHubDownloadUrl() }];

    let lastError: string | null = null;
    for (const attempt of downloadAttempts) {
      try {
        mainLog(TAG, `Downloading scode from ${attempt.label}: ${attempt.url}`);
        await downloadScode(attempt.url, downloadDest, (percent) => {
          const mapped = Math.max(5, Math.min(45, Math.round((percent / 100) * 45)));
          options?.onProgress?.(mapped);
        });
        archivePath = downloadDest;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        mainWarn(TAG, `${attempt.label} download failed: ${lastError}`);
      }
    }

    if (!archivePath) {
      mainError(TAG, `Failed to download scode: ${lastError ?? 'unknown error'}`);
      return false;
    }
  }

  try {
    mainLog(TAG, `Installing scode from ${archivePath}...`);

    // Analyze archive structure
    const { strip, topLevelNames } = await analyzeArchiveStructure(archivePath);
    mainLog(TAG, `Archive analysis: strip=${strip}, entries=[${[...topLevelNames].join(', ')}]`);

    // Ensure bin directory exists
    fs.mkdirSync(binDir, { recursive: true });

    // Clean old files
    const toRemove = new Set(topLevelNames);
    toRemove.add(SCODE_READY_MARKER);
    toRemove.add(getScodeExeName());

    for (const name of toRemove) {
      const target = path.join(binDir, name);
      if (fs.existsSync(target)) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch (err) {
          mainWarn(TAG, `Failed to remove ${target}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Extract archive
    const extractBaseProgress = bundledPath ? 5 : 45;
    await extractArchive(archivePath, binDir, strip, (percent) => {
      const mapped = extractBaseProgress + Math.round((percent / 100) * (100 - extractBaseProgress));
      options?.onProgress?.(Math.max(extractBaseProgress, Math.min(100, mapped)));
    });

    // Set permissions
    setInstalledPermissions(binDir);

    // Write version marker
    const markerFile = getReadyMarkerPath();
    fs.writeFileSync(markerFile, getScodeVersion());
    options?.onProgress?.(100);

    mainLog(TAG, `Scode installation completed: ${binDir}`);

    // Clean up downloaded archive
    if (archivePath === downloadDest && fs.existsSync(downloadDest)) {
      try {
        fs.unlinkSync(downloadDest);
      } catch {
        /* ignore */
      }
    }

    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    mainError(TAG, `Scode installation failed: ${errorMsg}`);
    return false;
  }
}

/** Get scode binary path if installed */
export function getScodePath(): string | null {
  const scodePath = getInstalledScodePath();
  return isScodeInstalled() && fs.existsSync(scodePath) ? scodePath : null;
}

/**
 * Update or insert a marker-based block in AGENTS.md
 * If marker exists, replace the entire block; if not, append it
 */
function updateMarkerBlock(existingContent: string, marker: string, newBlock: string): string {
  if (!existingContent.includes(marker)) {
    // Marker not found - append the new block
    return existingContent + '\n' + newBlock;
  }

  // Find all markers in the file to determine boundaries
  const markers = AGENTS_MD_MANAGED_MARKERS.filter((m) => existingContent.includes(m));

  // Find the start of this block (marker line)
  const markerIndex = existingContent.indexOf(marker);
  const blockStart = markerIndex;

  // Find the end of this block (next marker or end of file)
  let blockEnd = existingContent.length;
  for (const otherMarker of markers) {
    if (otherMarker === marker) continue;
    const otherIndex = existingContent.indexOf(otherMarker);
    if (otherIndex > markerIndex && otherIndex < blockEnd) {
      blockEnd = otherIndex;
    }
  }

  // Replace the block
  return existingContent.slice(0, blockStart) + newBlock + existingContent.slice(blockEnd);
}

function getManagedAgentsMdBlocks(): string[] {
  const identityBlock = `
${AGENTS_MD_IDENTITY_MARKER}
## Identity / 身份

When asked "Who are you?" / "你是谁?", answer: "I am Sudo Code, how can I help you?" / "我是Sudo Code，有什么可以帮助你的吗？".
Only mention model name when specifically asked about the model.
当用户问"你是谁"时，回答"我是Sudo Code，有什么可以帮助你的吗？"。仅当用户具体询问模型时才提及模型名称。
`;

  const safetyBlock = `
${AGENTS_MD_SAFETY_MARKER}
## File Deletion Safety / 文件删除安全

Before deleting files/folders, MUST confirm with user:
删除文件/文件夹前，必须向用户确认：
1. Show path to delete / 告知要删除的路径
2. Ask for confirmation / 请求确认
3. Wait for user consent / 等待用户同意
4. Cancel if refused / 用户拒绝则取消
`;

  const dateTimeBlock = `
${AGENTS_MD_DATE_TIME_MARKER}
## Date/Time Query / 日期时间查询

When users ask about current date/time (e.g., "What day is today?", "今天几号?", "What time is it?", "现在几点?"), you MUST query the actual system time using shell commands instead of relying on cached knowledge or memory.
当用户询问当前日期/时间时（如"今天几号?"、"What day is today?"、"现在几点?"、"What time is it?"），必须通过执行系统命令查询实际时间，而不是依赖缓存的知识或记忆。

**CRITICAL: Always execute a shell command to get the real-time date/time.**
**重要：必须执行shell命令获取实时日期/时间。**

**Commands by OS / 各系统命令:**

- **macOS / Linux**:
  - Date: \`date "+%Y-%m-%d"\` → e.g., "2026-05-15"
  - Time: \`date "+%H:%M:%S"\` → e.g., "14:30:25"
  - Full: \`date\` → e.g., "Thu May 15 14:30:25 CST 2026"

- **Windows (CMD)**:
  - Date: \`echo %date%\` → e.g., "2026/05/15"
  - Time: \`echo %time%\` → e.g., "14:30:25.12"

- **Windows (PowerShell)**:
  - Date: \`powershell -Command "Get-Date -Format 'yyyy-MM-dd'"\`
  - Time: \`powershell -Command "Get-Date -Format 'HH:mm:ss'"\`

**Workflow / 工作流程:**
1. Detect user is asking about date/time / 检测用户在询问日期/时间
2. Execute appropriate command for current OS / 根据当前OS执行相应命令
3. Return the actual result to user / 将实际结果返回给用户

**Examples / 示例:**
- User: "今天几号?" → Execute \`date "+%Y-%m-%d"\` (macOS/Linux) or \`echo %date%\` (Windows) → Reply with actual date
- User: "What day is today?" → Execute \`date\` → Reply with actual date
- User: "现在几点?" → Execute \`date "+%H:%M:%S"\` → Reply with actual time
`;

  const memoryBlock = `
${AGENTS_MD_MEMORY_MARKER}
## Memory Storage / 记忆存储

Conversation memories and user-specific long-term instructions are instruction-file content, not runtime settings.
会话记忆、用户偏好和长期规则属于指令文件内容，不属于运行时配置。

When the user asks you to remember, save, update, or persist a preference/rule/identity detail/workflow:
当用户要求记住、保存、更新或持久化偏好/规则/身份信息/工作流时：
1. Update the AGENTS.md file that applies to the current workspace. Prefer \`.nexus/sudocode/AGENTS.md\` under the current working directory unless the user explicitly names another AGENTS.md file.
   更新当前工作区对应的 AGENTS.md。除非用户明确指定其他 AGENTS.md，否则优先写入当前工作目录下的 \`.nexus/sudocode/AGENTS.md\`。
2. Store memories as Markdown instructions under a clear "Memory" section.
   以 Markdown 指令形式存放在清晰的 "Memory" 小节下。
3. Do NOT use the Config tool for memory operations.
   不要使用 Config 工具处理记忆写入。
4. Do NOT write memories or natural-language instructions to \`settings.json\`, \`settings.local.json\`, \`sudocode.json\`, or \`scode.json\`; those files are machine-readable runtime configuration only.
   不要把记忆或自然语言指令写入 \`settings.json\`、\`settings.local.json\`、\`sudocode.json\` 或 \`scode.json\`；这些文件只用于机器可读的运行时配置。
5. Use Config only when the user explicitly asks to change Sudo Code runtime settings such as model or permission mode.
   仅当用户明确要求修改 Sudo Code 运行时设置（如模型或权限模式）时才使用 Config。
`;

  return [identityBlock, dateTimeBlock, memoryBlock, safetyBlock];
}

function ensureAgentsMdRulesAt(agentsMdPath: string): void {
  mainLog(TAG, `ensureAgentsMdRules called, path: ${agentsMdPath}`);

  try {
    fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
    const fileExists = fs.existsSync(agentsMdPath);
    mainLog(TAG, `AGENTS.md exists: ${fileExists}`);
    if (!fileExists) {
      const content = getManagedAgentsMdBlocks().join('');
      fs.writeFileSync(agentsMdPath, content, 'utf-8');
      mainLog(TAG, 'Created AGENTS.md with managed scode rules');
    } else {
      const existing = fs.readFileSync(agentsMdPath, 'utf-8');
      const [identityBlock, dateTimeBlock, memoryBlock, safetyBlock] = getManagedAgentsMdBlocks();
      let updated = updateMarkerBlock(existing, AGENTS_MD_IDENTITY_MARKER, identityBlock);
      updated = updateMarkerBlock(updated, AGENTS_MD_DATE_TIME_MARKER, dateTimeBlock);
      updated = updateMarkerBlock(updated, AGENTS_MD_MEMORY_MARKER, memoryBlock);
      updated = updateMarkerBlock(updated, AGENTS_MD_SAFETY_MARKER, safetyBlock);
      if (updated !== existing) {
        fs.writeFileSync(agentsMdPath, updated, 'utf-8');
        mainLog(TAG, 'Updated AGENTS.md rules');
      }
    }
  } catch (err) {
    mainWarn(TAG, `Failed to ensure AGENTS.md rules: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Ensure the user-level AGENTS.md contains managed rules.
 */
export function ensureAgentsMdRules(): void {
  ensureAgentsMdRulesAt(path.join(SCODE_DIR, 'AGENTS.md'));
}

/**
 * Ensure the current scode workspace has rules that scode actually loads from
 * its AGENTS.md ancestry scan.
 */
export function ensureWorkspaceAgentsMdRules(workspace: string): void {
  ensureAgentsMdRulesAt(path.join(workspace, '.nexus', 'sudocode', 'AGENTS.md'));
}

/** Remove managed runtime artifacts while preserving user-managed config and skills. */
export function removeScodeInstallation(): void {
  if (!fs.existsSync(SCODE_DIR)) {
    return;
  }

  cleanupLegacyManagedScodeSkills();

  const entries = fs.readdirSync(SCODE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (SCODE_PRESERVED_ENTRY_NAMES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(SCODE_DIR, entry.name);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}
