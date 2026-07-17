import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve('skills/_builtin/local-knowledge-base/scripts/wiki.mjs');

describe('local KB skill CLI', () => {
  let homeDir = '';

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-cli-'));
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('prints help without requiring a running desktop service', async () => {
    const { stdout } = await runCli(['help']);

    expect(stdout).toContain('node scripts/wiki.mjs search "<query>"');
  });

  it('rejects missing file argument before requesting the local service', async () => {
    const error = await runCliExpectFailure(['read', '--file']);

    expect(error.stderr).toContain('Usage: node scripts/wiki.mjs read --file <file> <spaceId>');
  });

  it('rejects missing doc id before requesting the local service', async () => {
    const error = await runCliExpectFailure(['read', '--doc']);

    expect(error.stderr).toContain('Usage: node scripts/wiki.mjs read --doc <docId> <spaceId>');
  });

  it('rejects non-loopback discovery hosts', async () => {
    const discoveryDir = path.join(homeDir, '.nexus', 'sudowork', 'local-kb');
    await fs.mkdir(discoveryDir, { recursive: true });
    await fs.writeFile(path.join(discoveryDir, 'skill-server.json'), JSON.stringify({ host: 'example.com', port: 80, token: '0123456789abcdef' }), 'utf8');

    const error = await runCliExpectFailure(['list']);

    expect(error.stderr).toContain('Sudowork local knowledge base service is not running or not ready');
  });

  async function runCli(args: string[]) {
    return execFileAsync(process.execPath, [scriptPath, ...args], { env: { ...process.env, HOME: homeDir } });
  }

  async function runCliExpectFailure(args: string[]) {
    try {
      await runCli(args);
      throw new Error('CLI succeeded unexpectedly');
    } catch (err) {
      return err as { stdout: string; stderr: string };
    }
  }
});
