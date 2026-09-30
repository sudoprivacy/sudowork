import '@arco-design/web-react/lib/_util/react-19-adapter';
import React, { useCallback, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from '@sudowork/ontology-ui';
import { StudioDataPage } from '@sudowork/ontology-ui/studio/StudioPages';
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

function fixture() {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'data', title: 'Orders' });
  snapshot.assets = [
    {
      id: 'orders',
      name: 'orders',
      kind: 'table',
      sourceName: 'Business database',
      fields: [
        { name: 'id', dataType: 'bigint', nullable: false, description: '数据库中的订单编号', businessMeaning: { text: '业务订单的唯一识别编号', language: 'zh-CN', isUncertain: false, generatedAt: 1 } },
        { name: 'status', dataType: 'integer', nullable: true, businessMeaning: { text: '订单状态，具体枚举需确认', language: 'zh-CN', isUncertain: true, generatedAt: 1 } },
      ],
      metadata: {},
      profileStatus: 'ready',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const api = {
    getWorkbench: vi.fn().mockResolvedValue(snapshot),
    describeAssetFields: vi.fn().mockResolvedValue(snapshot),
    previewAsset: vi.fn().mockResolvedValue({ assetId: 'orders', columns: ['id', 'status'], rows: [], rowsReturned: 0, truncated: false }),
    syncAssetSchema: vi.fn().mockResolvedValue(snapshot),
    probeConnector: vi.fn().mockResolvedValue({ connector: { probeStatus: 'ready' } }),
    pickSqliteFile: vi.fn().mockResolvedValue('/tmp/orders.sqlite'),
    pickDataFiles: vi.fn().mockResolvedValue([]),
    importFiles: vi.fn().mockResolvedValue({ snapshot, files: [] }),
  } as unknown as IOntologyStudioApi;
  return { snapshot, api, onError: vi.fn() };
}

function Harness({ snapshot, api, onError }: IHarnessProps) {
  const [current, setCurrent] = useState(snapshot);
  const onRefresh = useCallback(async () => setCurrent(await api.getWorkbench({ workspaceId: snapshot.workspaceId })), [api, snapshot.workspaceId]);
  return (
    <I18nextProvider i18n={i18n}>
      <StudioDataPage snapshot={current} api={api} onRefresh={onRefresh} onError={onError} />
    </I18nextProvider>
  );
}

describe('ontology data workspace', () => {
  it('connects SQLite files as databases when they are selected through Add files', async () => {
    const props = fixture();
    vi.mocked(props.api.pickDataFiles).mockResolvedValue(['/tmp/orders.sqlite', '/tmp/customers.csv']);
    render(<Harness {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '添加文件' }));
    await waitFor(() => expect(props.api.probeConnector).toHaveBeenCalledWith({ workspaceId: 'data', connector: { name: 'orders.sqlite', sourceType: 'sqlite', kind: 'database', path: '/tmp/orders.sqlite', writable: false, metadata: {} } }));
    await waitFor(() => expect(props.api.importFiles).toHaveBeenCalledWith({ workspaceId: 'data', filePaths: ['/tmp/customers.csv'] }));
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('keeps an empty connection visible and discovers its newly added tables on rescan', async () => {
    const props = fixture();
    const discovered = props.snapshot.assets;
    const connection = { id: 'connection', name: 'Orders database', sourceType: 'sqlite' as const, kind: 'database' as const, path: '/tmp/orders.sqlite', metadata: {}, probeStatus: 'reachable' as const, createdAt: 1, updatedAt: 1 };
    props.snapshot.assets = [];
    props.snapshot.connectors = [connection];
    vi.mocked(props.api.probeConnector).mockResolvedValue({ connector: connection, assets: discovered, snapshot: { ...props.snapshot, assets: discovered } });
    vi.mocked(props.api.getWorkbench).mockResolvedValue({ ...props.snapshot, assets: discovered });
    render(<Harness {...props} />);
    expect(screen.getByText('Orders database')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新扫描数据表' }));
    await screen.findByText('orders');
    expect(props.api.probeConnector).toHaveBeenCalledWith({ workspaceId: 'data', connector: connection });
    expect(Message.success).toHaveBeenCalledWith('扫描完成，发现 1 个数据来源');
  });

  it('cascades database fields and default ports and submits only SQLite settings', async () => {
    const props = fixture();
    render(<Harness {...props} />);
    const addFiles = screen.getByRole('button', { name: '添加文件' });
    expect(screen.queryByText(locale.studio.addFilesHint)).not.toBeInTheDocument();
    fireEvent.mouseEnter(addFiles);
    expect(await screen.findByText(locale.studio.addFilesHint)).toBeInTheDocument();
    fireEvent.mouseLeave(addFiles);
    await waitFor(() => expect(screen.queryByText(locale.studio.addFilesHint)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '连接数据库' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('端口')).toHaveValue('5432');
    fireEvent.change(within(dialog).getByRole('textbox', { name: '服务地址' }), { target: { value: 'previous-host' } });
    const selector = within(dialog).getByRole('combobox', { name: '类型' });
    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole('option', { name: 'MySQL' }));
    expect(within(dialog).getByLabelText('端口')).toHaveValue('3306');
    expect(within(dialog).queryByLabelText('数据库模式（Schema）')).not.toBeInTheDocument();
    if (selector.getAttribute('aria-expanded') !== 'true') fireEvent.click(selector);
    fireEvent.click(await screen.findByRole('option', { name: 'SQLite' }));
    expect(within(dialog).queryByLabelText('服务地址')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('端口')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('用户名')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '名称' }), { target: { value: 'Local orders' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '选择文件' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'SQLite 文件路径' })).toHaveValue('/tmp/orders.sqlite'));
    fireEvent.click(within(dialog).getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(props.api.probeConnector).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'data', connector: { name: 'Local orders', sourceType: 'sqlite', kind: 'database', metadata: {}, writable: false, path: '/tmp/orders.sqlite' } }));
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('shows source descriptions and AI meanings above an on-demand empty-table preview', async () => {
    const props = fixture();
    render(<Harness {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('原始描述')).toBeInTheDocument();
    expect(within(dialog).getByText('业务含义')).toBeInTheDocument();
    expect(within(dialog).queryByText('AI 业务含义')).not.toBeInTheDocument();
    expect(within(dialog).getByText('数据库中的订单编号')).toBeInTheDocument();
    expect(within(dialog).getByText('业务订单的唯一识别编号')).toBeInTheDocument();
    expect(within(dialog).queryByText('待确认')).not.toBeInTheDocument();
    expect(within(dialog).getByText('订单状态，具体枚举需确认')).toBeInTheDocument();
    expect(props.api.previewAsset).not.toHaveBeenCalled();
    expect(props.api.describeAssetFields).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '预览 100 条数据' }));
    await within(dialog).findByText('此表暂无数据');
    expect(props.api.previewAsset).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'data', id: 'orders', limit: 100 });
    expect(within(dialog).getByText('数据库中的订单编号')).toBeInTheDocument();
  });

  it('only overwrites meanings after confirmation and keeps them unchanged on cancellation', async () => {
    const props = fixture();
    render(<Harness {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    fireEvent.click(screen.getByRole('button', { name: '重新分析业务含义' }));
    let confirmation = await screen.findByRole('dialog', { name: '重新分析业务含义' });
    expect(within(confirmation).getByText('该操作会覆盖已有业务含义，是否继续？')).toBeInTheDocument();
    expect(props.api.describeAssetFields).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: /取消|Cancel/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '重新分析业务含义' })).not.toBeInTheDocument());
    expect(props.api.describeAssetFields).not.toHaveBeenCalled();
    expect(screen.getByText('业务订单的唯一识别编号')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新分析业务含义' }));
    confirmation = await screen.findByRole('dialog', { name: '重新分析业务含义' });
    fireEvent.click(within(confirmation).getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(props.api.describeAssetFields).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'data', id: 'orders', language: 'zh-CN', isRefresh: true }));
  });

  it('automatically fills missing meanings and keeps the source descriptions', async () => {
    const props = fixture();
    const completed = structuredClone(props.snapshot);
    props.snapshot.assets[0].fields.forEach((field) => {
      delete field.businessMeaning;
    });
    vi.mocked(props.api.getWorkbench).mockResolvedValue(completed);
    vi.mocked(props.api.describeAssetFields).mockResolvedValue(completed);
    render(<Harness {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    await screen.findByText('已补齐 2 / 2 个字段');
    expect(props.api.describeAssetFields).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'data', id: 'orders', language: 'zh-CN', isRefresh: false });
    expect(screen.getByText('数据库中的订单编号')).toBeInTheDocument();
    expect(screen.getByText('业务订单的唯一识别编号')).toBeInTheDocument();
  });

  it('keeps fields visible and allows retry after analysis failure', async () => {
    const props = fixture();
    props.snapshot.assets[0].fields.forEach((field) => {
      delete field.businessMeaning;
    });
    vi.mocked(props.api.describeAssetFields).mockRejectedValue(new Error('ontology.studio.dataErrors.meaningFailed'));
    render(<Harness {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    await screen.findByText('业务含义分析失败，请重试。');
    expect(screen.getByText('数据库中的订单编号')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '补齐业务含义' }));
    await waitFor(() => expect(props.api.describeAssetFields).toHaveBeenCalledTimes(2));
  });

  it('shows a busy state and completion feedback for schema synchronization', async () => {
    const props = fixture();
    let resolve!: (snapshot: IOntologyWorkbenchSnapshot) => void;
    vi.mocked(props.api.syncAssetSchema).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    render(<Harness {...props} />);
    const button = screen.getByRole('button', { name: '同步结构' });
    fireEvent.click(button);
    expect(button).toHaveClass('arco-btn-loading');
    resolve(props.snapshot);
    await waitFor(() => expect(Message.success).toHaveBeenCalledWith('结构已是最新，共 2 个字段'));
    expect(props.api.syncAssetSchema).toHaveBeenCalledWith({ workspaceId: 'data', id: 'orders' });
    expect(button).not.toHaveClass('arco-btn-loading');
  });
});

interface IHarnessProps {
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  onError: (error: unknown) => void;
}
