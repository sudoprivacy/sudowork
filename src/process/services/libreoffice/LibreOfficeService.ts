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

const APP_PATH = '/Applications/LibreOffice.app';

export interface LibreOfficeStatus {
  installed: boolean;
  version?: string;
}

export type InstallPhase = 'downloading' | 'mounting' | 'copying' | 'unmounting' | 'cleanup';

export type ProgressCallback = (phase: InstallPhase, percent?: number) => void;

export class LibreOfficeService {
  async checkInstalled(): Promise<LibreOfficeStatus> {
    if (!fs.existsSync(APP_PATH)) {
      return { installed: false };
    }
    const version = await this.getInstalledVersion();
    return { installed: true, version };
  }

  private async getInstalledVersion(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(
        `defaults read "${APP_PATH}/Contents/Info.plist" CFBundleShortVersionString`
      );
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  getDownloadUrl(): string {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const v = LIBREOFFICE_VERSION;
    return `https://download.documentfoundation.org/libreoffice/stable/${v}/mac/${arch}/LibreOffice_${v}_MacOS_${arch}.dmg`;
  }

  private getCachedDmgPath(): string {
    const cacheDir = path.join(app.getPath('userData'), 'libreoffice-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    return path.join(cacheDir, `LibreOffice_${LIBREOFFICE_VERSION}.dmg`);
  }

  async install(onProgress: ProgressCallback): Promise<void> {
    const dmgPath = this.getCachedDmgPath();
    let mountPoint: string | undefined;

    try {
      // 1. Download (skip if valid cache exists)
      if (fs.existsSync(dmgPath) && fs.statSync(dmgPath).size > 0) {
        onProgress('downloading', 100);
      } else {
        await this.downloadFile(this.getDownloadUrl(), dmgPath, (percent) => {
          onProgress('downloading', percent);
        });
      }

      // 2. Mount
      onProgress('mounting');
      mountPoint = await this.mountDmg(dmgPath);

      // 3. Copy .app to /Applications (requires admin)
      onProgress('copying');
      const appEntry = fs.readdirSync(mountPoint).find((f) => f.endsWith('.app'));
      if (!appEntry) throw new Error('No .app found in mounted DMG');
      const src = path.join(mountPoint, appEntry).replace(/'/g, "'\\''");
      const script = `do shell script "cp -R '${src}' '/Applications/'" with administrator privileges`;
      await execFileAsync('osascript', ['-e', script]);

    } catch (err) {
      // If install fails after download, remove the cached DMG so next attempt re-downloads
      try { if (fs.existsSync(dmgPath)) fs.rmSync(dmgPath); } catch { /* ignore */ }
      throw err;
    } finally {
      // 4. Unmount
      if (mountPoint) {
        onProgress('unmounting');
        try { await execFileAsync('hdiutil', ['detach', mountPoint, '-quiet']); } catch { /* ignore */ }
      }
      onProgress('cleanup');
    }
  }

  private mountDmg(dmgPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('hdiutil', ['attach', dmgPath, '-nobrowse', '-plist'], (err, stdout) => {
        if (err) return reject(err);
        // plist output contains <key>mount-point</key><string>/Volumes/...</string>
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
        mod.get(reqUrl, (res) => {
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
          file.on('error', (e) => { fs.rmSync(dest, { force: true }); reject(e); });
          res.on('error', reject);
        }).on('error', reject);
      };
      doRequest(url);
    });
  }
}

export const libreOfficeService = new LibreOfficeService();
