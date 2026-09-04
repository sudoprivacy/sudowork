import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const providers = new Map<string, (params?: any) => any>();
  const emits: Array<{ path: string; args: any[] }> = [];
  const makeChannelProxy = (pathStr: string): any =>
    new Proxy(() => {}, {
      get(_target, prop: string) {
        if (prop === 'provider' || prop === 'on') {
          return (cb: (params?: any) => any) => {
            providers.set(`${pathStr}.${prop}`, cb);
          };
        }
        if (prop === 'emit') {
          return (...args: any[]) => {
            emits.push({ path: pathStr, args });
          };
        }
        return makeChannelProxy(pathStr ? `${pathStr}.${String(prop)}` : String(prop));
      },
    });

  return {
    providers,
    emits,
    ipcBridge: makeChannelProxy(''),
    fetch: vi.fn(),
    getInstalledSkills: vi.fn(),
    getInstalledAssistants: vi.fn(),
    findAssistantDirByCategory: vi.fn(),
    token: 'test-token',
    isEnterprise: false,
    skillsRootDir: '',
    customSkillsDir: '',
    hubSkillsDir: '',
    systemSkillsDir: '',
    builtinSkillsDir: '',
    customAssistantsDir: '',
    hubAssistantsDir: '',
    systemAssistantsDir: '',
  };
});

vi.mock('@/common', () => ({ ipcBridge: h.ipcBridge }));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/tmp'),
  },
}));
vi.mock('@process/services/serviceManager', () => ({
  serviceManager: {
    getGateway: vi.fn(() => null),
    sendReloadSignal: vi.fn(),
    restartSudoclaw: vi.fn(),
  },
}));
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));
vi.mock('@/process/initStorage', () => ({
  clearSkillsCache: vi.fn(),
  getSkillsDir: () => h.skillsRootDir,
  getHubSkillsDir: () => h.hubSkillsDir,
  getCustomSkillsDir: () => h.customSkillsDir,
  getBuiltinSkillsDir: () => h.builtinSkillsDir,
  getHubAssistantsDir: () => h.hubAssistantsDir,
  getSystemAssistantsDir: () => h.systemAssistantsDir,
  getCustomAssistantsDir: () => h.customAssistantsDir,
  getSudoworkServerBaseUrlSync: () => 'https://server.example',
  ProcessConfig: { getSync: vi.fn() },
  SKILL_SUBDIRS: { custom: '_my-custom-skill', hub: '_hub', system: '_system' },
}));
vi.mock('@/process/SkillManager', () => ({
  skillManager: {
    getInstalledSkills: h.getInstalledSkills,
  },
}));
vi.mock('@/process/AssistantManager', () => ({
  assistantManager: {
    getInstalledAssistants: h.getInstalledAssistants,
    getInstalledAssistantsWithVisibility: vi.fn(),
    findAssistantDirByCategory: h.findAssistantDirByCategory,
    enableAssistant: vi.fn(),
    disableAssistant: vi.fn(),
    updateAssistantMeta: vi.fn(),
    getAssistantMeta: vi.fn(),
    createAssistant: vi.fn(),
    uninstallAssistant: vi.fn(),
  },
}));
vi.mock('@/process/task/AcpSkillManager', () => ({
  AcpSkillManager: {
    resetInstance: vi.fn(),
  },
}));
vi.mock('@/process/utils/skillPackage', () => ({
  buildSkillDisplayName: (name: string) => name,
  canonicalizeSkillMarkdownPath: (name: string) => name,
  findRootSkillMarkdownFileName: vi.fn(),
  isSkillMarkdownFileName: vi.fn(() => true),
  parseSkillFrontmatter: vi.fn(() => ({})),
  resolveSkillIconFromFiles: vi.fn(() => null),
}));
vi.mock('@/process/services/safety/SkillAuditScanner', () => ({
  scanSkillDirectory: vi.fn(),
  readAuditReport: vi.fn(),
}));
vi.mock('@/common/enterpriseDebugConfig', () => ({
  isEnterpriseMode: () => h.isEnterprise,
}));
vi.mock('@/process/constants/enterpriseStorage', () => ({
  SKILLS_ROOT_DIR: '/enterprise/skills',
  ASSISTANTS_ROOT_DIR: '/enterprise/assistants',
  ENTERPRISE_SKILL_SUBDIRS: { hub: 'hub', custom: 'custom', tenant: 'tenant', system: 'system' },
  ENTERPRISE_ASSISTANT_SUBDIRS: { hub: 'hub', custom: 'custom', tenant: 'tenant', system: 'system' },
}));
vi.mock('@sudowork/common/systemConfig', () => ({
  getSkillHubBaseUrl: () => 'https://hub.example',
}));
vi.mock('@/process/credentialsCache', () => ({
  getSkillhubToken: () => h.token,
}));
vi.mock('@common/nexus/hubErrors', () => ({
  tokenMissingResponse: () => ({ success: false, msg: 'token missing' }),
}));
vi.mock('@/process/database', () => ({
  getDatabase: () => ({ findConversationIdsByPresetAssistantId: vi.fn(() => ({ success: true, data: { conversationIds: [] } })) }),
}));
vi.mock('@/process/services/conversationReaper', () => ({
  reapConversation: vi.fn(),
}));
vi.mock('@/types/acpTypes', () => ({
  DEFAULT_PRESET_AGENT_TYPE: 'scode',
  normalizePresetAgentType: (value: unknown) => value,
}));

let tempRoot = '';

beforeEach(async () => {
  vi.resetModules();
  h.providers.clear();
  h.emits.length = 0;
  h.fetch.mockReset();
  h.getInstalledSkills.mockReset();
  h.getInstalledAssistants.mockReset();
  h.findAssistantDirByCategory.mockReset();
  h.token = 'test-token';
  h.isEnterprise = false;

  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sudowork-upload-refresh-'));
  h.skillsRootDir = path.join(tempRoot, 'skills');
  h.customSkillsDir = path.join(h.skillsRootDir, '_my-custom-skill');
  h.hubSkillsDir = path.join(h.skillsRootDir, '_hub');
  h.systemSkillsDir = path.join(h.skillsRootDir, '_system');
  h.builtinSkillsDir = path.join(h.skillsRootDir, '_system', '_builtin');
  h.customAssistantsDir = path.join(tempRoot, 'assistants', '_my-custom-assistant');
  h.hubAssistantsDir = path.join(tempRoot, 'assistants', '_hub');
  h.systemAssistantsDir = path.join(tempRoot, 'assistants', '_system');

  await mkdir(h.customSkillsDir, { recursive: true });
  await mkdir(h.customAssistantsDir, { recursive: true });
  vi.stubGlobal('fetch', h.fetch);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  }
});

async function serveBuffer(buffer: Buffer): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to start local zip server');
  }

  return {
    url: `http://127.0.0.1:${(address as AddressInfo).port}/assistant.zip`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

describe('uploaded Hub status refresh', () => {
  it('clears approved skill upload status when the remote skill detail is empty', async () => {
    const skillDir = path.join(h.customSkillsDir, 'local-skill');
    const meta = {
      id: 'remote-skill-1',
      name: 'local-skill',
      display_name: 'Local Skill',
      description: 'desc',
      icon: '',
      emoji: null,
      category: '',
      categories: [],
      applicable_scenarios: null,
      core_features: null,
      homepage: null,
      author_id: '',
      source_type: 'upload',
      is_builtin: false,
      enabled: true,
      installed_version: '1.0.0',
      installed_at: '2026-01-01T00:00:00.000Z',
      uploaded: true,
      uploaded_at: '2026-01-02T00:00:00.000Z',
      publish_status: 'approved',
      published_at: '2026-01-03T00:00:00.000Z',
    };
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, '_sudowork_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    h.getInstalledSkills.mockResolvedValue([
      {
        name: 'local-skill',
        version: '1.0.0',
        isBuiltin: false,
        isHubInstalled: false,
        enabled: true,
        category: 'custom',
        status: 'enabled',
        meta,
      },
    ]);
    h.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({ success: true, data: null })),
    });

    const { initSkillHubBridge } = await import('@/process/bridge/skillHubBridge');
    initSkillHubBridge();

    const result = await h.providers.get('skillHub.refreshUploadedSkillStatuses.provider')?.();

    expect(result).toEqual({ success: true, data: { checked: 1, updated: 1 } });
    expect(h.fetch).toHaveBeenCalledWith('https://hub.example/api/skills/remote-skill-1', {
      headers: { Authorization: 'test-token' },
    });

    const writtenMeta = JSON.parse(await readFile(path.join(skillDir, '_sudowork_meta.json'), 'utf-8'));
    expect(writtenMeta).toMatchObject({
      id: 'remote-skill-1',
      name: 'local-skill',
      source_type: 'upload',
    });
    expect(writtenMeta.uploaded).toBeUndefined();
    expect(writtenMeta.uploaded_at).toBeUndefined();
    expect(writtenMeta.publish_status).toBeUndefined();
    expect(writtenMeta.published_at).toBeUndefined();
  });

  it('clears approved skill upload status when the remote detail returns Skill not found', async () => {
    const skillDir = path.join(h.customSkillsDir, 'local-skill');
    const meta = {
      id: 'remote-skill-1',
      name: 'local-skill',
      display_name: 'Local Skill',
      description: 'desc',
      icon: '',
      emoji: null,
      category: '',
      categories: [],
      applicable_scenarios: null,
      core_features: null,
      homepage: null,
      author_id: '',
      source_type: 'upload',
      is_builtin: false,
      enabled: true,
      installed_version: '1.0.0',
      installed_at: '2026-01-01T00:00:00.000Z',
      uploaded: true,
      uploaded_at: '2026-01-02T00:00:00.000Z',
      publish_status: 'approved',
      published_at: '2026-01-03T00:00:00.000Z',
    };
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, '_sudowork_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    h.getInstalledSkills.mockResolvedValue([
      {
        name: 'local-skill',
        version: '1.0.0',
        isBuiltin: false,
        isHubInstalled: false,
        enabled: true,
        category: 'custom',
        status: 'enabled',
        meta,
      },
    ]);
    h.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn(async () => ({ error: { code: 'BAD_REQUEST', message: 'Skill not found' } })),
    });

    const { initSkillHubBridge } = await import('@/process/bridge/skillHubBridge');
    initSkillHubBridge();

    const result = await h.providers.get('skillHub.refreshUploadedSkillStatuses.provider')?.();

    expect(result).toEqual({ success: true, data: { checked: 1, updated: 1 } });
    const writtenMeta = JSON.parse(await readFile(path.join(skillDir, '_sudowork_meta.json'), 'utf-8'));
    expect(writtenMeta.uploaded).toBeUndefined();
    expect(writtenMeta.uploaded_at).toBeUndefined();
    expect(writtenMeta.publish_status).toBeUndefined();
    expect(writtenMeta.published_at).toBeUndefined();
  });

  it('keeps skill upload status when the remote detail failure is not a deletion', async () => {
    const skillDir = path.join(h.customSkillsDir, 'local-skill');
    const meta = {
      id: 'remote-skill-1',
      name: 'local-skill',
      display_name: 'Local Skill',
      description: 'desc',
      icon: '',
      emoji: null,
      category: '',
      categories: [],
      applicable_scenarios: null,
      core_features: null,
      homepage: null,
      author_id: '',
      source_type: 'upload',
      is_builtin: false,
      enabled: true,
      installed_version: '1.0.0',
      installed_at: '2026-01-01T00:00:00.000Z',
      uploaded: true,
      uploaded_at: '2026-01-02T00:00:00.000Z',
      publish_status: 'approved',
      published_at: '2026-01-03T00:00:00.000Z',
    };
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, '_sudowork_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    h.getInstalledSkills.mockResolvedValue([
      {
        name: 'local-skill',
        version: '1.0.0',
        isBuiltin: false,
        isHubInstalled: false,
        enabled: true,
        category: 'custom',
        status: 'enabled',
        meta,
      },
    ]);
    h.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({ success: false, message: 'Unauthorized', data: null })),
    });

    const { initSkillHubBridge } = await import('@/process/bridge/skillHubBridge');
    initSkillHubBridge();

    const result = await h.providers.get('skillHub.refreshUploadedSkillStatuses.provider')?.();

    expect(result).toEqual({ success: true, data: { checked: 1, updated: 0 } });
    const writtenMeta = JSON.parse(await readFile(path.join(skillDir, '_sudowork_meta.json'), 'utf-8'));
    expect(writtenMeta).toMatchObject({
      uploaded: true,
      uploaded_at: '2026-01-02T00:00:00.000Z',
      publish_status: 'approved',
      published_at: '2026-01-03T00:00:00.000Z',
    });
  });

  it('clears pending assistant upload status when the remote assistant was deleted', async () => {
    const assistantDir = path.join(h.customAssistantsDir, 'local-assistant');
    const meta = {
      id: 'remote-assistant-1',
      name: 'local-assistant',
      display_name: 'Local Assistant',
      source_type: 'custom',
      tag: 'custom',
      is_builtin: false,
      enabled: true,
      uploaded: true,
      uploaded_at: '2026-01-02T00:00:00.000Z',
      publish_status: 'pending',
    };
    await mkdir(assistantDir, { recursive: true });
    await writeFile(path.join(assistantDir, '_sudowork_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    h.getInstalledAssistants.mockResolvedValue([
      {
        name: 'local-assistant',
        isBuiltin: false,
        isHubInstalled: false,
        enabled: true,
        category: 'custom',
        status: 'enabled',
        meta,
      },
    ]);
    h.findAssistantDirByCategory.mockReturnValue({ dir: assistantDir, category: 'custom' });
    h.fetch.mockResolvedValue({ ok: false, status: 410 });

    const { initAssistantHubBridge } = await import('@/process/bridge/assistantHubBridge');
    initAssistantHubBridge();

    const result = await h.providers.get('assistantHub.refreshUploadedAssistantStatuses.provider')?.();

    expect(result).toEqual({ success: true, data: { checked: 1, updated: 1 } });
    expect(h.fetch).toHaveBeenCalledWith('https://hub.example/api/assistants/remote-assistant-1', {
      headers: { Authorization: 'test-token' },
    });

    const writtenMeta = JSON.parse(await readFile(path.join(assistantDir, '_sudowork_meta.json'), 'utf-8'));
    expect(writtenMeta).toMatchObject({
      id: 'remote-assistant-1',
      name: 'local-assistant',
      source_type: 'custom',
    });
    expect(writtenMeta.uploaded).toBeUndefined();
    expect(writtenMeta.uploaded_at).toBeUndefined();
    expect(writtenMeta.publish_status).toBeUndefined();
    expect(writtenMeta.published_at).toBeUndefined();
  });

  it('clears pending assistant upload status when the remote detail returns Assistant not found', async () => {
    const assistantDir = path.join(h.customAssistantsDir, 'local-assistant');
    const meta = {
      id: 'remote-assistant-1',
      name: 'local-assistant',
      display_name: 'Local Assistant',
      source_type: 'custom',
      tag: 'custom',
      is_builtin: false,
      enabled: true,
      uploaded: true,
      uploaded_at: '2026-01-02T00:00:00.000Z',
      publish_status: 'pending',
    };
    await mkdir(assistantDir, { recursive: true });
    await writeFile(path.join(assistantDir, '_sudowork_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    h.getInstalledAssistants.mockResolvedValue([
      {
        name: 'local-assistant',
        isBuiltin: false,
        isHubInstalled: false,
        enabled: true,
        category: 'custom',
        status: 'enabled',
        meta,
      },
    ]);
    h.findAssistantDirByCategory.mockReturnValue({ dir: assistantDir, category: 'custom' });
    h.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn(async () => ({ error: { code: 'BAD_REQUEST', message: 'Assistant not found' } })),
    });

    const { initAssistantHubBridge } = await import('@/process/bridge/assistantHubBridge');
    initAssistantHubBridge();

    const result = await h.providers.get('assistantHub.refreshUploadedAssistantStatuses.provider')?.();

    expect(result).toEqual({ success: true, data: { checked: 1, updated: 1 } });
    const writtenMeta = JSON.parse(await readFile(path.join(assistantDir, '_sudowork_meta.json'), 'utf-8'));
    expect(writtenMeta.uploaded).toBeUndefined();
    expect(writtenMeta.uploaded_at).toBeUndefined();
    expect(writtenMeta.publish_status).toBeUndefined();
    expect(writtenMeta.published_at).toBeUndefined();
  });
});

describe('assistant Hub install metadata', () => {
  it('prefers display_name over profession when listing personal hub assistants', async () => {
    h.fetch.mockResolvedValue({
      json: vi.fn(async () => ({
        data: {
          assistants: [
            {
              id: 'assistant-1',
              name: '正式智能体名称',
              display_name: '正式展示名',
              profession: '销售',
              description: 'desc',
              avatar: null,
              categories: ['销售'],
              skills: [],
              tag: 'hub',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      })),
    });

    const { initAssistantHubBridge } = await import('@/process/bridge/assistantHubBridge');
    initAssistantHubBridge();

    const result = await h.providers.get('assistantHub.fetchAssistants.provider')?.({ limit: 40 });

    expect(result.success).toBe(true);
    expect(result.data.assistants[0]).toMatchObject({
      name: '正式智能体名称',
      display_name: '正式展示名',
      category: '销售',
    });
  });

  it('filters tenant assistants after applying visible assistant category overlays', async () => {
    h.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith('https://server.example/api/v1/agents/visible')) {
        return {
          ok: true,
          json: vi.fn(async () => ({
            success: true,
            data: [
              {
                assistant_id: 'assistant-1',
                display_name: 'R&D 协同 Agent',
                categories: ['FDE'],
              },
            ],
          })),
        };
      }

      return {
        json: vi.fn(async () => ({
          data: {
            assistants: [
              {
                id: 'assistant-1',
                name: 'rnd-agent',
                profession: 'R&D 协同 Agent',
                description: 'desc',
                avatar: null,
                categories: ['工程技术'],
                skills: [],
                tag: 'hub',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        })),
      };
    });

    const { initAssistantHubBridge } = await import('@/process/bridge/assistantHubBridge');
    initAssistantHubBridge();

    const result = await h.providers.get('assistantHub.fetchAssistants.provider')?.({
      limit: 40,
      category: 'FDE',
      tenantId: 'tenant-a',
      accessToken: 'user-token',
    });

    const hubRequestUrl = String(h.fetch.mock.calls.find(([url]) => String(url).startsWith('https://hub.example'))?.[0]);
    expect(hubRequestUrl).toContain('/api/assistants/cursor?');
    expect(hubRequestUrl).toContain('tenant_id=tenant-a');
    expect(hubRequestUrl).not.toContain('category=FDE');
    expect(result.success).toBe(true);
    expect(result.data.assistants).toHaveLength(1);
    expect(result.data.assistants[0]).toMatchObject({
      id: 'assistant-1',
      display_name: 'R&D 协同 Agent',
      category: 'FDE',
      categories: ['FDE'],
    });
  });

  it('uses package metadata over stale assistant list fields when installing a hub assistant update', async () => {
    const assistantName = '联想AI可信一体机销售专家';
    const description = '联想AI可信一体机的企业销售专家。';
    const promptFile = `${assistantName}.md`;
    const zip = new JSZip();
    zip.file(promptFile, '# prompt');
    zip.file(
      '_sudowork_meta.json',
      JSON.stringify({
        id: '8a452f65-e435-42a0-a4a8-c1e0ad6cf95b',
        name: assistantName,
        display_name: assistantName,
        profession: assistantName,
        nameI18n: {
          'zh-CN': assistantName,
          'en-US': assistantName,
        },
        descriptionI18n: {
          'zh-CN': description,
          'en-US': description,
        },
        promptsI18n: {
          'zh-CN': ['新的案例提示词'],
        },
        categories: ['销售'],
        defaultInitPrompt: '',
        tenantId: 'sudo',
        tenantIds: ['sudo', '112211'],
        ruleFile: promptFile,
      })
    );
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const server = await serveBuffer(zipBuffer);

    try {
      const { initAssistantHubBridge } = await import('@/process/bridge/assistantHubBridge');
      initAssistantHubBridge();

      const result = await h.providers.get('assistantHub.downloadAndInstallAssistant.provider')?.({
        assistantName,
        displayName: '销售',
        sourceUrl: server.url,
        version: '1.0.13',
        checksum: '',
        selectedSkillIds: [],
        assistantMeta: {
          id: '8a452f65-e435-42a0-a4a8-c1e0ad6cf95b',
          name: assistantName,
          display_name: '销售',
          description: '',
          avatar: null,
          emoji: null,
          category: '',
          categories: [],
          preset_agent_type: null,
          skills: [],
          tag: 'hub',
          homepage: null,
          author_id: '',
          star_count: 0,
          applicable_scenarios: null,
          core_features: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          defaultInitPrompt: '旧默认问候语',
          promptsI18n: {
            'zh-CN': ['旧案例提示词'],
          },
          tenantId: '112211',
          tenantIds: ['112211'],
        },
      });

      expect(result).toMatchObject({
        success: true,
        data: {
          assistantName,
          installedVersion: '1.0.13',
          installedSkills: [],
          failedSkills: [],
        },
      });

      const writtenMeta = JSON.parse(await readFile(path.join(h.hubAssistantsDir, assistantName, '_sudowork_meta.json'), 'utf-8'));
      expect(writtenMeta).toMatchObject({
        id: '8a452f65-e435-42a0-a4a8-c1e0ad6cf95b',
        name: assistantName,
        display_name: assistantName,
        profession: assistantName,
        nameI18n: {
          'zh-CN': assistantName,
          'en-US': assistantName,
        },
        descriptionI18n: {
          'zh-CN': description,
          'en-US': description,
        },
        categories: ['销售'],
        category_id: '销售',
        defaultInitPrompt: '',
        promptsI18n: {
          'zh-CN': ['新的案例提示词'],
        },
        tenantId: 'sudo',
        tenantIds: ['sudo', '112211'],
        installed_version: '1.0.13',
        ruleFile: promptFile,
      });
      expect(writtenMeta.nameI18n['zh-CN']).not.toBe('销售');
      expect(writtenMeta.promptsI18n['zh-CN']).not.toEqual(['旧案例提示词']);
    } finally {
      await server.close();
    }
  });
});
