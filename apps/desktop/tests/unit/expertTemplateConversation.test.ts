import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAcpAgent } from '@process/initAgent';

vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: () => undefined } }));
vi.mock('@process/services/scode/ScodeInstallService', () => ({ ensureWorkspaceAgentsMdRules: vi.fn() }));
vi.mock('@process/utils/enabledSkillFilter', () => ({ filterEnabledSkillNames: async (skills?: string[]) => skills || [] }));
vi.mock('@/common/acp/defaultModels', () => ({ getDefaultAcpModelId: () => 'test-model' }));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('persists the selected expert separately from the personal Agent when creating local conversations', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'expert-template-'));
  roots.push(workspace);
  const conversation = await createAcpAgent({
    type: 'acp',
    name: 'Expert task',
    extra: { backend: 'scode', workspace, presetAssistantId: 'moss-agent:user:owner', templateRef: 'published-expert-v2', presetContext: 'EXPERT-V2', mossAccountScope: 'account', mossResources: [{ id: 'published-expert-v2', kind: 'agents', digest: 'digest', path: workspace }] },
  });
  expect(conversation.extra).toMatchObject({ presetAssistantId: 'moss-agent:user:owner', templateRef: 'published-expert-v2', presetContext: 'EXPERT-V2', mossResources: [{ id: 'published-expert-v2', digest: 'digest' }] });
});
