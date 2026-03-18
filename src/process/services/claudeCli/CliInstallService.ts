import { app, BrowserWindow, dialog, Notification } from 'electron';
import { ipcBridge } from '@/common';
import { execFile, exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { ProcessConfig } from '@/process/initStorage';
import * as tar from 'tar';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export interface CliStatus {
  installed: boolean;
  path?: string;
  version?: string;
  source: 'managed' | 'system' | 'none';
}

interface CliConfig {
  /** CLI command name, e.g. 'claude' or 'gemini' */
  name: string;
  /** npm package name used as fallback in dev mode, e.g. '@anthropic-ai/claude-code' */
  npmPackage: string;
  /** Filename of the tgz in extraResources, e.g. 'claude-code.tgz' */
  tgzResource: string;
  /** ProcessConfig key to store "user declined install" flag */
  declinedKey: string;
  /** Human-readable display label for dialogs */
  label: string;
}

const SUDOWORK_DIR = path.join(os.homedir(), '.sudowork');
const MANAGED_ROOT = path.join(SUDOWORK_DIR, 'cli');
const BIN_DIR = path.join(SUDOWORK_DIR, 'bin');
// Stores the Electron binary path so wrappers can find it without hardcoded paths.
// Updated on every app launch via syncElectronPath().
const ELECTRON_PATH_FILE = path.join(SUDOWORK_DIR, 'electron-path');

/**
 * Writes the current Electron binary path to ~/.sudowork/electron-path.
 * Call this on every app startup so CLI wrappers always have a fresh path
 * even if the app has been moved or reinstalled.
 */
export function syncElectronPath(): void {
  try {
    fs.mkdirSync(SUDOWORK_DIR, { recursive: true });
    fs.writeFileSync(ELECTRON_PATH_FILE, process.execPath, 'utf-8');
  } catch {
    // Non-critical — wrapper will fall back to mdfind / system node
  }
}

export class CliInstallService {
  private readonly cfg: CliConfig;
  private readonly installDir: string;

  constructor(cfg: CliConfig) {
    this.cfg = cfg;
    this.installDir = path.join(MANAGED_ROOT, cfg.name);
  }

  async checkInstalled(): Promise<CliStatus> {
    const binName = process.platform === 'win32' ? `${this.cfg.name}.cmd` : this.cfg.name;
    const managedBin = path.join(BIN_DIR, binName);
    const entryFile = this.resolveEntryFile();

    if (fs.existsSync(managedBin) && entryFile && fs.existsSync(entryFile)) {
      // Read version directly from installed package.json — no PATH dependency
      return { installed: true, path: managedBin, source: 'managed', version: this.getManagedVersion() };
    }

    try {
      const cmd = process.platform === 'win32' ? `where ${this.cfg.name}` : `which ${this.cfg.name}`;
      const { stdout } = await execAsync(cmd);
      const paths = stdout.trim().split(/\r?\n/);
      // Filter out our own managed bin from system check if it's there
      const systemPath = paths.find((p) => !p.startsWith(BIN_DIR));
      if (systemPath) {
        return { installed: true, path: systemPath, source: 'system', version: await this.getVersionFromPath(systemPath) };
      }
    } catch {
      // not in PATH
    }

    return { installed: false, source: 'none' };
  }

  /** Read version from the installed package.json — always works regardless of PATH */
  private getManagedVersion(): string | undefined {
    const pkgName = this.cfg.npmPackage.startsWith('@') 
      ? this.cfg.npmPackage.split('@').slice(1, 3).join('@') 
      : this.cfg.npmPackage.split('@')[0];
    const pkgJson = path.join(this.installDir, 'node_modules', pkgName, 'package.json');
    if (!fs.existsSync(pkgJson)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).version ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Run `<binPath> --version` to get version for system-installed binaries */
  private async getVersionFromPath(binPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(`"${binPath}" --version`);
      const match = stdout.trim().match(/\d+\.\d+[\w.-]*/);
      return match ? match[0] : stdout.trim().split('\n')[0].trim();
    } catch {
      return undefined;
    }
  }

  async install(): Promise<void> {
    const tgzPath = this.resolveTgzPath();

    if (!fs.existsSync(tgzPath)) {
      throw new Error(`Package not found at: ${tgzPath}`);
    }

    fs.mkdirSync(this.installDir, { recursive: true });
    fs.mkdirSync(BIN_DIR, { recursive: true });

    // Keep the electron-path file fresh so wrappers find the binary
    syncElectronPath();

    // Use node-tar for cross-platform reliability (no dependency on system 'tar')
    await tar.x({
      file: tgzPath,
      cwd: this.installDir,
    });

    const entryFile = this.resolveEntryFile();
    if (!entryFile) throw new Error(`Cannot determine CLI entry file for ${this.cfg.name}`);

    if (process.platform === 'win32') {
      this.createWindowsWrapper(entryFile);
    } else {
      this.createUnixWrapper(entryFile);
    }

    await this.updateShellConfig();
  }

  async uninstall(): Promise<void> {
    fs.rmSync(this.installDir, { recursive: true, force: true });
    const binName = process.platform === 'win32' ? `${this.cfg.name}.cmd` : this.cfg.name;
    const managedBin = path.join(BIN_DIR, binName);
    if (fs.existsSync(managedBin)) fs.rmSync(managedBin);
  }

  async isDeclined(): Promise<boolean> {
    return (await ProcessConfig.get(this.cfg.declinedKey as Parameters<typeof ProcessConfig.get>[0])) === true;
  }

  async setDeclined(value: boolean): Promise<void> {
    await ProcessConfig.set(this.cfg.declinedKey as Parameters<typeof ProcessConfig.set>[0], value);
  }

  get label(): string {
    return this.cfg.label;
  }

  get commandName(): string {
    return this.cfg.name;
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private resolveTgzPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, this.cfg.tgzResource);
    }
    return path.join(app.getAppPath(), 'resources', this.cfg.tgzResource);
  }

  /** Read bin entry from extracted package.json to find the CLI entry file */
  private resolveEntryFile(): string | null {
    // The self-contained bundle has the target package inside node_modules
    // e.g. installDir/node_modules/@google/gemini-cli/package.json
    const pkgName = this.cfg.npmPackage.startsWith('@') 
      ? this.cfg.npmPackage.split('@').slice(1, 3).join('@') 
      : this.cfg.npmPackage.split('@')[0];
    const pkgPath = path.join(this.installDir, 'node_modules', pkgName);
    const pkgJson = path.join(pkgPath, 'package.json');

    if (!fs.existsSync(pkgJson)) return null;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
      const bin = pkg.bin;
      if (!bin) return null;
      const entry = typeof bin === 'string' ? bin : (Object.values(bin)[0] as string);
      return path.join(pkgPath, entry);
    } catch {
      return null;
    }
  }

  private createUnixWrapper(entryFile: string): void {
    const wrapperPath = path.join(BIN_DIR, this.cfg.name);
    // Wrapper uses ELECTRON_RUN_AS_NODE=1 so users without system Node.js can
    // run the CLI. All paths are resolved at runtime — no hardcoded locations.
    const content =
      [
        '#!/bin/sh',
        `# ${this.cfg.name} wrapper — managed by Sudowork`,
        `CLI="${entryFile}"`,
        `ELECTRON_PATH_FILE="$HOME/.sudowork/electron-path"`,
        '',
        'run_electron() {',
        '  exec env ELECTRON_RUN_AS_NODE=1 "$1" "$CLI" "$@"',
        '}',
        '',
        '# 1. Path stored by Sudowork (refreshed on every app launch)',
        'if [ -f "$ELECTRON_PATH_FILE" ]; then',
        '  ELECTRON=$(cat "$ELECTRON_PATH_FILE")',
        '  if [ -x "$ELECTRON" ]; then run_electron "$ELECTRON" "$@"; fi',
        'fi',
        '',
        '# 2. macOS: Spotlight search by bundle ID (works regardless of install location)',
        'if command -v mdfind >/dev/null 2>&1; then',
        '  APP=$(mdfind "kMDItemCFBundleIdentifier == \'com.sudowork.app\'" 2>/dev/null | head -1)',
        '  if [ -n "$APP" ]; then',
        '    ELECTRON="$APP/Contents/MacOS/Sudowork"',
        '    if [ -x "$ELECTRON" ]; then run_electron "$ELECTRON" "$@"; fi',
        '  fi',
        'fi',
        '',
        '# 3. Linux: check if sudowork is in PATH',
        'if command -v sudowork >/dev/null 2>&1; then',
        '  run_electron "$(command -v sudowork)" "$@"',
        'fi',
        '',
        '# 4. Fallback: system Node.js',
        'for NODE in node /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node; do',
        '  if command -v "$NODE" >/dev/null 2>&1; then exec "$NODE" "$CLI" "$@"; fi',
        '  if [ -x "$NODE" ]; then exec "$NODE" "$CLI" "$@"; fi',
        'done',
        '',
        'echo "Error: Sudowork not found and Node.js is not installed." >&2',
        'echo "  Reopen Sudowork once to refresh the path, or install Node.js from https://nodejs.org" >&2',
        'exit 1',
      ].join('\n') + '\n';
    fs.writeFileSync(wrapperPath, content, { mode: 0o755 });
  }

  private createWindowsWrapper(entryFile: string): void {
    const wrapperPath = path.join(BIN_DIR, `${this.cfg.name}.cmd`);
    // Wrapper uses ELECTRON_RUN_AS_NODE=1. Path is read at runtime from
    // %USERPROFILE%\.sudowork\electron-path — no hardcoded install locations.
    const content =
      [
        '@echo off',
        'setlocal enabledelayedexpansion',
        `set "CLI=${entryFile}"`,
        'set "ELECTRON_PATH_FILE=%USERPROFILE%\\.sudowork\\electron-path"',
        'set "ELECTRON="',
        '',
        ':: 1. Path stored by Sudowork (refreshed on every app launch)',
        'if exist "%ELECTRON_PATH_FILE%" (',
        '  set /p ELECTRON=<"%ELECTRON_PATH_FILE%"',
        ')',
        'if defined ELECTRON (',
        '  if exist "!ELECTRON!" (',
        '    set ELECTRON_RUN_AS_NODE=1',
        '    "!ELECTRON!" "%CLI%" %*',
        '    exit /b %ERRORLEVEL%',
        '  )',
        ')',
        '',
        ':: 2. Fallback: system Node.js',
        'where node >nul 2>nul',
        'if %ERRORLEVEL% equ 0 (',
        '  node "%CLI%" %*',
        '  exit /b %ERRORLEVEL%',
        ')',
        '',
        'echo Error: Sudowork not found and Node.js is not installed.',
        'echo   Reopen Sudowork once to refresh the path, or install Node.js from https://nodejs.org',
        'exit /b 1',
      ].join('\r\n') + '\r\n';
    fs.writeFileSync(wrapperPath, content);
  }

  private async updateShellConfig(): Promise<void> {
    if (process.platform === 'win32') {
      // Use PowerShell to safely update the User PATH without the 1024-char limit of setx.
      // We check if it's already there first to avoid duplication.
      const psCommand = `
        $binDir = "${BIN_DIR}"
        $path = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($path -split ';' -notcontains $binDir) {
          $newPath = if ([string]::IsNullOrWhiteSpace($path)) { $binDir } else { "$path;$binDir" }
          [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        }
      `
        .replace(/\n/g, ' ')
        .trim();

      try {
        await execFileAsync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCommand]);
      } catch (err) {
        console.error('[CLI] Failed to update Windows PATH via PowerShell:', err);
        // Fallback to notifying user or trying setx (though setx is risky)
      }
      return;
    }

    const exportLine = `\n# added by Sudowork\nexport PATH="${BIN_DIR}:$PATH"\n`;
    for (const rc of [path.join(os.homedir(), '.zshrc'), path.join(os.homedir(), '.bashrc')]) {
      try {
        const content = fs.existsSync(rc) ? fs.readFileSync(rc, 'utf-8') : '';
        if (!content.includes(BIN_DIR)) fs.appendFileSync(rc, exportLine);
      } catch {
        // ignore unwritable rc files
      }
    }
  }
}

export const claudeCliService = new CliInstallService({
  name: 'claude',
  npmPackage: '@anthropic-ai/claude-code',
  tgzResource: 'claude-code.tgz',
  declinedKey: 'claudeCli.installDeclined',
  label: 'Claude Code CLI',
});

export const geminiCliService = new CliInstallService({
  name: 'gemini',
  npmPackage: '@google/gemini-cli',
  tgzResource: 'gemini-cli.tgz',
  declinedKey: 'geminiCli.installDeclined',
  label: 'Gemini CLI',
});

/**
 * Called once after the main window is ready.
 * For each CLI tool not yet installed and not previously declined,
 * show a native dialog asking the user. Installs on consent, records
 * the refusal on decline so the prompt never appears again.
 */
export async function promptCliInstallsIfNeeded(): Promise<void> {
  const tools = [claudeCliService, geminiCliService];
  const toPrompt: CliInstallService[] = [];

  for (const svc of tools) {
    const [status, declined] = await Promise.all([svc.checkInstalled(), svc.isDeclined()]);
    if (!status.installed && !declined) {
      toPrompt.push(svc);
    }
  }

  if (toPrompt.length === 0) return;

  const names = toPrompt.map((s) => `• ${s.label}  (${s.commandName})`).join('\n');
  const parentWindow = BrowserWindow.getAllWindows()[0] ?? null;

  const { response } = await dialog.showMessageBox(parentWindow!, {
    type: 'question',
    title: '安装 CLI 工具',
    message: '检测到以下 CLI 工具尚未安装：',
    detail: `${names}\n\n安装后可在终端直接使用这些命令。`,
    buttons: ['安装', '暂不安装'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    // User agreed — install one by one with notifications
    for (const svc of toPrompt) {
      new Notification({
        title: `正在安装 ${svc.label}`,
        body: `请稍候，安装完成后会通知您…`,
        silent: true,
      }).show();

      const emitter = svc.commandName === 'claude' ? ipcBridge.claudeCli.installResult : ipcBridge.geminiCli.installResult;

      try {
        await svc.install();
        console.log(`[CLI] ${svc.label} installed successfully`);
        new Notification({
          title: `${svc.label} 安装成功`,
          body: `重新开一个终端，执行 ${svc.commandName} 即可使用`,
        }).show();
        emitter.emit({ success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CLI] Failed to install ${svc.label}:`, err);
        new Notification({
          title: `${svc.label} 安装失败`,
          body: msg,
        }).show();
        emitter.emit({ success: false, msg });
      }
    }
  } else {
    // User declined — record so we never ask again
    for (const svc of toPrompt) {
      await svc.setDeclined(true);
    }
  }
}
