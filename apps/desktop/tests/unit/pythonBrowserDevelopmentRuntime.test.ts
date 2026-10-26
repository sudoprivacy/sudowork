import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPackaged: false, exists: vi.fn(), run: vi.fn() }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getPath: () => '/owned-profile',
  },
}));
vi.mock('fs', () => ({ existsSync: mocks.exists }));
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.pop() as (error: Error | null, stdout: string, stderr: string) => void;
    mocks.run(...args);
    callback(null, '0.58.8.dev1', '');
  },
  exec: vi.fn(),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainWarn: vi.fn() }));
import { PythonRuntimeService } from '@process/services/python/PythonRuntimeService';
import { BROWSER_WORKER_VERSION } from '@process/services/python/browserRuntimeVersion';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPackaged = false;
  mocks.exists.mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('host-owned development browser runtime', () => {
  it('validates an explicitly selected development interpreter without installing packages', async () => {
    const python = path.resolve('candidate-runtime/python.exe');
    vi.stubEnv('SUDOWORK_DEV_BROWSER_PYTHON', python);
    const service = new PythonRuntimeService();
    expect(await service.prepareBrowserWorkerRuntime()).toBe(python);
    expect(await service.prepareBrowserWorkerRuntime()).toBe(python);
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(python, ['-c', expect.stringContaining('import ai_dev_browser.remote.worker')], expect.objectContaining({ env: expect.objectContaining({ PYTHONPATH: '', PYTHONNOUSERSITE: '1' }) }));
  });

  it('does not accept a development override in a packaged application', async () => {
    mocks.isPackaged = true;
    vi.stubEnv('SUDOWORK_DEV_BROWSER_PYTHON', path.resolve('untrusted/python.exe'));
    await new PythonRuntimeService().prepareBrowserWorkerRuntime();
    expect(mocks.run.mock.calls[0][0]).toContain(path.join('browser-runtime', BROWSER_WORKER_VERSION));
    expect(mocks.run.mock.calls[0][0]).not.toContain('untrusted');
  });

  it('refuses relative and missing paths without launching a process', async () => {
    vi.stubEnv('SUDOWORK_DEV_BROWSER_PYTHON', 'relative/python');
    await expect(new PythonRuntimeService().prepareBrowserWorkerRuntime()).rejects.toThrow('existing absolute path');
    vi.stubEnv('SUDOWORK_DEV_BROWSER_PYTHON', path.resolve('missing/python.exe'));
    mocks.exists.mockReturnValue(false);
    await expect(new PythonRuntimeService().prepareBrowserWorkerRuntime()).rejects.toThrow('existing absolute path');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
