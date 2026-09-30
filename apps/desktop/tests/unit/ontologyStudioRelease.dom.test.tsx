import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyAgentBlueprint, IOntologyPublishedVersion } from '@sudowork/ontology-common';
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

function fixture(status?: IOntologyAgentBlueprint['status'], title = 'Orders') {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'workspace', title });
  snapshot.publishedVersions = [
    {
      id: 'version',
      version: 'v2',
      status: 'published',
      isActive: true,
      objectCount: 0,
      relationCount: 0,
      summary: '',
      createdAt: 1,
      diff: { addedObjectIds: [], changedObjectIds: [], removedObjectIds: [], addedRelationIds: [], removedRelationIds: [], summary: '', riskLevel: 'low' },
      snapshot: { objects: [], relations: [], mappings: [], qualityRules: [], logicFunctions: [], actions: [], serviceEndpoints: [], businessDocuments: [] },
    } satisfies IOntologyPublishedVersion,
  ];
  const blueprint: IOntologyAgentBlueprint = {
    id: 'blueprint',
    name: 'Orders · v2',
    status: status || 'draft',
    ontologyVersionId: 'version',
    entityIds: [],
    promptTemplate: '',
    toolManifest: [{ name: 'ontology.lookup', description: 'Lookup orders', category: 'ontology' }],
    createdAt: 1,
    updatedAt: 1,
    ...(status === 'registered' ? { registeredAssistantId: 'agent-id', registeredAt: 2 } : {}),
  };
  if (status) snapshot.agentBlueprints = [blueprint];
  const api = { createAgentBlueprint: vi.fn().mockResolvedValue({ snapshot, blueprint }), registerAgentBlueprint: vi.fn().mockResolvedValue({ snapshot }) } as unknown as IOntologyStudioApi;
  const props = { snapshot, api, onRefresh: vi.fn().mockResolvedValue(undefined), onError: vi.fn(), onExport: vi.fn() };
  render(
    <I18nextProvider i18n={i18n}>
      <StudioReleasePage {...props} />
    </I18nextProvider>
  );
  return { ...props, blueprint };
}

describe('ontology version registration UI', () => {
  it('creates with the confirmed user name only once and registers the returned blueprint', async () => {
    const props = fixture(undefined, '项目管理本体');
    let finish!: () => void;
    vi.mocked(props.api.registerAgentBlueprint).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ snapshot: props.snapshot });
        })
    );
    vi.mocked(props.api.createAgentBlueprint).mockResolvedValue({ snapshot: { ...props.snapshot, agentBlueprints: [props.blueprint, { ...props.blueprint, id: 'unrelated', ontologyVersionId: 'older' }] }, blueprint: props.blueprint });
    expect(screen.getByText('未注册')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: '创建并注册智能体' });
    fireEvent.click(button);
    fireEvent.click(button);
    const modal = await screen.findByRole('dialog', { name: '创建并注册智能体' });
    const name = within(modal).getByRole('textbox', { name: '智能体名称' });
    expect(name).toHaveValue('项目管理本体智能体');
    expect(props.api.createAgentBlueprint).not.toHaveBeenCalled();
    expect(props.api.registerAgentBlueprint).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: '  采购管理智能体  ' } });
    const confirm = within(modal).getByRole('button', { name: '创建并注册智能体' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(props.api.registerAgentBlueprint).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', blueprintId: 'blueprint' }));
    expect(props.api.createAgentBlueprint).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', ontologyVersionId: 'version', name: '采购管理智能体' });
    expect(screen.getByRole('button', { name: '注册中…' })).toBeDisabled();
    finish();
    await waitFor(() => expect(Message.success).toHaveBeenCalled());
  });

  it('shows the registered agent and version details without another create action', async () => {
    const props = fixture('registered');
    expect(screen.queryByRole('button', { name: '创建并注册智能体' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看智能体' }));
    const modal = await screen.findByRole('dialog', { name: 'Orders · v2' });
    expect(within(modal).getByText('v2')).toBeInTheDocument();
    expect(within(modal).getByText('Orders')).toBeInTheDocument();
    expect(within(modal).getByText('注册时间')).toBeInTheDocument();
    expect(within(modal).queryByText('本体能力')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Lookup orders')).not.toBeInTheDocument();
    expect(within(modal).queryByText('ontology.lookup')).not.toBeInTheDocument();
    expect(props.api.createAgentBlueprint).not.toHaveBeenCalled();
    expect(props.api.registerAgentBlueprint).not.toHaveBeenCalled();
  });

  it('does not create or register an agent when the naming dialog is cancelled', async () => {
    const props = fixture();
    fireEvent.click(screen.getByRole('button', { name: '创建并注册智能体' }));
    const modal = await screen.findByRole('dialog', { name: '创建并注册智能体' });
    fireEvent.change(within(modal).getByRole('textbox', { name: '智能体名称' }), { target: { value: '未确认的名称' } });
    fireEvent.click(within(modal).getByRole('button', { name: /取消|Cancel/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(props.api.createAgentBlueprint).not.toHaveBeenCalled();
    expect(props.api.registerAgentBlueprint).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only agent name before creating a blueprint', async () => {
    const props = fixture();
    fireEvent.click(screen.getByRole('button', { name: '创建并注册智能体' }));
    const modal = await screen.findByRole('dialog', { name: '创建并注册智能体' });
    fireEvent.change(within(modal).getByRole('textbox', { name: '智能体名称' }), { target: { value: '   ' } });
    fireEvent.click(within(modal).getByRole('button', { name: '创建并注册智能体' }));
    await within(modal).findByText('请输入 1～100 个字符的智能体名称，不能仅包含空格');
    expect(props.api.createAgentBlueprint).not.toHaveBeenCalled();
    expect(props.api.registerAgentBlueprint).not.toHaveBeenCalled();
  });

  it('submits the chosen name for a draft that has not yet been registered', async () => {
    const props = fixture('draft');
    fireEvent.click(screen.getByRole('button', { name: '创建并注册智能体' }));
    const modal = await screen.findByRole('dialog', { name: '创建并注册智能体' });
    expect(within(modal).getByRole('textbox', { name: '智能体名称' })).toHaveValue('Orders智能体');
    fireEvent.change(within(modal).getByRole('textbox', { name: '智能体名称' }), { target: { value: '订单查询智能体' } });
    fireEvent.click(within(modal).getByRole('button', { name: '创建并注册智能体' }));
    await waitFor(() => expect(props.api.createAgentBlueprint).toHaveBeenCalledWith({ workspaceId: 'workspace', ontologyVersionId: 'version', name: '订单查询智能体' }));
    await waitFor(() => expect(props.api.registerAgentBlueprint).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', blueprintId: 'blueprint' }));
  });

  it('shows the related ontology and version in the agent list instead of an internal ID', () => {
    fixture('registered');
    const list = within(screen.getByRole('region', { name: '本体智能体' }));
    expect(list.getByText('智能体名称')).toBeInTheDocument();
    expect(list.getByText('关联本体')).toBeInTheDocument();
    expect(list.getByText('对应版本')).toBeInTheDocument();
    expect(list.getByText('Orders · v2')).toBeInTheDocument();
    expect(list.getByText('Orders')).toBeInTheDocument();
    expect(list.getByText('v2')).toBeInTheDocument();
    expect(list.queryByText('agent-id')).not.toBeInTheDocument();
  });

  it.each([
    ['failed', '重试注册'],
    ['deleted', '重新注册'],
  ] as const)('reuses the existing binding for %s', async (status, label) => {
    const props = fixture(status);
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(props.api.registerAgentBlueprint).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', blueprintId: 'blueprint' }));
    expect(props.api.createAgentBlueprint).not.toHaveBeenCalled();
  });

  it('retains the registering state across a page mount and blocks another submission', () => {
    const props = fixture('registering');
    const button = screen.getByRole('button', { name: '注册中…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.api.registerAgentBlueprint).not.toHaveBeenCalled();
  });
});
