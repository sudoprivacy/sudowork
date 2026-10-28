import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from '@sudowork/ontology-ui';
import { StudioCapabilitiesPage } from '@sudowork/ontology-ui/studio/StudioPages';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fixture() {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'capabilities', title: '客户本体' });
  snapshot.logicFunctions = [
    {
      id: 'lookup',
      code: 'customer_lookup',
      name: 'Customer Lookup',
      description: 'Lookup approved Customer records through ontology mappings.',
      displayName: '客户查询',
      displayDescription: '通过本体映射查询已审批的客户记录。',
      runtime: 'typescript',
      objectIds: [],
      signature: 'customerLookup',
      body: '',
      returnType: 'object[]',
      parameters: [{ name: 'query', type: 'object', required: true, description: '客户筛选条件' }],
      configuration: { builtIn: 'lookup' },
      origin: 'generated',
      status: 'active',
      executionCount: 0,
      updatedAt: 1,
    },
  ];
  snapshot.actions = [
    {
      id: 'notify',
      code: 'customer_notify_owner',
      name: 'Notify Customer Owner',
      description: 'Notify the owner of Customer.',
      displayName: '客户负责人通知',
      displayDescription: '通知客户记录的负责人。',
      executor: 'notification',
      objectIds: [],
      configuration: {},
      parameters: [],
      outputSchema: [],
      origin: 'generated',
      status: 'active',
      executionCount: 0,
      updatedAt: 1,
    },
  ];
  const api = {
    upsertLogicFunction: vi.fn().mockResolvedValue(snapshot),
    deleteLogicFunction: vi.fn().mockResolvedValue(snapshot),
    executeLogicFunction: vi.fn().mockResolvedValue({
      snapshot,
      execution: {
        id: 'run-1',
        kind: 'logic',
        artifactId: 'lookup',
        code: 'customer_lookup',
        input: { query: {} },
        output: [{ customer_id: 'ALFKI' }],
        status: 'success',
        startedAt: 1,
        finishedAt: 2,
      },
    }),
  } as unknown as IOntologyStudioApi;
  const props = { snapshot, api, onRefresh: vi.fn().mockResolvedValue(undefined), onError: vi.fn() };
  render(
    <I18nextProvider i18n={i18n}>
      <StudioCapabilitiesPage {...props} />
    </I18nextProvider>
  );
  return props;
}

describe('ontology capability display metadata', () => {
  it('shows Chinese display metadata without exposing runtime names and descriptions', () => {
    fixture();
    expect(screen.getByText('客户查询')).toBeInTheDocument();
    expect(screen.getByText('客户负责人通知')).toBeInTheDocument();
    expect(screen.getByText('通知客户记录的负责人。')).toBeInTheDocument();
    expect(screen.queryByText('Customer Lookup')).not.toBeInTheDocument();
    expect(screen.queryByText('Notify Customer Owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Notify the owner of Customer.')).not.toBeInTheDocument();
  });

  it('edits display metadata while preserving runtime metadata', async () => {
    const props = fixture();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog', { name: '编辑能力' });
    const name = within(dialog).getByRole('textbox', { name: '名称' });
    const description = within(dialog).getByRole('textbox', { name: '说明' });
    expect(name).toHaveValue('客户查询');
    expect(description).toHaveValue('通过本体映射查询已审批的客户记录。');
    expect(within(dialog).getByText('此能力由本体系统自动实现，无需填写代码。如需自定义查询或计算，请创建新能力。')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: '实现内容' })).toBeDisabled();
    fireEvent.change(name, { target: { value: '客户信息查询' } });
    fireEvent.change(description, { target: { value: '查询经过审批的客户信息。' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /确定|OK/ }));
    await waitFor(() =>
      expect(props.api.upsertLogicFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Customer Lookup',
          description: 'Lookup approved Customer records through ontology mappings.',
          displayName: '客户信息查询',
          displayDescription: '查询经过审批的客户信息。',
          body: '',
          parameters: [{ name: 'query', type: 'object', required: true, description: '客户筛选条件' }],
          configuration: { builtIn: 'lookup' },
        })
      )
    );
  });

  it('provides type-aware reference input and validates it before running', async () => {
    const props = fixture();
    fireEvent.click(screen.getByRole('button', { name: '试运行' }));
    const dialog = screen.getByRole('dialog', { name: '试运行' });
    const argumentsInput = within(dialog).getByRole('textbox', { name: '运行参数（JSON）' });
    expect(argumentsInput).toHaveValue('{\n  "query": {}\n}');
    expect(within(dialog).getByText('query')).toBeInTheDocument();
    expect(within(dialog).getByText('object')).toBeInTheDocument();
    expect(within(dialog).getByText('必填')).toBeInTheDocument();
    expect(within(dialog).getByText('客户筛选条件')).toBeInTheDocument();

    fireEvent.change(argumentsInput, { target: { value: '{"query":""}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '试运行' }));
    expect(await within(dialog).findByText('参数“query”必须是 object 类型。')).toBeInTheDocument();
    expect(props.api.executeLogicFunction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '恢复参考输入' }));
    expect(argumentsInput).toHaveValue('{\n  "query": {}\n}');
    fireEvent.click(within(dialog).getByRole('button', { name: '试运行' }));
    await waitFor(() => expect(props.api.executeLogicFunction).toHaveBeenCalledExactlyOnceWith({ id: 'lookup', arguments: { query: {} }, workspaceId: 'capabilities' }));
    expect(await within(dialog).findByText(/ALFKI/)).toBeInTheDocument();
  });

  it('explains custom parameter definitions and supplies runtime-specific implementation examples', async () => {
    fixture();
    fireEvent.click(screen.getByRole('button', { name: '创建能力' }));
    const dialog = screen.getByRole('dialog', { name: '编辑能力' });
    expect(within(dialog).getByText(/每项包含 name（参数名）、type（类型）、required/)).toBeInTheDocument();
    const parameters = within(dialog).getByRole('textbox', { name: '参数定义（JSON 数组）' });
    fireEvent.click(within(dialog).getByRole('button', { name: '填入参数示例' }));
    expect((parameters as HTMLTextAreaElement).value).toContain('"name": "name"');
    const implementation = within(dialog).getByRole('textbox', { name: '实现内容' });
    expect(implementation).toHaveValue('SELECT 1 AS value');
    expect(within(dialog).getByText(/输入一条只读 SELECT/)).toBeInTheDocument();
    expect(within(dialog).getByText('SQL 能力必须选择数据页中已接入的数据库连接。')).toBeInTheDocument();
    fireEvent.change(implementation, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /确定|OK/ }));
    expect(await within(dialog).findByText('请填写名称')).toBeInTheDocument();
    expect(await within(dialog).findByText('请填写数据库连接')).toBeInTheDocument();
    expect(await within(dialog).findByText('请填写实现内容')).toBeInTheDocument();
  });
});
