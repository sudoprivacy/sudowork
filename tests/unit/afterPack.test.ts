import { describe, expect, it } from 'vitest';

const afterPackModule = await import('../../scripts/afterPack.js');
const afterPack = afterPackModule.default as {
  shouldSignArchiveInAfterPack: (archiveName: string) => boolean;
  shouldUseRuntimeEntitlementsInAfterPack: (archiveName: string, nodeArchiveName: string) => boolean;
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
