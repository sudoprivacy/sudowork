import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyAgentBlueprint, IOntologyPublishedVersion, IOntologySkillBlueprint } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from '@sudowork/ontology-ui';
import StudioReleasePage from '@sudowork/ontology-ui/studio/StudioReleasePage';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
  vi.spyOn(Message, 'success').mockReturnValue(vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fixture(skillStatus: IOntologySkillBlueprint['status'] = 'draft', agentStatus?: IOntologyAgentBlueprint['status']) {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'workspace', title: 'Orders' });
  const version = {
    id: 'version',
    version: 'v2',
    status: 'published',
    isActive: true,
    objectCount: 2,
    relationCount: 1,
    summary: '',
    createdAt: 1,
    diff: { addedObjectIds: [], changedObjectIds: [], removedObjectIds: [], addedRelationIds: [], removedRelationIds: [], summary: '', riskLevel: 'low' },
    snapshot: { objects: [], relations: [], mappings: [], qualityRules: [], logicFunctions: [], actions: [], serviceEndpoints: [], businessDocuments: [] },
  } satisfies IOntologyPublishedVersion;
  const skill: IOntologySkillBlueprint = {
    id: 'skill',
    name: '订单管理技能',
    description: '查询订单与履约状态',
    status: skillStatus,
    ontologyVersionId: version.id,
    version: '1.0.0',
    entityIds: ['order', 'shipment'],
    toolManifest: [
      {
        name: 'ontology.lookup',
        description: 'Lookup orders',
        displayName: '订单综合查询',
        displayDescription: '查询订单对象、属性和关系。',
        category: 'ontology',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...(skillStatus === 'published' ? { registeredSkillId: 'ontology-skill-skill', publishedAt: 2 } : {}),
  };
  const agent: IOntologyAgentBlueprint = {
    id: 'agent',
    name: '订单智能体',
    status: agentStatus || 'draft',
    skillBlueprintId: skill.id,
    ontologyVersionId: version.id,
    promptTemplate: '',
    createdAt: 1,
    updatedAt: 1,
    ...(agentStatus === 'registered' ? { registeredAssistantId: 'agent-id', registeredAt: 3 } : {}),
  };
  snapshot.publishedVersions = [version];
  snapshot.skillBlueprints = [skill];
  if (agentStatus) snapshot.agentBlueprints = [agent];
  const api = {
    createSkillBlueprint: vi.fn(),
    publishSkillBlueprint: vi.fn().mockResolvedValue({ snapshot, blueprint: { ...skill, status: 'published' } }),
    createAgentBlueprint: vi.fn().mockResolvedValue({ snapshot, blueprint: agent }),
    registerAgentBlueprint: vi.fn().mockResolvedValue({ snapshot, blueprint: agent }),
  } as unknown as IOntologyStudioApi;
  const props = { snapshot, api, onRefresh: vi.fn().mockResolvedValue(undefined), onError: vi.fn(), onExport: vi.fn(), onStartAgentConversation: vi.fn().mockResolvedValue(undefined) };
  render(
    <I18nextProvider i18n={i18n}>
      <StudioReleasePage {...props} />
    </I18nextProvider>
  );
  return { ...props, skill, agent };
}

describe('ontology version → skill → agent publishing UI', () => {
  it('publishes a generated skill draft before offering agent creation', async () => {
    const props = fixture('draft');
    expect(screen.queryByRole('button', { name: '创建并注册智能体' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '发布技能' })[0]);
    const modal = await screen.findByRole('dialog', { name: '发布技能' });
    expect(within(modal).getByRole('textbox', { name: '技能名称' })).toHaveValue('订单管理技能');
    fireEvent.change(within(modal).getByRole('textbox', { name: '技能名称' }), { target: { value: '订单履约技能' } });
    fireEvent.click(within(modal).getByRole('button', { name: '发布技能' }));
    await waitFor(() => expect(props.api.publishSkillBlueprint).toHaveBeenCalledWith({ workspaceId: 'workspace', skillBlueprintId: 'skill', name: '订单履约技能', description: '查询订单与履约状态' }));
  });

  it('creates an agent from the published skill rather than the ontology version', async () => {
    const props = fixture('published');
    fireEvent.click(screen.getByRole('button', { name: '创建并注册智能体' }));
    const modal = await screen.findByRole('dialog', { name: '创建并注册智能体' });
    fireEvent.change(within(modal).getByRole('textbox', { name: '智能体名称' }), { target: { value: '订单查询智能体' } });
    fireEvent.click(within(modal).getByRole('button', { name: '创建并注册智能体' }));
    await waitFor(() => expect(props.api.createAgentBlueprint).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', skillBlueprintId: 'skill', name: '订单查询智能体' }));
    await waitFor(() => expect(props.api.registerAgentBlueprint).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', blueprintId: 'agent' }));
  });

  it('shows skill provenance and concrete capabilities as an independent asset', async () => {
    fixture('published');
    const skills = within(screen.getByRole('region', { name: '本体技能' }));
    expect(skills.getByText('订单管理技能')).toBeInTheDocument();
    expect(skills.getByText('Orders')).toBeInTheDocument();
    expect(skills.getByText('v2')).toBeInTheDocument();
    expect(skills.queryByText('包含能力')).not.toBeInTheDocument();
    expect(skills.queryByText('ontology.lookup')).not.toBeInTheDocument();
    expect(skills.getByText('已发布')).toBeInTheDocument();
    fireEvent.click(skills.getByRole('button', { name: '查看技能' }));
    const modal = await screen.findByRole('dialog', { name: '查看技能' });
    expect(within(modal).getByText('包含能力（1）')).toBeInTheDocument();
    expect(within(modal).getByText('本体查询')).toBeInTheDocument();
    expect(within(modal).getByText('订单综合查询')).toBeInTheDocument();
    expect(within(modal).getByText('查询订单对象、属性和关系。')).toBeInTheDocument();
    expect(within(modal).queryByText('ontology.lookup')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Lookup orders')).not.toBeInTheDocument();
    expect(within(modal).queryByText('权限等级')).not.toBeInTheDocument();
  });

  it('starts a conversation using the registered agent identity', async () => {
    const props = fixture('published', 'registered');
    const agents = within(screen.getByRole('region', { name: '本体智能体' }));
    expect(agents.getByText('订单管理技能')).toBeInTheDocument();
    fireEvent.click(agents.getByRole('button', { name: '新会话' }));
    await waitFor(() => expect(props.onStartAgentConversation).toHaveBeenCalledExactlyOnceWith('agent-id'));
  });

  it('keeps failed agents unavailable for new conversations', () => {
    fixture('published', 'failed');
    expect(screen.queryByRole('button', { name: '新会话' })).not.toBeInTheDocument();
  });

  it('retries a failed agent registration without recreating its skill or blueprint', async () => {
    const props = fixture('published', 'failed');
    fireEvent.click(screen.getByRole('button', { name: '重试注册' }));
    await waitFor(() => expect(props.api.registerAgentBlueprint).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', blueprintId: 'agent' }));
    expect(props.api.publishSkillBlueprint).not.toHaveBeenCalled();
    expect(props.api.createAgentBlueprint).not.toHaveBeenCalled();
  });
});
