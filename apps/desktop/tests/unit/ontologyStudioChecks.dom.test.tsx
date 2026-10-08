import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyConsistencyCheckResult, IOntologyConsistencyIssue, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from '@sudowork/ontology-ui';
import { OntologyStudio } from '@sudowork/ontology-ui';
import StudioChecksPage from '@sudowork/ontology-ui/studio/StudioChecksPage';
import StudioReleasePage from '@sudowork/ontology-ui/studio/StudioReleasePage';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
const warning: IOntologyConsistencyIssue = { id: 'warning', severity: 'warning', code: 'semantic_only_relation', message: 'Semantic-only relation', targetType: 'relation', targetId: 'relation' };
const error: IOntologyConsistencyIssue = { id: 'error', severity: 'error', message: 'Join field types do not match', targetType: 'relation', targetId: 'relation' };
const report = (issues: IOntologyConsistencyIssue[]): IOntologyConsistencyCheckResult => ({ revision: 0, checkedAt: 1, isValid: !issues.some((issue) => issue.severity === 'error'), issues });
function fixture(issues = [warning, error]) {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'orders', title: '订单模型' });
  snapshot.revision = 0;
  const api = {
    getWorkbench: vi.fn().mockImplementation(async () => structuredClone(snapshot)),
    runConsistencyCheck: vi.fn().mockResolvedValue(report(issues)),
    publishCurrentDraft: vi.fn().mockResolvedValue({ snapshot }),
    requestAiRepair: vi.fn().mockResolvedValue(undefined),
    onWorkbenchChanged: vi.fn().mockReturnValue(() => {}),
  } as unknown as IOntologyStudioApi;
  return { snapshot, api, onRefresh: vi.fn().mockResolvedValue(undefined), onError: vi.fn(), onReport: vi.fn(), onViewChecks: vi.fn(), onExport: vi.fn() };
}
function mount(element: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}
beforeEach(() => {
  vi.spyOn(Message, 'success').mockReturnValue(vi.fn());
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('actionable ontology checks', () => {
  it('separates blocking issues, repairs only errors in bulk, and supports individual warning repairs', () => {
    const props = fixture();
    const onRepair = vi.fn();
    mount(<StudioChecksPage {...props} report={report([warning, error])} isModelDirty={false} isRepairing={false} onRepair={onRepair} onLocate={vi.fn()} onRelease={vi.fn()} />);
    expect(screen.getByText('1 个阻断错误，1 个建议警告')).toBeInTheDocument();
    expect(screen.getByText(/这不会阻止发布/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI 修复阻断错误' }));
    expect(onRepair).toHaveBeenLastCalledWith([error]);
    fireEvent.click(screen.getAllByRole('button', { name: 'AI 修复', exact: true })[1]);
    expect(onRepair).toHaveBeenLastCalledWith([warning]);
    expect(screen.queryByRole('button', { name: '前往创建候选版本' })).not.toBeInTheDocument();
  });

  it('allows warning-only reports to proceed and disables repairs against stale reports', () => {
    const props = fixture([warning]);
    const onRelease = vi.fn();
    const component = (revision: number) => <StudioChecksPage {...props} snapshot={{ ...props.snapshot, revision }} report={report([warning])} isModelDirty={false} isRepairing={false} onRepair={vi.fn()} onLocate={vi.fn()} onRelease={onRelease} />;
    const view = mount(component(0));
    expect(screen.getByText('检查通过，1 个建议警告')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前往创建候选版本' }));
    expect(onRelease).toHaveBeenCalledOnce();
    view.rerender(<I18nextProvider i18n={i18n}>{component(1)}</I18nextProvider>);
    expect(screen.getByRole('button', { name: 'AI 优化警告' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前往创建候选版本' })).toBeDisabled();
  });

  it('uses a compact blocking summary and routes to the report without attempting publication', async () => {
    const props = fixture([error, ...Array.from({ length: 45 }, (_, i) => ({ ...warning, id: `warning-${i}` }))]);
    mount(<StudioReleasePage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '创建候选版本' }));
    expect(await screen.findByText('暂时无法创建候选版本：1 个阻断错误')).toBeInTheDocument();
    expect(props.api.publishCurrentDraft).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
    expect(screen.queryByText('Semantic-only relation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看并修复问题' }));
    expect(props.onViewChecks).toHaveBeenCalledOnce();
    expect(props.onReport).toHaveBeenCalledWith(expect.objectContaining({ issues: expect.arrayContaining([error]) }));
  });

  it('creates a warning-only candidate once even with repeated clicks', async () => {
    const props = fixture([warning]);
    mount(<StudioReleasePage {...props} />);
    const button = screen.getByRole('button', { name: '创建候选版本' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(props.api.publishCurrentDraft).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'orders' }));
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('refreshes the blocking report when source data changes after preflight', async () => {
    const props = fixture([warning]);
    vi.mocked(props.api.runConsistencyCheck)
      .mockResolvedValueOnce(report([warning]))
      .mockResolvedValueOnce(report([warning, error]));
    vi.mocked(props.api.publishCurrentDraft).mockRejectedValueOnce(new Error('ontology.studio.errors.publishBlocked'));
    mount(<StudioReleasePage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '创建候选版本' }));
    expect(await screen.findByText('暂时无法创建候选版本：1 个阻断错误')).toBeInTheDocument();
    expect(props.onReport).toHaveBeenLastCalledWith(report([warning, error]));
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('requires saving local changes before checks or candidate creation', () => {
    const props = fixture([warning]);
    mount(<StudioReleasePage {...props} isModelDirty />);
    expect(screen.getByRole('button', { name: '创建候选版本' })).toBeDisabled();
    expect(screen.getByText(/工作稿有未保存修改/)).toBeInTheDocument();
    expect(props.api.runConsistencyCheck).not.toHaveBeenCalled();
  });

  it('opens the repair conversation once, sends scoped issue context, and rechecks changed models', async () => {
    const props = fixture();
    let onChanged!: (snapshot: IOntologyWorkbenchSnapshot) => void;
    vi.mocked(props.api.onWorkbenchChanged).mockImplementation((callback) => {
      onChanged = callback;
      return () => {};
    });
    vi.mocked(props.api.requestAiRepair).mockImplementation(async (_input, onReady) => {
      onReady('repair-chat');
    });
    const renderChat = vi.fn((_id, _name, _context, selected) => <div>{selected === 'repair-chat' ? '修复对话' : '本体对话'}</div>);
    mount(<OntologyStudio api={props.api} workspaceId='orders' page='checks' onNavigate={vi.fn()} renderChat={renderChat} />);
    fireEvent.click(await screen.findByRole('button', { name: '运行检查' }));
    const button = await screen.findByRole('button', { name: 'AI 修复阻断错误' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(props.api.requestAiRepair).toHaveBeenCalledTimes(1));
    const request = vi.mocked(props.api.requestAiRepair).mock.calls[0][0];
    expect(request.workspaceId).toBe('orders');
    expect(request.prompt).toContain('Join field types do not match');
    expect(request.prompt).not.toContain('Semantic-only relation');
    expect(await screen.findByText('修复对话')).toBeVisible();
    vi.mocked(props.api.runConsistencyCheck).mockResolvedValue({ ...report([warning]), revision: 1 });
    act(() => onChanged({ ...props.snapshot, revision: 1 }));
    await waitFor(() => expect(screen.getByText('检查通过，1 个建议警告')).toBeInTheDocument(), { timeout: 4000 });
  });
});
