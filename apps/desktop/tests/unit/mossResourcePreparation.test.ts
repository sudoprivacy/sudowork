import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const state = vi.hoisted(() => ({ root: '', isEnabled: true }));
vi.mock('@process/initStorage', () => ({
  ProcessConfig: { getSync: (key: string) => ({ 'eeclaw.serverUrl': 'https://moss.example', 'eeclaw.accountScope': 'account', 'eeclaw.authStorage': { access_token: 'token' } })[key] },
  getHubSkillsDir: () => state.root,
  getHubAssistantsDir: () => state.root,
  clearSkillsCache: vi.fn(),
}));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: async () => 'token' }));
vi.mock('@process/task/AcpSkillManager', () => ({ AcpSkillManager: { resetInstance: vi.fn() } }));
import { prepareMossResources, safeResourcePath, validateMossResourceSnapshot } from '@process/services/mossResourcePreparation';

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-resource-'));
  state.isEnabled = true;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(state.root, { recursive: true, force: true });
});
async function serveArchive(isBadChecksum = false, isSymlink = false) {
  const zip = new JSZip();
  zip.file('SKILL.md', '---\nname: test-skill\ndescription: test\n---\nRun the script.');
  zip.file('scripts/check.sh', '#!/bin/sh\necho local', { unixPermissions: isSymlink ? 0o120777 : 0o100755 });
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
  const digest = createHash('sha256').update(bytes).digest('hex');
  const request = vi.fn(async (url: string) => (url.endsWith('/installed') ? Response.json([{ id: 'skill-1', name: 'test-skill', enabled: state.isEnabled }]) : new Response(bytes, { headers: { 'X-Content-SHA256': isBadChecksum ? 'wrong' : digest } })));
  vi.stubGlobal('fetch', request);
  return request;
}

describe('Moss resource preparation', () => {
  it.each(['../outside', '/absolute', 'C:\\outside', 'nested\\..\\outside'])('rejects path traversal: %s', (value) => expect(() => safeResourcePath(state.root, value)).toThrow());
  it('does not contact Moss when no resources are needed', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    expect((await prepareMossResources()).resources).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
  it('installs immutable content, preserves executable scripts, and reuses its version', async () => {
    await serveArchive();
    const first = await prepareMossResources(undefined, ['skill-1']);
    const second = await prepareMossResources(undefined, ['skill-1']);
    expect(second.resources[0].path).toBe(first.resources[0].path);
    expect((await fs.stat(path.join(first.resources[0].path, 'scripts/check.sh'))).mode & 0o100).toBe(0o100);
    expect(await fs.readdir(state.root)).toHaveLength(1);
    await validateMossResourceSnapshot(first.resources);
    state.isEnabled = false;
    await expect(validateMossResourceSnapshot(first.resources)).rejects.toThrow('revoked');
  });
  it('does not publish corrupt or symlink archives', async () => {
    await serveArchive(true);
    await expect(prepareMossResources(undefined, ['skill-1'])).rejects.toThrow('checksum');
    await serveArchive(false, true);
    await expect(prepareMossResources(undefined, ['skill-1'])).rejects.toThrow('symlinks');
    expect(await fs.readdir(state.root)).toEqual([]);
  });
});
