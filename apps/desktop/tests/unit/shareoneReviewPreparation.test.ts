import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveNpmCli, reviewGitEnvironment, reviewFrontendEnvironment } from '../../scripts/prepare-shareone-review.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sudowork-review-build-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('portable private review build preparation', () => {
  it.each([
    ['Windows', 'node.exe', 'node_modules/npm/bin/npm-cli.js'],
    ['Unix', 'bin/node', 'lib/node_modules/npm/bin/npm-cli.js'],
  ])('resolves npm from the %s Node distribution layout', async (_label, node, npm) => {
    const executable = join(root, node);
    const expected = join(root, npm);
    await mkdir(dirname(expected), { recursive: true });
    await writeFile(expected, 'Fixture npm entry');
    expect(resolveNpmCli(executable, join(root, 'bun.exe'))).toBe(expected);
  });

  it('reports an absent npm runtime before running an install', () => {
    expect(() => resolveNpmCli(join(root, 'node'), undefined)).toThrow('installed Node.js/npm runtime');
  });

  it('scopes the private token to ShareOne without overwriting inherited Git settings', () => {
    const inherited = { SHAREONE_REVIEW_GITHUB_TOKEN: 'fixture-token', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.version', GIT_CONFIG_VALUE_0: 'HTTP/1.1' };
    const result = reviewGitEnvironment(inherited);
    expect(result.GIT_CONFIG_COUNT).toBe('2');
    expect(result.GIT_CONFIG_KEY_0).toBe('http.version');
    expect(result.GIT_CONFIG_VALUE_0).toBe('HTTP/1.1');
    expect(result.GIT_CONFIG_KEY_1).toBe('http.https://github.com/sudoprivacy/shareone.git.extraheader');
    expect(result.GIT_CONFIG_VALUE_1).toBe(`AUTHORIZATION: basic ${Buffer.from('x-access-token:fixture-token').toString('base64')}`);
    expect(inherited.GIT_CONFIG_COUNT).toBe('1');
    expect(result.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('fails with a useful credential error in CI instead of attempting an interactive prompt', () => {
    expect(() => reviewGitEnvironment({ CI: 'true' })).toThrow('SHAREONE_REVIEW_GITHUB_TOKEN');
    expect(reviewGitEnvironment({}).GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('uses the host frontend toolchain when packaging for another architecture or Electron', () => {
    const original = {
      npm_config_arch: 'arm64',
      npm_config_target_arch: 'arm64',
      npm_config_runtime: 'electron',
      npm_config_target: '40.8.5',
      npm_config_disturl: 'https://electronjs.org/headers',
      SHAREONE_REVIEW_GITHUB_TOKEN: 'fixture-token',
      GH_TOKEN: 'fixture-fallback',
      PATH: 'host-path',
      npm_config_cache: 'verified-cache',
    };
    expect(reviewFrontendEnvironment(original)).toEqual({ PATH: 'host-path', npm_config_cache: 'verified-cache' });
    expect(original.npm_config_arch).toBe('arm64');
  });
});
