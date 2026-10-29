import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
const state = vi.hoisted(() => ({ downloads: '', config: {} as { mossServerUrl?: string; authToken?: string } }));
vi.mock('electron', () => ({ app: { getPath: () => state.downloads } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@/common/enterpriseDebugConfig', () => ({ isEnterpriseMode: () => true, getEnterpriseConfig: () => state.config }));
vi.mock('@/process/constants/enterpriseStorage', () => ({
  getSkillMetaFileName: () => '_moss_meta.json',
  getAssistantMetaFileName: () => '_moss_meta.json',
  getSkillInstallDir: vi.fn(),
  getAssistantInstallDir: vi.fn(),
  initEnterpriseDirs: vi.fn(),
  getEnterpriseCustomSkillsDir: vi.fn(),
  getEnterpriseCustomAssistantsDir: vi.fn(),
  SourceType: {},
}));
import { exportCustomAssistantArchive, exportCustomSkillArchive, uploadCustomSkill } from '@/process/sync/customUpload';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  state.config = {};
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
describe('portable custom assets', () => {
  it('sends the existing owned working-copy ID on re-upload without overriding the packaged version', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-reupload-'));
    roots.push(root);
    await fs.writeFile(path.join(root, 'SKILL.md'), '---\nname: repeated\n---\nv2');
    await fs.writeFile(path.join(root, '_moss_meta.json'), JSON.stringify({ name: 'repeated', installed_version: '2.0.0', moss_id: 'owned-id' }));
    state.config = { mossServerUrl: 'http://moss.test', authToken: 'test-token' };
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          requests.push(body);
          return Response.json({ id: 'owned-id', status: 'private' });
        }
        return Response.json([{ id: 'owned-id', meta: { source_type: 'custom' } }]);
      })
    );
    const result = await uploadCustomSkill({ skillName: 'repeated', displayName: 'Repeated skill', sourcePath: root });
    expect(result.success).toBe(true);
    expect(requests[0]?.targetId).toBe('owned-id');
    expect(requests[0]).not.toHaveProperty('version');
    const zip = await JSZip.loadAsync(Buffer.from(String(requests[0]?.file), 'base64'));
    expect(JSON.parse(await zip.file('_moss_meta.json')!.async('string')).installed_version).toBe('2.0.0');
  });
  it('preserves expert rules, names and dependencies without exporting identity or publication state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-transfer-'));
    roots.push(root);
    state.downloads = path.join(root, 'downloads');
    const source = path.join(root, 'expert');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'AGENT.md'), 'Read the transfer-skill before answering.');
    await fs.writeFile(
      path.join(source, '_moss_meta.json'),
      JSON.stringify({
        id: 'local-id',
        moss_id: 'server-id',
        author_id: 'owner',
        nameI18n: { 'zh-CN': '预算专家' },
        descriptionI18n: { 'zh-CN': '预算规则' },
        ruleFile: 'AGENT.md',
        enabledSkills: ['transfer-skill'],
        installed_version: '2.1.0',
        uploaded: true,
        visible_to: { user_ids: ['owner'] },
        publication_base_id: 'other-asset',
      })
    );
    await fs.writeFile(path.join(source, '_sudowork_meta.json'), JSON.stringify({ authToken: 'must-not-export' }));
    const result = await exportCustomAssistantArchive({ assistantId: 'local-id', assistantName: '预算专家', displayName: '预算专家', sourcePath: source });
    expect(result.success).toBe(true);
    const zip = await JSZip.loadAsync(await fs.readFile(result.filePath!));
    expect(await zip.file('AGENT.md')!.async('string')).toBe('Read the transfer-skill before answering.');
    expect(zip.file('_sudowork_meta.json')).toBeNull();
    expect(JSON.parse(await zip.file('_moss_meta.json')!.async('string'))).toEqual({
      transfer_asset_key: expect.any(String),
      name: '预算专家',
      display_name: '预算专家',
      description: '预算规则',
      ruleFile: 'AGENT.md',
      enabledSkills: ['transfer-skill'],
      skills: ['transfer-skill'],
      installed_version: '2.1.0',
      agent_type: 'chat',
    });
    expect(path.basename(result.filePath!)).toBe('预算专家.zip');
  });
  it('preserves skill metadata and supporting files and never overwrites an existing export', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-transfer-'));
    roots.push(root);
    state.downloads = path.join(root, 'downloads');
    const source = path.join(root, 'skill');
    await fs.mkdir(path.join(source, 'references'), { recursive: true });
    await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: transfer-skill\n---\nRead references/rules.md');
    await fs.writeFile(path.join(source, 'references/rules.md'), 'Add 5%.');
    await fs.writeFile(path.join(source, '_moss_meta.json'), JSON.stringify({ name: 'transfer-skill', display_name: '复核技能', description: '复核', installed_version: '1.2.0', uploaded: true, moss_id: 'private-id' }));
    const params = { skillName: 'transfer-skill', displayName: '复核技能', sourcePath: source };
    const first = await exportCustomSkillArchive(params);
    const second = await exportCustomSkillArchive(params);
    expect(first.success && second.success).toBe(true);
    expect(first.filePath).not.toBe(second.filePath);
    const zip = await JSZip.loadAsync(await fs.readFile(first.filePath!));
    expect(await zip.file('references/rules.md')!.async('string')).toBe('Add 5%.');
    expect(JSON.parse(await zip.file('_moss_meta.json')!.async('string'))).toEqual({ transfer_asset_key: expect.any(String), name: 'transfer-skill', display_name: '复核技能', description: '复核', installed_version: '1.2.0' });
    const secondZip = await JSZip.loadAsync(await fs.readFile(second.filePath!));
    expect(JSON.parse(await secondZip.file('_moss_meta.json')!.async('string')).transfer_asset_key).toBe(JSON.parse(await zip.file('_moss_meta.json')!.async('string')).transfer_asset_key);
  });
});
