import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('waits for the document body when CDP attaches before the renderer loads', async () => {
  const source = readFileSync(path.resolve(__dirname, '../../scripts/cdp-dev-shim-smoke.js'), 'utf-8');
  const match = source.match(/const readiness = await evaluateInRendererResilient\(\s*cdpPort,\s*`([\s\S]*?)`\s*\);/);
  expect(match).not.toBeNull();
  const expression = runInNewContext('`' + match![1] + '`') as string;
  const document: { body: { innerText: string } | null } = { body: null };
  const result = runInNewContext(expression, { document, Date, setTimeout }) as Promise<{ ready: boolean; elapsedMs: number }>;
  setTimeout(() => {
    document.body = { innerText: 'New task' };
  }, 20);

  await expect(result).resolves.toEqual({ ready: true, elapsedMs: expect.any(Number) });
});
