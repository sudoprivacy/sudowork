import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheSharpLibvips } from '../../../../.github/scripts/cache-sharp-libvips.mjs';

let cacheRoot: string;
beforeEach(async () => {
  cacheRoot = await mkdtemp(join(tmpdir(), 'sudowork-libvips-test-'));
});
afterEach(async () => {
  await rm(cacheRoot, { recursive: true, force: true });
});

describe('verified native dependency cache', () => {
  it.each(['linux', 'win32'])('rejects a corrupt %s archive instead of feeding it to dependency installation', async (platform) => {
    const directory = join(cacheRoot, '_libvips');
    await mkdir(directory);
    const destination = join(directory, `libvips-8.14.5-${platform}-x64.tar.br`);
    await writeFile(destination, 'Invalid archive');
    await expect(cacheSharpLibvips({ cacheRoot, platform, arch: 'x64' })).rejects.toThrow('Integrity mismatch');
    expect(await readFile(destination, 'utf8')).toBe('Invalid archive');
  });

  it('refuses unsupported targets before creating a cache or starting a download', async () => {
    await expect(cacheSharpLibvips({ cacheRoot, platform: 'linux', arch: 'arm64' })).rejects.toThrow('Unsupported libvips cache target');
    await expect(readFile(join(cacheRoot, '_libvips'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
