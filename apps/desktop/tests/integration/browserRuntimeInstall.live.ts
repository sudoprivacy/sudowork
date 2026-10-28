/** Real Electron and the product's first-use PyPI installer; no runtime mocks. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const execute = promisify(execFile);

async function main(): Promise<void> {
  const destination = process.env.SUDOWORK_BROWSER_RUNTIME_INSTALL_EVIDENCE;
  const expectedVersion = process.env.SUDOWORK_BROWSER_EXPECTED_WORKER_VERSION;
  assert(destination && path.isAbsolute(destination));
  assert(expectedVersion && /^\d+\.\d+\.\d+$/.test(expectedVersion));
  const home = path.join(destination, 'home');
  const userData = path.join(destination, 'userData');
  assert(!existsSync(path.join(userData, 'browser-runtime')), 'Use a fresh isolated acceptance directory');
  mkdirSync(home, { recursive: true });
  mkdirSync(userData, { recursive: true });
  // Keep fixture scratch files inside the explicit acceptance directory.
  process.chdir(destination);
  app.setPath('home', home);
  app.setPath('userData', userData);
  await app.whenReady();

  // Import only after Electron's actual paths are isolated. The same service
  // and pinned package selection run when BrowserPanel prepares its worker.
  const { pythonRuntimeService } = await import('../../src/process/services/python/PythonRuntimeService');
  const started = Date.now();
  const python = await pythonRuntimeService.prepareBrowserWorkerRuntime();
  const runtime = path.join(userData, 'browser-runtime', expectedVersion);
  assert(path.relative(runtime, python) && !path.relative(runtime, python).startsWith('..'));
  const { stdout } = await execute(
    python,
    [
      '-c',
      "import ai_dev_browser,json,sys; from importlib.metadata import distribution; from pathlib import Path; d=distribution('ai-dev-browser'); print(json.dumps({'version':d.version,'installedModule':ai_dev_browser.__file__,'insideEnvironment':Path(ai_dev_browser.__file__).is_relative_to(sys.prefix),'directUrl':d.read_text('direct_url.json')}))",
    ],
    { env: { ...process.env, PYTHONPATH: '', PYTHONNOUSERSITE: '1' }, timeout: 15_000 }
  );
  const installed = JSON.parse(stdout) as { version: string; installedModule: string; insideEnvironment: boolean; directUrl: string | null };
  assert.equal(installed.version, expectedVersion);
  assert.equal(installed.insideEnvironment, true);
  assert.equal(installed.directUrl, null);
  assert.equal(await pythonRuntimeService.prepareBrowserWorkerRuntime(), python);
  const evidence = { passed: true, actualElectron: true, actualProductInstaller: true, coldEnvironment: true, publicPyPI: true, elapsedMs: Date.now() - started, ...installed };
  writeFileSync(path.join(destination, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}

void main().then(
  () => app.quit(),
  (error: unknown) => {
    console.error(error);
    app.exit(1);
  }
);
