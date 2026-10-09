import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@process': path.resolve(__dirname, 'src/process') } },
  test: {
    environment: 'node',
    include: ['tests/integration/browserBackend.live.ts'],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
