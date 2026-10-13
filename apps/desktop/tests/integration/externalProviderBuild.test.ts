import path from 'node:path';
import { loadConfigFromFile } from 'electron-vite';
import { build } from 'vite';
import { expect, it } from 'vitest';

it.each(['main', 'renderer'] as const)('bundles the external provider client in %s without generated package dist', async (target) => {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.resolve('electron.vite.config.ts'));
  expect(loaded?.config[target]?.resolve).toBeDefined();
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: loaded!.config[target]!.resolve,
    plugins: [
      {
        name: 'external-provider-source-probe',
        resolveId(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized === 'external-provider-build-probe' || normalized.endsWith('/external-provider-build-probe')) return '\0external-provider-build-probe';
        },
        load(id) {
          if (id === '\0external-provider-build-probe') return 'export { applyExternalEventsPage } from "@sudowork/moss-client/external-providers"';
          if (/\/(?:contracts|moss-client)\/dist\//.test(id.replace(/\\/g, '/'))) {
            throw new Error('Production external providers must bundle the contract from source');
          }
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: 'external-provider-build-probe', formats: ['es'] },
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
