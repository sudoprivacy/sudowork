import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/sudowork-poppler-test-user-data'),
  },
}));

vi.mock('@/process/utils', () => ({
  getDataPath: vi.fn(() => '/tmp/sudowork-poppler-test-nexus'),
}));

import { PopplerRuntimeService } from '@/process/services/poppler/PopplerRuntimeService';

const originalPlatform = process.platform;
const originalArch = process.arch;

function setProcessTarget(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
}

describe('PopplerRuntimeService', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'arch', { value: originalArch });
  });

  it('resolves managed macOS/Linux tools from bin', () => {
    setProcessTarget('darwin', 'arm64');
    const service = new PopplerRuntimeService();

    expect(service.getBinDir()).toBe(path.join('/tmp/sudowork-poppler-test-nexus', 'sudowork', 'poppler-runtime', 'current', 'bin'));
    expect(service.getToolPath('pdftotext')).toBe(path.join('/tmp/sudowork-poppler-test-nexus', 'sudowork', 'poppler-runtime', 'current', 'bin', 'pdftotext'));
  });

  it('includes managed library directory in macOS tool environment', () => {
    setProcessTarget('darwin', 'arm64');
    const service = new PopplerRuntimeService();

    expect(service.getToolEnv().DYLD_LIBRARY_PATH?.split(path.delimiter)[0]).toBe(path.join('/tmp/sudowork-poppler-test-nexus', 'sudowork', 'poppler-runtime', 'current', 'lib'));
  });

  it('resolves managed Windows tools from Library/bin with exe suffix', () => {
    setProcessTarget('win32', 'x64');
    const service = new PopplerRuntimeService();

    expect(service.getBinDir()).toBe(path.join('/tmp/sudowork-poppler-test-nexus', 'sudowork', 'poppler-runtime', 'current', 'Library', 'bin'));
    expect(service.getToolPath('pdftotext')).toBe(path.join('/tmp/sudowork-poppler-test-nexus', 'sudowork', 'poppler-runtime', 'current', 'Library', 'bin', 'pdftotext.exe'));
  });

  it('includes managed Windows bin directory in PATH without Unix library variables', () => {
    setProcessTarget('win32', 'x64');
    const service = new PopplerRuntimeService();
    const env = service.getToolEnv();

    expect(env.PATH?.split(path.delimiter)[0]).toBe(path.join('/tmp/sudowork-poppler-test-nexus', 'sudowork', 'poppler-runtime', 'current', 'Library', 'bin'));
    expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
    expect(env.LD_LIBRARY_PATH).toBeUndefined();
  });

  it('rewrites symlinks that point at the transient stage directory', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sudowork-poppler-links-'));
    try {
      const stageDir = path.join(tempDir, '.stage', 'poppler-1');
      const installDir = path.join(tempDir, 'current');
      await fs.promises.mkdir(path.join(stageDir, 'lib'), { recursive: true });
      await fs.promises.writeFile(path.join(stageDir, 'lib', 'libpoppler.162.0.0.dylib'), 'dylib');
      await fs.promises.symlink(path.join(stageDir, 'lib', 'libpoppler.162.0.0.dylib'), path.join(stageDir, 'lib', 'libpoppler.162.dylib'));

      const service = new PopplerRuntimeService() as unknown as {
        rewriteStageSymlinks(rootDir: string, stageDir: string, installDir: string): void;
      };
      service.rewriteStageSymlinks(stageDir, stageDir, installDir);
      await fs.promises.rename(stageDir, installDir);

      expect(await fs.promises.readlink(path.join(installDir, 'lib', 'libpoppler.162.dylib'))).toBe('libpoppler.162.0.0.dylib');
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
