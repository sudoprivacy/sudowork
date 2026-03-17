import { execFile, exec } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import { app } from 'electron';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Update this version constant when a new LibreOffice stable release is available.
// Download page: https://www.libreoffice.org/download/download-libreoffice/
const LIBREOFFICE_VERSION = '26.2.1';

// Arch names used in download URLs.
// Directory paths always use x86_64 (underscore), but filenames use x86-64 (hyphen).
// aarch64 is consistent in both directory paths and filenames.
function getArchNames(): { dir: string; file: string } {
  if (process.arch === 'arm64') {
    return { dir: 'aarch64', file: 'aarch64' };
  }
  return { dir: 'x86_64', file: 'x86-64' };
}

export interface LibreOfficeStatus {
  installed: boolean;
  version?: string;
}

export type InstallPhase = 'downloading' | 'mounting' | 'copying' | 'unmounting' | 'installing' | 'extracting' | 'cleanup';

export type ProgressCallback = (phase: InstallPhase, percent?: number) => void;

export class LibreOfficeService {
  async checkInstalled(): Promise<LibreOfficeStatus> {
    if (process.platform === 'darwin') {
      return this.checkInstalledMac();
    } else if (process.platform === 'win32') {
      return this.checkInstalledWindows();
    } else {
      return this.checkInstalledLinux();
    }
  }

  private async checkInstalledMac(): Promise<LibreOfficeStatus> {
    const appPath = '/Applications/LibreOffice.app';
    if (!fs.existsSync(appPath)) {
      return { installed: false };
    }
    try {
      const { stdout } = await execAsync(`defaults read "${appPath}/Contents/Info.plist" CFBundleShortVersionString`);
      return { installed: true, version: stdout.trim() || undefined };
    } catch {
      return { installed: true };
    }
  }

  private async checkInstalledWindows(): Promise<LibreOfficeStatus> {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const candidates = [path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'), path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe')];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return { installed: true };
      }
    }
    return { installed: false };
  }

  private async checkInstalledLinux(): Promise<LibreOfficeStatus> {
    try {
      const { stdout } = await execAsync('which libreoffice 2>/dev/null || which soffice 2>/dev/null');
      if (stdout.trim()) {
        return { installed: true };
      }
      return { installed: false };
    } catch {
      return { installed: false };
    }
  }

  getDownloadUrl(): string {
    const { dir, file } = getArchNames();
    const v = LIBREOFFICE_VERSION;
    const base = 'https://download.documentfoundation.org/libreoffice/stable';

    if (process.platform === 'darwin') {
      return `${base}/${v}/mac/${dir}/LibreOffice_${v}_MacOS_${file}.dmg`;
    } else if (process.platform === 'win32') {
      return `${base}/${v}/win/${dir}/LibreOffice_${v}_Win_${file}.msi`;
    } else {
      // Linux: deb packages bundled as tar.gz
      return `${base}/${v}/deb/${dir}/LibreOffice_${v}_Linux_${file}_deb.tar.gz`;
    }
  }

  private getCachedFilePath(): string {
    const cacheDir = path.join(app.getPath('userData'), 'libreoffice-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    let ext: string;
    if (process.platform === 'darwin') {
      ext = 'dmg';
    } else if (process.platform === 'win32') {
      ext = 'msi';
    } else {
      ext = 'tar.gz';
    }
    return path.join(cacheDir, `LibreOffice_${LIBREOFFICE_VERSION}.${ext}`);
  }

  async install(onProgress: ProgressCallback): Promise<void> {
    if (process.platform === 'darwin') {
      return this.installMac(onProgress);
    } else if (process.platform === 'win32') {
      return this.installWindows(onProgress);
    } else {
      return this.installLinux(onProgress);
    }
  }

  private async installMac(onProgress: ProgressCallback): Promise<void> {
    const dmgPath = this.getCachedFilePath();
    let mountPoint: string | undefined;

    try {
      if (fs.existsSync(dmgPath) && fs.statSync(dmgPath).size > 0) {
        onProgress('downloading', 100);
      } else {
        await this.downloadFile(this.getDownloadUrl(), dmgPath, (percent) => {
          onProgress('downloading', percent);
        });
      }

      onProgress('mounting');
      mountPoint = await this.mountDmg(dmgPath);

      onProgress('copying');
      const appEntry = fs.readdirSync(mountPoint).find((f) => f.endsWith('.app'));
      if (!appEntry) throw new Error('No .app found in mounted DMG');
      const src = path.join(mountPoint, appEntry).replace(/'/g, "'\\''");
      const script = `do shell script "cp -R '${src}' '/Applications/'" with administrator privileges`;
      await execFileAsync('osascript', ['-e', script]);
    } catch (err) {
      try {
        if (fs.existsSync(dmgPath)) fs.rmSync(dmgPath);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      if (mountPoint) {
        onProgress('unmounting');
        try {
          await execFileAsync('hdiutil', ['detach', mountPoint, '-quiet']);
        } catch {
          /* ignore */
        }
      }
      onProgress('cleanup');
    }
  }

  private async installWindows(onProgress: ProgressCallback): Promise<void> {
    const msiPath = this.getCachedFilePath();

    try {
      if (fs.existsSync(msiPath) && fs.statSync(msiPath).size > 0) {
        onProgress('downloading', 100);
      } else {
        await this.downloadFile(this.getDownloadUrl(), msiPath, (percent) => {
          onProgress('downloading', percent);
        });
      }

      onProgress('installing');
      // /passive shows a minimal progress UI and triggers UAC elevation automatically
      await execFileAsync('msiexec', ['/i', msiPath, '/passive', '/norestart']);
    } catch (err) {
      try {
        if (fs.existsSync(msiPath)) fs.rmSync(msiPath);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      onProgress('cleanup');
    }
  }

  private async installLinux(onProgress: ProgressCallback): Promise<void> {
    const tarGzPath = this.getCachedFilePath();
    const extractDir = path.join(path.dirname(tarGzPath), 'libreoffice-extract');

    try {
      if (fs.existsSync(tarGzPath) && fs.statSync(tarGzPath).size > 0) {
        onProgress('downloading', 100);
      } else {
        await this.downloadFile(this.getDownloadUrl(), tarGzPath, (percent) => {
          onProgress('downloading', percent);
        });
      }

      onProgress('extracting');
      if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
      await execFileAsync('tar', ['-xzf', tarGzPath, '-C', extractDir]);

      onProgress('installing');
      const debsDir = this.findDebsDir(extractDir);
      if (!debsDir) throw new Error('No DEBS directory found in LibreOffice package');
      const debFiles = fs.readdirSync(debsDir).filter((f) => f.endsWith('.deb'));
      if (debFiles.length === 0) throw new Error('No .deb files found');
      const debPaths = debFiles.map((f) => path.join(debsDir, f));
      // pkexec shows a graphical privilege escalation dialog
      await execFileAsync('pkexec', ['dpkg', '-i', ...debPaths]);
    } catch (err) {
      try {
        if (fs.existsSync(tarGzPath)) fs.rmSync(tarGzPath);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      try {
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      onProgress('cleanup');
    }
  }

  private findDebsDir(extractDir: string): string | undefined {
    // LibreOffice tar.gz extracts to a subdirectory like LibreOffice_26.2.1_Linux_x86-64_deb/
    // which contains a DEBS/ directory with the .deb packages
    try {
      const entries = fs.readdirSync(extractDir);
      for (const entry of entries) {
        const entryPath = path.join(extractDir, entry);
        if (fs.statSync(entryPath).isDirectory()) {
          const debsPath = path.join(entryPath, 'DEBS');
          if (fs.existsSync(debsPath)) return debsPath;
        }
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private mountDmg(dmgPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('hdiutil', ['attach', dmgPath, '-nobrowse', '-plist'], (err, stdout) => {
        if (err) return reject(err);
        const match = stdout.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
        if (match?.[1]) return resolve(match[1]);
        reject(new Error('Could not determine DMG mount point'));
      });
    });
  }

  private downloadFile(url: string, dest: string, onPercent: (n: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const doRequest = (reqUrl: string, redirectCount = 0) => {
        if (redirectCount > 10) return reject(new Error('Too many redirects'));
        const mod = reqUrl.startsWith('https') ? https : http;
        mod
          .get(reqUrl, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return doRequest(res.headers.location, redirectCount + 1);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
            }
            const total = parseInt(res.headers['content-length'] ?? '0', 10);
            let received = 0;
            const file = fs.createWriteStream(dest);
            res.on('data', (chunk: Buffer) => {
              received += chunk.length;
              if (total > 0) onPercent(Math.round((received / total) * 100));
            });
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
            file.on('error', (e) => {
              fs.rmSync(dest, { force: true });
              reject(e);
            });
            res.on('error', reject);
          })
          .on('error', reject);
      };
      doRequest(url);
    });
  }
}

export const libreOfficeService = new LibreOfficeService();
