import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const afterPackModule = await import('../../scripts/afterPack.js');
const afterPack = afterPackModule.default as {
  writeInstallerManifest: (appOutDir: string) => string[];
  verifyBrowserMcpResources: (resourcesDir: string) => void;
};

describe('Packaged browser MCP resources', () => {
  it('rejects an installation without the shared adapter before signing or publishing', () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-mcp-package-'));
    try {
      mkdirSync(join(root, 'browser-panel-mcp'));
      writeFileSync(join(root, 'browser-panel-mcp', 'index.js'), 'legacy entry');
      expect(() => afterPack.verifyBrowserMcpResources(root)).toThrow('shared.js');
      writeFileSync(join(root, 'browser-panel-mcp', 'shared.js'), 'shared adapter');
      expect(() => afterPack.verifyBrowserMcpResources(root)).not.toThrow();
      writeFileSync(join(root, 'browser-panel-mcp', 'shared.js'), '');
      expect(() => afterPack.verifyBrowserMcpResources(root)).toThrow('shared.js');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
