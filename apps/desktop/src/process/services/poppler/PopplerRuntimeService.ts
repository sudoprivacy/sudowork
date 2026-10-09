import { execFile } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { promisify } from 'util';
import { COS_RUNTIME_BASE } from '@sudowork/common/cos';
import { extractTarGzWithProgress } from '@process/services/archiveProgress';
import { getDataPath } from '@process/utils';

const execFileAsync = promisify(execFile);

export type PopplerInstallPhase = 'downloading' | 'extracting' | 'verifying' | 'cleanup';
export type PopplerProgressCallback = (phase: PopplerInstallPhase, percent?: number) => void;

interface IPopplerStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

const REQUIRED_TOOLS = ['pdftotext', 'pdfimages'] as const;

export class PopplerRuntimeService {
  async checkInstalled(): Promise<IPopplerStatus> {
    const managed = await this.checkManaged();
    if (managed.installed) return managed;
    return this.checkSystem();
  }

  async checkManaged(): Promise<IPopplerStatus> {
    const pdftotext = this.getToolPath('pdftotext');
    if (!this.hasRequiredTools()) return { installed: false };
    const version = await this.readVersion(pdftotext);
    if (!version && (await this.readVersionError(pdftotext))) return { installed: false };
    return {
      installed: true,
      path: pdftotext,
      version,
    };
  }

  getToolPath(tool: (typeof REQUIRED_TOOLS)[number]): string {
    const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
    return path.join(this.getBinDir(), exe);
  }

  getBinDir(): string {
    return process.platform === 'win32' ? path.join(this.getInstallDir(), 'Library', 'bin') : path.join(this.getInstallDir(), 'bin');
  }

  getPathEnv(): string {
    return `${this.getBinDir()}${path.delimiter}${process.env.PATH ?? ''}`;
  }

  getToolEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: this.getPathEnv() };
    const libDir = path.join(this.getInstallDir(), 'lib');
    if (process.platform === 'darwin') {
      env.DYLD_LIBRARY_PATH = `${libDir}${path.delimiter}${process.env.DYLD_LIBRARY_PATH ?? ''}`;
    } else if (process.platform === 'linux') {
      env.LD_LIBRARY_PATH = `${libDir}${path.delimiter}${process.env.LD_LIBRARY_PATH ?? ''}`;
    }
    return env;
  }

  async install(onProgress: PopplerProgressCallback): Promise<void> {
    const archivePath = this.getCachedArchivePath();
    const installDir = this.getInstallDir();
    const stageDir = path.join(this.getRootDir(), '.stage', `poppler-${Date.now()}`);
    try {
      fs.mkdirSync(path.dirname(archivePath), { recursive: true });
      fs.mkdirSync(stageDir, { recursive: true });

      if (fs.existsSync(archivePath) && fs.statSync(archivePath).size > 0) {
        onProgress('downloading', 100);
      } else {
        await this.downloadWithFallback(this.getDownloadUrls(), archivePath, (percent) => onProgress('downloading', percent));
      }

      onProgress('extracting', 0);
      await extractTarGzWithProgress(archivePath, stageDir, (percent) => onProgress('extracting', percent), { strip: 1 });

      onProgress('verifying', 0);
      await this.makeExecutablesRunnable(stageDir);
      if (!this.hasRequiredTools(stageDir)) {
        throw new Error('Poppler archive missing required tools: pdftotext, pdfimages');
      }

      this.rewriteStageSymlinks(stageDir, stageDir, installDir);
      fs.rmSync(installDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(installDir), { recursive: true });
      fs.renameSync(stageDir, installDir);
      await this.makeExecutablesRunnable(installDir);
      if (!(await this.waitForManaged()).installed) {
        const detail = await this.readInstallDiagnostics();
        throw new Error(`Poppler install verification failed${detail ? `: ${detail}` : ''}`);
      }
      onProgress('verifying', 100);
    } catch (err) {
      fs.rmSync(archivePath, { force: true });
      fs.rmSync(installDir, { recursive: true, force: true });
      throw err;
    } finally {
      onProgress('cleanup');
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }

  async uninstall(): Promise<void> {
    fs.rmSync(this.getInstallDir(), { recursive: true, force: true });
    fs.rmSync(this.getCacheDir(), { recursive: true, force: true });
  }

  private getRootDir(): string {
    return path.join(getDataPath(), 'sudowork', 'poppler-runtime');
  }

  private getInstallDir(): string {
    return path.join(this.getRootDir(), 'current');
  }

  private getCacheDir(): string {
    return path.join(this.getRootDir(), 'cache');
  }

  private getPlatformId(): string {
    if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    if (process.platform === 'win32') return 'win32-x64';
    if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
    throw new Error(`Unsupported Poppler platform: ${process.platform}-${process.arch}`);
  }

  private getCachedArchivePath(): string {
    return path.join(this.getCacheDir(), `poppler-${this.getPlatformId()}.tar.gz`);
  }

  private getDownloadUrls(): string[] {
    return [`${COS_RUNTIME_BASE}/poppler/poppler-${this.getPlatformId()}.tar.gz`];
  }

  private hasRequiredTools(rootDir = this.getInstallDir()): boolean {
    const binDir = process.platform === 'win32' ? path.join(rootDir, 'Library', 'bin') : path.join(rootDir, 'bin');
    return REQUIRED_TOOLS.every((tool) => fs.existsSync(path.join(binDir, process.platform === 'win32' ? `${tool}.exe` : tool)));
  }

  private async makeExecutablesRunnable(rootDir: string): Promise<void> {
    if (process.platform === 'win32') return;
    await Promise.all(
      REQUIRED_TOOLS.map(async (tool) => {
        const file = path.join(rootDir, 'bin', tool);
        if (fs.existsSync(file)) {
          await fs.promises.chmod(file, 0o755).catch((): undefined => undefined);
        }
      })
    );
  }

  private rewriteStageSymlinks(rootDir: string, stageDir: string, installDir: string, sourceRoot = rootDir, realStageDir = fs.realpathSync.native(stageDir)): void {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(rootDir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(filePath);
        const absoluteTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(filePath), target);
        const relativeToStage = path.relative(realStageDir, fs.realpathSync.native(absoluteTarget));
        if (!relativeToStage.startsWith('..') && !path.isAbsolute(relativeToStage)) {
          const replacement = path.join(installDir, relativeToStage);
          const relativeFilePath = path.relative(sourceRoot, filePath);
          const futureFilePath = path.join(installDir, relativeFilePath);
          fs.unlinkSync(filePath);
          fs.symlinkSync(path.relative(path.dirname(futureFilePath), replacement), filePath);
        }
        continue;
      }
      if (entry.isDirectory()) {
        this.rewriteStageSymlinks(filePath, stageDir, installDir, sourceRoot, realStageDir);
      }
    }
  }

  private async checkSystem(): Promise<IPopplerStatus> {
    const tool = process.platform === 'win32' ? 'pdftotext.exe' : 'pdftotext';
    try {
      const probe = process.platform === 'win32' ? ['where.exe', tool] : ['which', tool];
      const { stdout } = await execFileAsync(probe[0], [probe[1]], { timeout: 5_000 });
      const candidate = stdout.trim().split(/\r?\n/)[0];
      if (!candidate) return { installed: false };
      return {
        installed: true,
        path: candidate,
        version: await this.readVersion(candidate),
      };
    } catch {
      return { installed: false };
    }
  }

  private async waitForManaged(): Promise<IPopplerStatus> {
    let status: IPopplerStatus = { installed: false };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      status = await this.checkManaged();
      if (status.installed) return status;
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
    }
    return status;
  }

  private async readVersion(pdftotextPath: string): Promise<string | undefined> {
    try {
      const { stdout, stderr } = await execFileAsync(pdftotextPath, ['-v'], { timeout: 5_000, env: this.getToolEnv() });
      const out = `${stdout}\n${stderr}`;
      return out.match(/pdftotext version\s+([^\s]+)/i)?.[1];
    } catch {
      return undefined;
    }
  }

  private async readVersionError(pdftotextPath: string): Promise<string | undefined> {
    try {
      await execFileAsync(pdftotextPath, ['-v'], { timeout: 5_000, env: this.getToolEnv() });
      return undefined;
    } catch (err) {
      if (!(err instanceof Error)) return String(err);
      const execError = err as Error & { stderr?: string; stdout?: string; code?: string | number; signal?: NodeJS.Signals };
      const output = `${execError.stderr ?? ''}\n${execError.stdout ?? ''}`.trim();
      const diagnostics = [
        output || execError.message,
        `exists=${fs.existsSync(pdftotextPath)}`,
        `bin=${pdftotextPath}`,
        `lib=${path.join(this.getInstallDir(), 'lib')}`,
        execError.code != null ? `code=${execError.code}` : undefined,
        execError.signal ? `signal=${execError.signal}` : undefined,
      ].filter((item): item is string => Boolean(item));
      return diagnostics.join('; ');
    }
  }

  private async readInstallDiagnostics(): Promise<string> {
    const installDir = this.getInstallDir();
    const binDir = this.getBinDir();
    const toolStates = REQUIRED_TOOLS.map((tool) => {
      const toolPath = this.getToolPath(tool);
      return `${tool}=${fs.existsSync(toolPath) ? 'exists' : 'missing'}`;
    });
    const version = await this.readVersion(this.getToolPath('pdftotext'));
    const versionError = version ? undefined : await this.readVersionError(this.getToolPath('pdftotext'));
    const binEntries = fs.existsSync(binDir) ? fs.readdirSync(binDir).slice(0, 20).join(',') : 'missing';
    const diagnostics = [...toolStates, version ? `version=${version}` : undefined, versionError ? `versionError=${versionError}` : undefined, `install=${installDir}`, `binEntries=${binEntries}`].filter((item): item is string => Boolean(item));
    return diagnostics.join('; ');
  }

  private async downloadWithFallback(urls: string[], destPath: string, onProgress: (percent: number) => void): Promise<void> {
    let lastError: unknown;
    for (const url of urls) {
      try {
        await downloadFile(url, destPath, onProgress);
        return;
      } catch (err) {
        lastError = err;
        fs.rmSync(destPath, { force: true });
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Poppler download failed');
  }
}

function downloadFile(url: string, destPath: string, onProgress: (percent: number) => void): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    const request = (currentUrl: string, redirects = 0): void => {
      if (redirects > 8) {
        reject(new Error('too many redirects'));
        return;
      }
      const client = currentUrl.startsWith('https:') ? https : http;
      const req = client.get(currentUrl, (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          request(new URL(response.headers.location, currentUrl).toString(), redirects + 1);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`download failed with HTTP ${status}`));
          return;
        }
        const total = Number(response.headers['content-length'] ?? 0);
        let downloaded = 0;
        const file = fs.createWriteStream(destPath);
        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0) onProgress(Math.round((downloaded / total) * 100));
        });
        response.pipe(file);
        response.on('error', reject);
        file.on('finish', () => {
          file.close(() => {
            onProgress(100);
            resolve();
          });
        });
        file.on('error', (err) => {
          file.close(() => {
            fs.rmSync(destPath, { force: true });
            reject(err);
          });
        });
      });
      req.on('error', reject);
      req.setTimeout(120_000, () => {
        req.destroy(new Error('download timed out'));
      });
    };
    request(url);
  });
}

export const popplerRuntimeService = new PopplerRuntimeService();
