import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { app } from 'electron';
import { COS_RUNTIME_BASE, COS_LEGACY_NEXUS_VFS_BASE } from '@sudowork/common/cos';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';
import runtimeSha256 from '@/shared/runtime-sha256.json';
import runtimePlugins from '@/shared/runtime-plugins.json';
import { extractTarGzWithProgress, extractZipWithProgress } from '../archiveProgress';
import type { NexusVfsStage } from './DynamicNexusVfsService';

interface IRuntimePlugin {
  name: string;
  artifactPrefix: string;
  releaseTagPrefix: string;
  publishedPlatforms: string[];
  dylib: Partial<Record<string, string>>;
}

type EmitFn = (stage: NexusVfsStage, message: string, percent?: number) => void;
const plugins: IRuntimePlugin[] = runtimePlugins;
const vault = plugins.find((plugin) => plugin.name === 'nexus_vault')!;
const versions: Record<string, string> = runtimeVersions;
export const VAULT_VERSION = versions[vault.artifactPrefix];
export const VAULT_READY_MARKER = '.nexus-vault-ready';
export const NEXUS_VAULT_SHA256SUMS: Record<string, string> = runtimeSha256;

/** Resolve only artifacts supported by the shared packaging platform matrix. */
function getArtifactName(plugin: IRuntimePlugin, platform: string, arch: string): string | null {
  if (!plugin.publishedPlatforms.includes(`${platform}-${arch}`)) return null;
  const osName = { darwin: 'macos', linux: 'linux', win32: 'windows' }[platform];
  const archName = { arm64: 'arm64', x64: 'x86_64' }[arch];
  if (!osName || !archName) return null;
  return `${plugin.artifactPrefix}-${osName}-${archName}${platform === 'win32' ? '.zip' : '.tar.gz'}`;
}

export function getVaultArtifactName(platform: string, arch: string): string | null {
  return getArtifactName(vault, platform, arch);
}

export function getVaultDylibName(platform: string): string | null {
  return vault.dylib[platform] ?? null;
}

export function getVaultSigName(platform: string): string | null {
  const name = getVaultDylibName(platform);
  return name ? `${name}.sig` : null;
}

/** Install every supported signed plugin alongside the matching daemon ABI. */
class NexusPluginInstaller {
  constructor(private readonly plugin: IRuntimePlugin) {}

  private get version(): string {
    return versions[this.plugin.artifactPrefix];
  }

  private get marker(): string {
    return `.${this.plugin.artifactPrefix}-ready`;
  }

  getPluginDir(): string {
    return path.join(app.getPath('home'), '.nexus-vfs', 'plugins');
  }

  isPlatformSupported(): boolean {
    return getArtifactName(this.plugin, process.platform, process.arch) !== null;
  }

  checkInstalledSync(): boolean {
    const dylib = this.plugin.dylib[process.platform];
    if (!dylib) return false;
    const dir = this.getPluginDir();
    try {
      return fs.statSync(path.join(dir, dylib)).isFile() && fs.statSync(path.join(dir, `${dylib}.sig`)).size === 64 && fs.readFileSync(path.join(dir, this.marker), 'utf8').trim() === this.version;
    } catch {
      return false;
    }
  }

  private getBundledPath(artifact: string): string | null {
    const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
    const candidate = path.join(root, `v${this.version}-${artifact}`);
    return fs.existsSync(candidate) && fs.statSync(candidate).size >= 100_000 ? candidate : null;
  }

  async install(emit: EmitFn): Promise<void> {
    if (!this.isPlatformSupported() || this.checkInstalledSync()) return;
    const artifact = getArtifactName(this.plugin, process.platform, process.arch)!;
    const dylib = this.plugin.dylib[process.platform]!;
    const sigName = `${dylib}.sig`;
    const pluginDir = this.getPluginDir();
    const downloadDir = path.join(app.getPath('home'), '.nexus-vfs', 'downloads');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(downloadDir, { recursive: true });
    const bundledPath = this.getBundledPath(artifact);
    const archivePath = bundledPath ?? path.join(downloadDir, artifact);
    const extractDir = fs.mkdtempSync(path.join(downloadDir, `${this.plugin.artifactPrefix}-extract-`));
    try {
      if (!bundledPath) {
        let isDownloaded = false;
        let lastError: unknown;
        for (const url of this.getDownloadUrls(artifact)) {
          emit('downloading', `Downloading ${this.plugin.artifactPrefix} from ${url}`, 0);
          try {
            await this.downloadFile(url, archivePath, emit);
            isDownloaded = true;
            break;
          } catch (error) {
            lastError = error;
            mainWarn('NexusPlugins', `Download failed: ${String(error)}`);
          }
        }
        if (!isDownloaded) throw new Error(`Failed to download ${artifact}: ${String(lastError)}`);
      }
      // afterPack preserves signed plugin archives byte-for-byte, so bundled
      // and remote plugin archives can both be checked against the pinned SHA.
      const expected = NEXUS_VAULT_SHA256SUMS[artifact];
      if (!expected) throw new Error(`No known SHA256 for ${artifact}; refusing unverified plugin.`);
      const actual = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
      if (actual !== expected) throw new Error(`SHA256 mismatch for ${artifact}: expected ${expected}, got ${actual}`);
      emit('installing', `Extracting ${this.plugin.artifactPrefix}...`, 80);
      if (archivePath.endsWith('.zip')) await extractZipWithProgress(archivePath, extractDir);
      else await extractTarGzWithProgress(archivePath, extractDir);
      const extractedDylib = this.findFileInDir(extractDir, dylib);
      const extractedSig = this.findFileInDir(extractDir, sigName);
      if (!extractedDylib || !extractedSig || fs.statSync(extractedSig).size !== 64) throw new Error(`Archive ${artifact} must contain ${dylib} and its 64-byte signature`);
      fs.copyFileSync(extractedDylib, path.join(pluginDir, dylib));
      fs.copyFileSync(extractedSig, path.join(pluginDir, sigName));
      if (process.platform !== 'win32') fs.chmodSync(path.join(pluginDir, dylib), 0o755);
      fs.writeFileSync(path.join(pluginDir, this.marker), this.version);
      mainLog('NexusPlugins', `Installed ${this.plugin.artifactPrefix} v${this.version}`);
      emit('idle', `${this.plugin.artifactPrefix} installed`, 100);
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
      if (!bundledPath) fs.rmSync(archivePath, { force: true });
    }
  }

  private getDownloadUrls(artifact: string): string[] {
    const tail = `${this.plugin.artifactPrefix}/release/v${this.version}/${artifact}`;
    return [`${COS_RUNTIME_BASE}/${tail}`, `${COS_LEGACY_NEXUS_VFS_BASE}/${tail}`, `https://github.com/nexi-lab/nexus/releases/download/${this.plugin.releaseTagPrefix}-v${this.version}/${artifact}`];
  }

  /** HTTP(S) download with redirect chasing, content-length progress, and a
   *  distinct NOT_FOUND signal for 404 so caller can detect all-mirrors-404. */
  private downloadFile(url: string, destPath: string, emit: EmitFn): Promise<void> {
    return new Promise((resolve, reject) => {
      let redirects = 0;

      const doRequest = (requestUrl: string): void => {
        if (redirects++ > 10) {
          reject(new Error('Too many redirects'));
          return;
        }

        const protocol = requestUrl.startsWith('https') ? https : http;
        protocol
          .get(requestUrl, (response) => {
            const code = response.statusCode;
            if (code && [301, 302, 307, 308].includes(code) && response.headers.location) {
              response.resume();
              doRequest(response.headers.location);
              return;
            }

            if (code === 404) {
              response.resume();
              reject(new Error('NOT_FOUND'));
              return;
            }

            if (code !== 200) {
              response.resume();
              reject(new Error(`HTTP ${code}`));
              return;
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const file = fs.createWriteStream(destPath);

            response.on('data', (chunk: Buffer) => {
              downloaded += chunk.length;
              if (totalSize > 0) {
                const percent = Math.round((downloaded / totalSize) * 100);
                emit('downloading', `Downloading ${this.plugin.artifactPrefix}... ${percent}%`, percent);
              }
            });

            response.pipe(file);
            file.on('finish', () => {
              file.close(() => resolve());
            });
            file.on('error', (err) => {
              try {
                fs.unlinkSync(destPath);
              } catch {
                /* best-effort cleanup */
              }
              reject(err);
            });
          })
          .on('error', (err) => {
            try {
              fs.unlinkSync(destPath);
            } catch {
              /* best-effort cleanup */
            }
            reject(err);
          });
      };

      doRequest(url);
    });
  }

  /** Depth-first recursive lookup for `wanted` inside `dir`. Returns the
   *  absolute path of the first match or null. */
  private findFileInDir(dir: string, wanted: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = this.findFileInDir(full, wanted);
        if (found) return found;
      } else if (entry.name === wanted) {
        return full;
      }
    }
    return null;
  }
}

export const nexusPluginInstallers = plugins.map((plugin) => new NexusPluginInstaller(plugin));
export const vaultPluginInstaller = nexusPluginInstallers[plugins.indexOf(vault)];
