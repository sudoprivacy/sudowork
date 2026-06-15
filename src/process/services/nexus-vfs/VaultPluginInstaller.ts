import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { app } from 'electron';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { extractTarGzWithProgress, extractZipWithProgress } from '../archiveProgress';
import runtimeVersions from '@/shared/runtime-versions.json';
import { COS_RUNTIME_BASE, COS_LEGACY_NEXUS_VFS_BASE } from '@/shared/cos';
import type { NexusVfsStage } from './DynamicNexusVfsService';

/**
 * nexus-vault plugin runtime installer.
 *
 * Mirrors the vault download path that already lives in
 * scripts/download-nexus-vfs.js (build-time only) so packaged users — who never
 * run that script — still receive the vault dylib on first launch. Keeps all
 * vault knowledge (URLs, SHA, platform map, dylib/sig naming, marker, cleanup)
 * inside this single file; the rest of the codebase only talks to the
 * `vaultPluginInstaller` instance through the four-method public API.
 */

const VAULT_VERSION = (runtimeVersions as Record<string, string>)['nexus-vault'];

/** Three mirrors in priority order; byte-for-byte identical to
 *  scripts/download-nexus-vfs.js:41-47. Keep these literals in sync if any of
 *  them change upstream. */
const VAULT_RUNTIME_BASE_URL = `${COS_RUNTIME_BASE}/nexus-vault/release/v${VAULT_VERSION}`;
const VAULT_LEGACY_BASE_URL = `${COS_LEGACY_NEXUS_VFS_BASE}/nexus-vault/release/v${VAULT_VERSION}`;
const VAULT_GITHUB_URL = `https://github.com/nexi-lab/nexus/releases/download/vault-v${VAULT_VERSION}`;

/** Marker file written next to the dylib once an install completes
 *  successfully. Contents = VAULT_VERSION. */
const VAULT_READY_MARKER = '.nexus-vault-ready';

/** `process.platform-process.arch` → archive basename (no extension).
 *  win32-arm64 / linux-arm64 are intentionally absent — upstream vault has no
 *  artifact for them, so isPlatformSupported() returns false for those. */
const VAULT_PLATFORM_ARTIFACT_MAP: Record<string, string> = {
  'darwin-arm64': 'nexus-vault-macos-arm64',
  'darwin-x64': 'nexus-vault-macos-x86_64',
  'linux-x64': 'nexus-vault-linux-x86_64',
  'win32-x64': 'nexus-vault-windows-x86_64',
};

const VAULT_DYLIB_NAME_MAP: Record<string, string> = {
  darwin: 'libnexus_vault.dylib',
  linux: 'libnexus_vault.so',
  win32: 'nexus_vault.dll',
};

/** Known-good SHA256 sums for vault v0.1.3. Must stay byte-identical to
 *  scripts/download-nexus-vfs.js — U9 unit test enforces this. */
export const NEXUS_VAULT_SHA256SUMS: Record<string, string> = {
  'nexus-vault-linux-x86_64.tar.gz': 'ce831d12f55bdd935d928d78df7f4a25078636529d020a1bd0235f68bb8f22f2',
  'nexus-vault-macos-arm64.tar.gz': '603543170a09208fdd9aa3ce5c6aac6149215726042d51d53db4a083fbe728d6',
  'nexus-vault-macos-x86_64.tar.gz': '276e1198c55eeed616ba50d5aa5a421ddbb89459a1be1227f44cc5927692e1eb',
  'nexus-vault-windows-x86_64.zip': '5b91322ddb745c2049e9d675290e3b1a32b2d26bcb67bd96f85dff0f91a3799d',
};

// ── Module-level pure functions (export so tests can call directly without
//    poking class internals) ───────────────────────────────────────────────────

/** Returns the archive filename for the given platform/arch, or null when
 *  upstream vault has no artifact (win-arm64 / linux-arm64). */
export function getVaultArtifactName(platform: string, arch: string): string | null {
  const key = `${platform}-${arch}`;
  const base = VAULT_PLATFORM_ARTIFACT_MAP[key];
  if (!base) return null;
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `${base}${ext}`;
}

/** Returns the dylib filename inside the archive (e.g. libnexus_vault.dylib),
 *  or null if the platform has no vault dylib at all. */
export function getVaultDylibName(platform: string): string | null {
  return VAULT_DYLIB_NAME_MAP[platform] ?? null;
}

/** Returns the detached signature filename. Convention: dylib basename + `.sig`,
 *  matching nexus-vfs's PluginLoader. */
export function getVaultSigName(platform: string): string | null {
  const dylib = getVaultDylibName(platform);
  return dylib ? `${dylib}.sig` : null;
}

// ── Installer class ──────────────────────────────────────────────────────────

type EmitFn = (stage: NexusVfsStage, message: string, percent?: number) => void;

class VaultPluginInstaller {
  private readonly isWindows = process.platform === 'win32';

  /** ~/.nexus-vfs/plugins/. Must remain string-identical to
   *  DynamicNexusVfsService.getPluginDir() — U10 unit test enforces this. */
  getPluginDir(): string {
    return path.join(app.getPath('home'), '.nexus-vfs', 'plugins');
  }

  /** False on win-arm64 / linux-arm64 — vault has no upstream artifact there;
   *  callers should skip vault checks entirely. */
  isPlatformSupported(): boolean {
    return getVaultArtifactName(process.platform, process.arch) !== null;
  }

  /** True only when dylib + marker exist AND marker content == VAULT_VERSION.
   *  Matches scripts/download-nexus-vfs.js:361 three-state semantics. */
  checkInstalledSync(): boolean {
    const dylibName = getVaultDylibName(process.platform);
    if (!dylibName) return false;
    const pluginDir = this.getPluginDir();
    const dylibPath = path.join(pluginDir, dylibName);
    const markerPath = path.join(pluginDir, VAULT_READY_MARKER);
    if (!fs.existsSync(dylibPath)) return false;
    if (!fs.existsSync(markerPath)) return false;
    try {
      return fs.readFileSync(markerPath, 'utf-8').trim() === VAULT_VERSION;
    } catch {
      return false;
    }
  }

  /** Download → SHA-verify → extract → install vault into ~/.nexus-vfs/plugins/.
   *  - Unsupported platform → warn and return (cluster keeps starting without vault).
   *  - All three mirrors 404 → throw with explicit not-available message.
   *  - SHA mismatch / missing dylib → throw (aligned with cluster install policy).
   *  - Missing .sig → warn + unlink any stale .sig (mirrors scripts:436). */
  async install(emit: EmitFn): Promise<void> {
    if (!this.isPlatformSupported()) {
      mainWarn('NexusVault', `Vault plugin not available for ${process.platform}-${process.arch}; skipping.`);
      return;
    }

    if (this.checkInstalledSync()) {
      mainLog('NexusVault', `Vault plugin already installed at v${VAULT_VERSION}; skipping.`);
      return;
    }

    const artifact = getVaultArtifactName(process.platform, process.arch);
    const dylibName = getVaultDylibName(process.platform);
    const sigName = getVaultSigName(process.platform);
    if (!artifact || !dylibName || !sigName) {
      // Defensive: isPlatformSupported() check above should have already
      // returned, so this branch is unreachable in practice.
      mainWarn('NexusVault', `Vault platform metadata missing for ${process.platform}-${process.arch}; skipping.`);
      return;
    }

    const pluginDir = this.getPluginDir();
    const downloadDir = path.join(app.getPath('home'), '.nexus-vfs', 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    const archivePath = path.join(downloadDir, artifact);

    // ── Download with three-mirror fallback ──────────────────────────────────
    const attempts = this.getDownloadUrls(artifact);
    let downloaded = false;
    let lastReason = 'unknown error';
    let allNotFound = true;
    for (const attempt of attempts) {
      emit('downloading', `Downloading nexus-vault from ${attempt.label} (${attempt.url})`, 0);
      try {
        await this.downloadFile(attempt.url, archivePath, emit);
        downloaded = true;
        break;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        lastReason = reason;
        if (reason !== 'NOT_FOUND') allNotFound = false;
        mainWarn('NexusVault', `${attempt.label} download failed: ${reason}`);
      }
    }

    if (!downloaded) {
      if (allNotFound) {
        const msg = `nexus-vault not available for ${process.platform}-${process.arch} in v${VAULT_VERSION} (all mirrors → HTTP 404)`;
        emit('error', msg);
        throw new Error(msg);
      }
      emit('error', `Failed to download nexus-vault: ${lastReason}`);
      throw new Error(lastReason);
    }

    // ── SHA256 integrity check ───────────────────────────────────────────────
    const expectedSha = NEXUS_VAULT_SHA256SUMS[artifact];
    if (!expectedSha) {
      throw new Error(`No known SHA256 for ${artifact}; refusing to install an unverified artifact.`);
    }
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    if (actualSha !== expectedSha) {
      try {
        fs.unlinkSync(archivePath);
      } catch {}
      const msg = `nexus-vault SHA256 mismatch for ${artifact}: expected ${expectedSha}, got ${actualSha}`;
      emit('error', msg);
      throw new Error(msg);
    }
    mainLog('NexusVault', `SHA256 verified: ${actualSha}`);

    // ── Extract ──────────────────────────────────────────────────────────────
    emit('installing', 'Extracting nexus-vault...', 80);
    const extractDir = path.join(downloadDir, `vault-extract-${process.pid}-${process.hrtime.bigint()}`);
    fs.mkdirSync(extractDir, { recursive: true });
    await this.extractArchive(archivePath, extractDir);

    const extractedDylib = this.findFileInDir(extractDir, dylibName);
    if (!extractedDylib) {
      throw new Error(`nexus-vault archive ${artifact} did not contain expected dylib ${dylibName}`);
    }

    // ── Install dylib ────────────────────────────────────────────────────────
    const installedDylib = path.join(pluginDir, dylibName);
    fs.copyFileSync(extractedDylib, installedDylib);
    if (!this.isWindows) {
      fs.chmodSync(installedDylib, 0o755);
    }

    // ── Install signature, or clean up stale one ─────────────────────────────
    // Mirrors scripts/download-nexus-vfs.js:430-441: present in v0.1.2+ archives
    // (cluster strict mode requires it); absent in v0.1.1 (warn, do not throw).
    // Unlink any stale .sig in the latter case so a fresh unsigned dylib never
    // ships next to a signature for a different build.
    const installedSig = path.join(pluginDir, sigName);
    const extractedSig = this.findFileInDir(extractDir, sigName);
    if (extractedSig) {
      fs.copyFileSync(extractedSig, installedSig);
      mainLog('NexusVault', `Installed vault signature: ${installedSig}`);
    } else {
      try {
        fs.unlinkSync(installedSig);
      } catch {}
      mainWarn('NexusVault', `Archive ${artifact} contains no ${sigName}; cluster signature verification will reject this plugin.`);
    }

    // ── Marker + cleanup ─────────────────────────────────────────────────────
    fs.writeFileSync(path.join(pluginDir, VAULT_READY_MARKER), VAULT_VERSION);

    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlinkSync(archivePath);
    } catch {}

    emit('idle', `nexus-vault installed: ${installedDylib}`, 100);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Three-mirror download chain in priority order. */
  private getDownloadUrls(artifact: string): { label: string; url: string }[] {
    return [
      { label: 'Runtime COS', url: `${VAULT_RUNTIME_BASE_URL}/${artifact}` },
      { label: 'Legacy COS', url: `${VAULT_LEGACY_BASE_URL}/${artifact}` },
      { label: 'GitHub Release', url: `${VAULT_GITHUB_URL}/${artifact}` },
    ];
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
                emit('downloading', `Downloading nexus-vault... ${percent}%`, percent);
              }
            });

            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
            file.on('error', (err) => {
              try {
                fs.unlinkSync(destPath);
              } catch {}
              reject(err);
            });
          })
          .on('error', (err) => {
            try {
              fs.unlinkSync(destPath);
            } catch {}
            reject(err);
          });
      };

      doRequest(url);
    });
  }

  /** Vault archives don't have a guaranteed top-level wrapper directory, so we
   *  search recursively (mirrors scripts:findBinaryInDir) instead of relying on
   *  --strip-components. */
  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    if (archivePath.endsWith('.zip')) {
      await extractZipWithProgress(archivePath, targetDir);
    } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      await extractTarGzWithProgress(archivePath, targetDir);
    } else {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
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

export const vaultPluginInstaller = new VaultPluginInstaller();
export { VAULT_VERSION, VAULT_READY_MARKER };
