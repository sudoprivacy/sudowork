import path from 'node:path';
import { loadConfigFromFile } from 'electron-vite';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('bundles the external provider client with production aliases without reading generated package dist', async () => {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.resolve('electron.vite.config.ts'));
  expect(loaded?.config.main?.resolve).toBeDefined();
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: loaded!.config.main!.resolve,
    plugins: [
      {
        name: 'reject-contract-dist',
        load(id) {
          if (id.replace(/\\/g, '/').includes('/contracts/dist/')) {
            throw new Error('Production external providers must bundle the contract from source');
          }
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: path.resolve('../../packages/moss-client/src/MossExternalProviderClient.ts'), formats: ['es'] },
      rollupOptions: { external: ['zod'] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const modules = outputs.flatMap((output) => {
    if (!('output' in output)) throw new Error('Expected a completed build');
    return output.output.flatMap((chunk) => (chunk.type === 'chunk' ? Object.keys(chunk.modules) : []));
  });
  expect(modules.map((id) => id.replace(/\\/g, '/'))).toContain(path.resolve('../../packages/contracts/src/external-provider.gen.ts').replace(/\\/g, '/'));
});
