import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const afterPackModule = await import('../../scripts/afterPack.js');
const afterPack = afterPackModule.default as {
  shouldSignArchiveInAfterPack: (archiveName: string) => boolean;
  shouldUseRuntimeEntitlementsInAfterPack: (archiveName: string, nodeArchiveName: string) => boolean;
  pruneOnnxRuntimeBinaries: (resourcesDir: string, targetPlatform: string, targetArch: string) => number;
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

  it('keeps only the target ONNX Runtime platform and architecture', () => {
    const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-'));
    const root = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');

    for (const target of ['darwin/arm64', 'darwin/x64', 'linux/arm64', 'win32/x64']) {
      fs.mkdirSync(path.join(root, target), { recursive: true });
      fs.writeFileSync(path.join(root, target, 'binding.node'), target);
    }

    expect(afterPack.pruneOnnxRuntimeBinaries(resourcesDir, 'darwin', 'arm64')).toBe(3);
    expect(fs.readdirSync(root)).toEqual(['darwin']);
    expect(fs.readdirSync(path.join(root, 'darwin'))).toEqual(['arm64']);

    fs.rmSync(resourcesDir, { recursive: true, force: true });
  });
});
