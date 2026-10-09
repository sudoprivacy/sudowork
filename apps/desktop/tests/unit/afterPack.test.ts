import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const afterPackModule = await import('../../scripts/afterPack.js');
const afterPack = afterPackModule.default as {
  shouldSignArchiveInAfterPack: (archiveName: string) => boolean;
  shouldUseRuntimeEntitlementsInAfterPack: (archiveName: string, nodeArchiveName: string) => boolean;
  writeInstallerManifest: (appOutDir: string) => string[];
};

describe('afterPack archive signing filters', () => {
  it('skips Nexus plugin archives so detached plugin signatures stay valid', () => {
    expect(afterPack.shouldSignArchiveInAfterPack('v0.4.0-nexus-vault-macos-arm64.tar.gz')).toBe(false);
    expect(afterPack.shouldSignArchiveInAfterPack('v0.3.0-nexus-local-connector-macos-arm64.tar.gz')).toBe(false);
    expect(afterPack.shouldSignArchiveInAfterPack('v0.5.0-nexus-fuse-plugin-linux-x86_64.tar.gz')).toBe(false);
    expect(afterPack.shouldSignArchiveInAfterPack('v0.4.0-nexus-vault-windows-x86_64.zip')).toBe(false);
  });

  it('still signs runtime archives that do not carry Nexus plugin signatures', () => {
    expect(afterPack.shouldSignArchiveInAfterPack('v0.4.0-nexusd-cluster-macos-aarch64.tar.gz')).toBe(true);
    expect(afterPack.shouldSignArchiveInAfterPack('node-darwin-arm64.tar.gz')).toBe(true);
    expect(afterPack.shouldSignArchiveInAfterPack('v0.1.11-scode-macos-arm64.tar.gz')).toBe(true);
  });

  it('uses runtime entitlements for node and nexusd-cluster archives', () => {
    expect(afterPack.shouldUseRuntimeEntitlementsInAfterPack('node-darwin-arm64.tar.gz', 'node-darwin-arm64.tar.gz')).toBe(true);
    expect(afterPack.shouldUseRuntimeEntitlementsInAfterPack('v0.4.0-nexusd-cluster-macos-aarch64.tar.gz', 'node-darwin-arm64.tar.gz')).toBe(true);
    expect(afterPack.shouldUseRuntimeEntitlementsInAfterPack('v0.1.11-scode-macos-arm64.tar.gz', 'node-darwin-arm64.tar.gz')).toBe(false);
    expect(afterPack.shouldUseRuntimeEntitlementsInAfterPack('v0.4.0-nexus-vault-macos-arm64.tar.gz', 'node-darwin-arm64.tar.gz')).toBe(false);
  });
});

describe('Windows packaged installation ownership', () => {
  it('records individual files before installation and preserves Unicode filenames and the manifest itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'installer-ownership-'));
    try {
      mkdirSync(join(root, 'resources', 'nested'), { recursive: true });
      writeFileSync(join(root, 'Sudowork.exe'), 'packaged executable');
      writeFileSync(join(root, 'resources', 'nested', '说明.txt'), 'packaged documentation');
      const files = afterPack.writeInstallerManifest(root);
      expect(files).toEqual(['Sudowork.exe', 'resources\\installer-owned-files.txt', 'resources\\nested\\说明.txt']);
      const manifest = readFileSync(join(root, 'resources', 'installer-owned-files.txt'), 'utf16le');
      expect(manifest).toBe('\ufeffsudowork-owned-files-v1\r\n' + files.join('\r\n') + '\r\n');
      writeFileSync(join(root, 'user-added.txt'), 'user data added after installation');
      writeFileSync(join(root, 'resources', 'nested', 'user-added.txt'), 'nested user data');
      expect(readFileSync(join(root, 'resources', 'installer-owned-files.txt'), 'utf16le')).toBe(manifest);
      expect(files).not.toContain('resources');
      expect(files).not.toContain('resources\\nested');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
