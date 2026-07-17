import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/sudowork-poppler-test-user-data'),
  },
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

    expect(service.getBinDir()).toBe(path.join('/tmp/sudowork-poppler-test-user-data', 'poppler-runtime', 'current', 'bin'));
    expect(service.getToolPath('pdftotext')).toBe(path.join('/tmp/sudowork-poppler-test-user-data', 'poppler-runtime', 'current', 'bin', 'pdftotext'));
  });

  it('resolves managed Windows tools from Library/bin with exe suffix', () => {
    setProcessTarget('win32', 'x64');
    const service = new PopplerRuntimeService();

    expect(service.getBinDir()).toBe(path.join('/tmp/sudowork-poppler-test-user-data', 'poppler-runtime', 'current', 'Library', 'bin'));
    expect(service.getToolPath('pdftotext')).toBe(path.join('/tmp/sudowork-poppler-test-user-data', 'poppler-runtime', 'current', 'Library', 'bin', 'pdftotext.exe'));
  });
});
