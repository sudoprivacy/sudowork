import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';
import { runElectronNode } from '../runElectronNode';

it('exits cleanly after the upstream fetch and delayed-task shutdown fixture', async () => {
  const require = createRequire(import.meta.url);
  const version = require('electron/package.json').version as string;
  const fixture = path.resolve(__dirname, '../fixtures/electron-fetch-shutdown.cjs');
  for (let index = 0; index < 20; index++) {
    const { stdout } = await runElectronNode([fixture], 10_000);
    expect(JSON.parse(stdout.trim())).toEqual({ electron: version, completed: true });
  }
}, 30_000);
