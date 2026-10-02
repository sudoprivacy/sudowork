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
vi.mock('@process/services/mossCatalogSelection', () => ({ prepareLocalCatalogSelection: async () => undefined }));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: async () => 'token' }));
vi.mock('@process/task/AcpSkillManager', () => ({ AcpSkillManager: { resetInstance: vi.fn() } }));
import { prepareMossResources, readMossAssistantSnapshot, safeResourcePath, validateMossResourceSnapshot } from '@process/services/mossResourcePreparation';

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
  it('reloads the selected assistant snapshot even when another version with the same ID is installed', async () => {
    let rules = '你是大白，我是小白';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/installed')) return Response.json([{ id: 'agent-id', name: '大白', enabledSkills: [] }]);
        const bytes = await new JSZip()
          .file('system.md', rules)
          .file('_moss_meta.json', JSON.stringify({ display_name: '大白', ruleFile: 'system.md', skills: [] }))
          .generateAsync({ type: 'nodebuffer' });
        return new Response(bytes, { headers: { 'X-Content-SHA256': createHash('sha256').update(bytes).digest('hex') } });
      })
    );
    const original = await prepareMossResources('agent-id');
    rules = '你是大黑';
    const updated = await prepareMossResources('agent-id');
    expect(original.resources[0].path).not.toBe(updated.resources[0].path);

    const extra = { mossAccountScope: 'account', presetAssistantId: 'agent-id', mossResources: original.resources };
    const first = await readMossAssistantSnapshot(extra);
    const resumed = await readMossAssistantSnapshot(extra);
    expect(first?.meta.display_name).toBe('大白');
    expect(first?.directory).toBe(original.resources[0].path);
    expect(first?.presetContext).toBe(original.presetContext);
    expect(first?.presetContext).toContain('你是大白，我是小白');
    expect(first?.presetContext).not.toContain('你是大黑');
    expect(resumed).toEqual(first);
    expect((await readMossAssistantSnapshot({ ...extra, mossResources: updated.resources }))?.presetContext).toContain('你是大黑');
  });
  it('does not fall back to unrelated presets for missing, invalid or cross-account snapshots', async () => {
    await expect(readMossAssistantSnapshot({ presetAssistantId: 'builtin-cowork' })).resolves.toBeUndefined();
    await expect(readMossAssistantSnapshot({ mossAccountScope: 'another-account', presetAssistantId: 'agent-id' })).rejects.toThrow('different Moss account');
    await expect(readMossAssistantSnapshot({ mossAccountScope: 'account', presetAssistantId: 'agent-id', mossResources: [] })).rejects.toThrow('snapshot is missing');
    const extra = {
      mossAccountScope: 'account',
      presetAssistantId: 'agent-id',
      mossResources: [{ id: 'agent-id', kind: 'agents' as const, digest: 'digest', path: path.join(state.root, '..', 'outside') }],
    };
    await expect(readMossAssistantSnapshot(extra)).rejects.toThrow('Unsafe resource archive path');

    extra.mossResources[0].path = state.root;
    await fs.writeFile(path.join(state.root, '.moss-ready'), 'digest');
    await fs.writeFile(path.join(state.root, '_moss_meta.json'), JSON.stringify({ id: 'wrong-agent', name: 'wrong-agent', ruleFile: 'system.md', mossDigest: 'digest' }));
    await expect(readMossAssistantSnapshot(extra)).rejects.toThrow('metadata does not match');
  });
  it('supports prepared archives without ruleFile and refuses rule paths outside the snapshot', async () => {
    const extra = { mossAccountScope: 'account', presetAssistantId: 'agent-id', mossResources: [{ id: 'agent-id', kind: 'agents' as const, digest: 'digest', path: state.root }] };
    const meta = { id: 'agent-id', name: 'assistant--digest', mossDigest: 'digest' };
    await fs.writeFile(path.join(state.root, '.moss-ready'), 'digest');
    await fs.writeFile(path.join(state.root, '_moss_meta.json'), JSON.stringify(meta));
    await fs.writeFile(path.join(state.root, 'README.md'), 'Installation instructions');
    await fs.writeFile(path.join(state.root, 'system.md'), 'You are the selected assistant.');
    expect((await readMossAssistantSnapshot(extra))?.presetContext).toContain('You are the selected assistant.');
    await fs.writeFile(path.join(state.root, '_moss_meta.json'), JSON.stringify({ ...meta, ruleFile: '../outside.md' }));
    await expect(readMossAssistantSnapshot(extra)).rejects.toThrow('Unsafe resource archive path');
  });
  it('installs immutable content, preserves executable scripts, and reuses its version', async () => {
    await serveArchive();
    const first = await prepareMossResources(undefined, ['skill-1']);
    const second = await prepareMossResources(undefined, ['skill-1']);
    expect(second.resources[0].path).toBe(first.resources[0].path);
    const script = path.join(first.resources[0].path, 'scripts/check.sh');
    expect(await fs.readFile(script, 'utf8')).toBe('#!/bin/sh\necho local');
    if (process.platform !== 'win32') expect((await fs.stat(script)).mode & 0o100).toBe(0o100);
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
