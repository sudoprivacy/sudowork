import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

/** Run the installed desktop runtime and preserve child diagnostics on failure. */
export async function runElectronNode(args: string[], timeout: number) {
  const require = createRequire(import.meta.url);
  const electron = require('electron') as string;
  try {
    return await promisify(execFile)(electron, args, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as Error & {
      code?: string | number;
      signal?: string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    throw new Error(`Electron subprocess failed (code=${failure.code}, signal=${failure.signal}, killed=${failure.killed})\nstdout:\n${failure.stdout ?? ''}\nstderr:\n${failure.stderr ?? ''}`, { cause: error });
  }
}

/** Preserve the same native test selection, worker limit and child deadline. */
export function runElectronNativeTest(file: string, timeout: number) {
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  return runElectronNode([cli, 'run', file, '--maxWorkers=1'], timeout);
}
