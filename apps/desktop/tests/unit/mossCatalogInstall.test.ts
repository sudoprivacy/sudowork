import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', scope: 'account-a', token: 'token-a', version: '1', isCorrupt: false, isSymlink: false, isSwitching: false, isAvailable: true }));
vi.mock('@process/initStorage', () => ({
  ProcessConfig: { getSync: (key: string) => ({ 'eeclaw.serverUrl': 'https://moss.test', 'eeclaw.accountScope': state.scope })[key] },
  getHubSkillsDir: () => path.join(state.root, state.scope, 'skills', 'hub'),
  getHubAssistantsDir: () => path.join(state.root, state.scope, 'agents', 'hub'),
  clearSkillsCache: vi.fn(),
}));
vi.mock('@process/constants/enterpriseStorage', () => ({
  getEnterpriseTenantSkillsDir: () => path.join(state.root, state.scope, 'skills', 'tenant'),
  getEnterpriseTenantAssistantsDir: () => path.join(state.root, state.scope, 'agents', 'tenant'),
}));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: async () => state.token }));
import { getMossCatalogInstallations, installMossCatalog, changeCatalogInstallation, isCatalogPathVisible, detailLocalMossCatalog } from '@process/services/mossCatalogInstall';
import { listMossCatalog } from '@process/services/mossCatalogApi';

const request = vi.fn();
const agent = { kind: 'agents' as const, source: 'tenant' as const, id: 'agent-1' };
const skill = { kind: 'skills' as const, source: 'tenant' as const, id: 'skill-1' };
const archives = new Map<string, Buffer>();

beforeEach(async () => {
  Object.assign(state, { root: await fs.mkdtemp(path.join(os.tmpdir(), 'moss-catalog-')), scope: 'account-a', token: 'token-a', version: '1', isCorrupt: false, isSymlink: false, isSwitching: false, isAvailable: true });
  archives.clear();
  request.mockReset();
  request.mockImplementation(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/client/catalog/install')) {
      const input = JSON.parse(options?.body || '{}');
      const selected = input.kind === 'agents' ? [input, skill] : [input];
      const preparationId = state.version.repeat(64);
      const resources = [];
      for (const item of selected) {
        const zip = new JSZip();
        zip.file(item.kind === 'agents' ? 'system.md' : 'SKILL.md', `Resource ${item.id} version ${state.version}`);
        zip.file('_moss_meta.json', JSON.stringify({ id: item.id, name: 'shared-name', display_name: `Display ${item.id}`, ruleFile: 'system.md', agent_type: 'chat' }));
        if (state.isSymlink) zip.file('link', '/outside', { unixPermissions: 0o120777 });
        const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
        const digest = createHash('sha256').update(bytes).digest('hex');
        const downloadRef = `/api/v1/client/catalog/preparations/${preparationId}/${item.kind}/${item.id}/download`;
        archives.set(`https://moss.test${downloadRef}`, bytes);
        resources.push({ ...item, name: 'shared-name', version: state.version, digest, downloadRef, runtimeRef: `moss-prepared:${preparationId}:${item.kind}:${item.id}`, dependencies: item.kind === 'agents' ? ['skill-1'] : [], isLocalAllowed: true });
      }
      return Response.json({ protocolVersion: 1, preparationId, resources });
    }
    if (archives.has(url)) {
      const bytes = archives.get(url)!;
      if (state.isSwitching) state.scope = 'account-b';
      return new Response(bytes, { headers: { 'X-Content-SHA256': state.isCorrupt && url.includes('/skills/') ? 'bad' : createHash('sha256').update(bytes).digest('hex') } });
    }
    if (url.includes('/client/catalog/preparations/')) return state.isAvailable ? Response.json({}) : new Response('', { status: 404 });
    if (url.endsWith('/agents/tenant'))
      return Response.json([
        { id: 'visible', name: 'Visible', categories: ['sales'], isAvailable: true },
        { id: 'pending', name: 'Pending', categories: ['other'], isAvailable: false },
      ]);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', request);
});

it('migrates a legacy tenant agent stored in the hub directory without resurrecting duplicates', async () => {
  const root = path.join(state.root, state.scope, 'agents', 'hub');
  for (const name of ['old-copy', 'duplicate-copy']) {
    const directory = path.join(root, name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, '_moss_meta.json'), JSON.stringify({ id: 'visible', name: 'Legacy', ruleFile: 'system.md' }));
    await fs.writeFile(path.join(directory, 'system.md'), 'Legacy instructions');
  }
  expect(await getMossCatalogInstallations()).toHaveLength(1);
  const installed = await installMossCatalog({ kind: 'agents', source: 'hub', id: 'visible' });
  expect(installed.source).toBe('tenant');
  expect((await getMossCatalogInstallations()).filter((item) => item.kind === 'agents')).toEqual([installed]);
  expect(await isCatalogPathVisible(path.join(root, 'old-copy'))).toBe(false);
  expect(await isCatalogPathVisible(path.join(root, 'duplicate-copy'))).toBe(false);
  await changeCatalogInstallation({ kind: 'agents', source: 'tenant', id: 'visible' });
  expect((await getMossCatalogInstallations()).filter((item) => item.kind === 'agents')).toEqual([]);
  await installMossCatalog({ kind: 'agents', source: 'tenant', id: 'visible' });
  expect((await getMossCatalogInstallations()).filter((item) => item.kind === 'agents')).toHaveLength(1);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('organization catalog and local installations', () => {
  it('browses visible tenant entries and categories without downloading or marking them installed', async () => {
    expect(await getMossCatalogInstallations()).toEqual([]);
    const page = await listMossCatalog({ kind: 'agents', source: 'tenant', category: 'sales' });
    expect(page.items.map((item) => item.id)).toEqual(['visible']);
    expect(page.categories).toEqual(['other', 'sales']);
    expect((await listMossCatalog({ kind: 'agents', source: 'tenant' })).items[1].isAvailable).toBe(false);
    expect(await getMossCatalogInstallations()).toEqual([]);
    expect(request.mock.calls.every(([url]) => url.endsWith('/agents/tenant'))).toBe(true);
  });

  it('commits a complete resource graph, reuses it and never changes another account', async () => {
    const installed = await installMossCatalog(agent);
    expect(installed.source).toBe('tenant');
    expect((await getMossCatalogInstallations()).map((item) => item.id).sort()).toEqual(['agent-1', 'skill-1']);
    expect(await isCatalogPathVisible(installed.path)).toBe(true);
    const requests = request.mock.calls.filter(([url]) => url.endsWith('/client/catalog/install')).length;
    state.token = 'refreshed-token';
    expect((await installMossCatalog(agent)).path).toBe(installed.path);
    expect(request.mock.calls.filter(([url]) => url.endsWith('/client/catalog/install'))).toHaveLength(requests);
    state.scope = 'account-b';
    expect(await getMossCatalogInstallations()).toEqual([]);
  });

  it('does not publish an assistant when a required skill archive is corrupt', async () => {
    state.isCorrupt = true;
    await expect(installMossCatalog(agent)).rejects.toThrow('checksum');
    expect(await getMossCatalogInstallations()).toEqual([]);
    const root = path.join(state.root, state.scope, 'agents', 'tenant');
    for (const entry of await fs.readdir(root)) expect(await isCatalogPathVisible(path.join(root, entry))).toBe(false);
    state.isCorrupt = false;
    await installMossCatalog(agent);
    expect(await getMossCatalogInstallations()).toHaveLength(2);
  });

  it('rejects symlinks and account changes without a successful installation', async () => {
    state.isSymlink = true;
    await expect(installMossCatalog(skill)).rejects.toThrow('symlinks');
    state.isSymlink = false;
    state.isSwitching = true;
    await expect(installMossCatalog(skill)).rejects.toThrow('account changed');
    expect(await getMossCatalogInstallations()).toEqual([]);
    state.scope = 'account-a';
    expect(await getMossCatalogInstallations()).toEqual([]);
  });

  it('retains history on update/removal and respects dependencies and local disabling', async () => {
    const original = await installMossCatalog(agent);
    await expect(changeCatalogInstallation(skill)).rejects.toThrow('required');
    await changeCatalogInstallation({ ...agent, isEnabled: false });
    await expect(installMossCatalog(agent)).rejects.toThrow('disabled');
    await changeCatalogInstallation({ ...agent, isEnabled: true });
    state.version = '2';
    const updated = await installMossCatalog({ ...agent, isUpdate: true });
    expect(updated.path).not.toBe(original.path);
    expect(await fs.readFile(path.join(original.path, 'system.md'), 'utf8')).toContain('version 1');
    expect(await isCatalogPathVisible(original.path)).toBe(false);
    expect(await getMossCatalogInstallations()).toHaveLength(2);
    await changeCatalogInstallation(agent);
    expect(await isCatalogPathVisible(updated.path)).toBe(false);
    expect(await fs.stat(updated.path)).toBeTruthy();
    expect((await getMossCatalogInstallations()).map((item) => item.id)).toEqual(['skill-1']);
    state.isAvailable = false;
    await expect(installMossCatalog(skill)).rejects.toThrow('404');
  });

  it('does not overwrite resources with equal names and different IDs', async () => {
    const first = await installMossCatalog(skill);
    const second = await installMossCatalog({ ...skill, id: 'skill-2' });
    expect(first.path).not.toBe(second.path);
    expect(await getMossCatalogInstallations()).toHaveLength(2);
  });
});

it('pins an agent dependency across a standalone skill update and rejects incompatible selections', async () => {
  const { prepareLocalCatalogSelection } = await import('@process/services/mossCatalogSelection');
  const installed = await installMossCatalog(agent);
  const before = await prepareLocalCatalogSelection(installed.id);
  state.version = '2';
  await installMossCatalog({ ...skill, isUpdate: true });
  const after = await prepareLocalCatalogSelection(installed.id);
  expect(after?.resources).toEqual(before?.resources);
  expect(after?.presetContext).toContain('version 1');
  await expect(prepareLocalCatalogSelection(installed.id, [skill.id])).rejects.toThrow('different versions');
});

it('does not show a record as downloaded after its required files disappear', async () => {
  const installed = await installMossCatalog(skill);
  await fs.unlink(path.join(installed.path, 'SKILL.md'));
  expect(await getMossCatalogInstallations()).toEqual([]);
  const repaired = await installMossCatalog(skill);
  expect(repaired.path).toBe(installed.path);
  expect(await fs.readFile(path.join(repaired.path, 'SKILL.md'), 'utf8')).toBe('Resource skill-1 version 1');
  expect(await getMossCatalogInstallations()).toEqual([repaired]);
  expect(await fs.readdir(path.dirname(repaired.path))).toEqual([path.basename(repaired.path)]);
});

it('uses only account-isolated metadata caches offline and surfaces permission failures', async () => {
  await listMossCatalog({ kind: 'agents', source: 'tenant' });
  request.mockRejectedValue(new Error('offline'));
  expect((await listMossCatalog({ kind: 'agents', source: 'tenant' })).isCached).toBe(true);
  state.scope = 'account-b';
  await expect(listMossCatalog({ kind: 'agents', source: 'tenant' })).rejects.toThrow('offline');
  state.scope = 'account-a';
  request.mockResolvedValue(new Response('', { status: 403 }));
  await expect(listMossCatalog({ kind: 'agents', source: 'tenant' })).rejects.toThrow('HTTP 403');
});

it('preserves a permission error when no destination directory exists', async () => {
  const rename = fs.rename.bind(fs);
  const error = Object.assign(new Error('Permission denied'), { code: 'EPERM' });
  const onRename = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if (path.basename(String(source)).startsWith('_preparing-')) throw error;
    return rename(source, destination);
  });
  try {
    await expect(installMossCatalog(skill)).rejects.toBe(error);
    expect(await getMossCatalogInstallations()).toEqual([]);
    expect(await fs.readdir(path.join(state.root, state.scope, 'skills', 'tenant'))).toEqual([]);
  } finally {
    onRename.mockRestore();
  }
});

it('shows downloaded instructions and packaged icons offline without requiring a new download', async () => {
  const installed = await installMossCatalog(skill);
  await fs.writeFile(path.join(installed.path, 'icon.png'), Buffer.from([137, 80, 78, 71]));
  const metaPath = path.join(installed.path, '_moss_meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  await fs.writeFile(metaPath, JSON.stringify({ ...meta, icon: 'icon.png', emoji: '📦' }));
  request.mockRejectedValue(new Error('offline'));
  const detail = await detailLocalMossCatalog(skill);
  expect(detail.content).toContain('Resource skill-1 version 1');
  expect(detail.icon).toBe('data:image/png;base64,iVBORw==');
  expect(detail.emoji).toBe('📦');
});
