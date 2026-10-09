import '@arco-design/web-react/lib/_util/react-19-adapter';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { StudioChecksPage } from '@sudowork/ontology-ui/studio/StudioPages';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyConsistencyCheckResult } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from '@sudowork/ontology-ui';
import CronJobFormDrawer from '@renderer/pages/cron/components/CronJobFormDrawer';
import { handleSkillIconError, resolveSkillIcon } from '@renderer/utils/skillDisplay';
import cron from '../../../../packages/renderer/src/i18n/locales/zh-CN/cron.json';
import ontology from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const addJob = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ cron: { addJob: { invoke: addJob } } }));
vi.mock('@renderer/pages/cron/hooks/useAssistantsForCron', () => ({ useAssistantsForCron: () => [] }));
vi.mock('@renderer/utils/platform', () => ({ resolveExtensionAssetUrl: () => undefined }));
const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { cron, ontology } } }, interpolation: { escapeValue: false } });
const wrap = (node: React.ReactNode) => render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('QA form and localized feedback', () => {
  it('shows required errors inline without exposing Arco validation exceptions', async () => {
    const errorToast = vi.spyOn(Message, 'error');
    wrap(<CronJobFormDrawer visible sessionMode='remote' onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('请输入名称')).toBeInTheDocument();
    expect(await screen.findByText('请输入指令')).toBeInTheDocument();
    expect(errorToast).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
  });
  it('creates a manual cloud task disabled with the remote backend', async () => {
    wrap(<CronJobFormDrawer visible sessionMode='remote' onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('例如：每日简报'), { target: { value: 'QA manual' } });
    fireEvent.change(screen.getByPlaceholderText('输入触发时要发送的指令...'), { target: { value: 'Return OK' } });
    fireEvent.click(screen.getByText('每天'));
    fireEvent.click(await screen.findByText('手动'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(addJob).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, agentType: 'remote-agent', schedule: expect.objectContaining({ kind: 'at', atMs: 0 }) })));
  });
  it('renders the ontology warning in Chinese and omits empty raw quality results', async () => {
    const onLocate = vi.fn();
    const api = {
      runConsistencyCheck: vi.fn().mockResolvedValue({ isValid: true, issues: [{ id: 'warning', severity: 'warning', code: 'noServiceEndpoint', message: 'No service endpoint exposes ontology tools yet.', targetType: 'agent' }], qualityRuleResults: [] }),
    } as unknown as IOntologyStudioApi;
    function ChecksHarness() {
      const [report, setReport] = useState<IOntologyConsistencyCheckResult>();
      return <StudioChecksPage snapshot={createDefaultOntologyWorkbenchSnapshot()} api={api} report={report} isModelDirty={false} isRepairing={false} onReport={setReport} onRepair={vi.fn()} onRelease={vi.fn()} onError={vi.fn()} onLocate={onLocate} />;
    }
    const { container } = wrap(<ChecksHarness />);
    fireEvent.click(screen.getByRole('button', { name: '运行检查' }));
    expect(await screen.findByText(ontology.studio.advisoryWarning)).toBeInTheDocument();
    expect(screen.getByText(/尚未向智能体提供本体工具/)).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ontology.studio.locate }));
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ code: 'noServiceEndpoint', targetType: 'agent' }));
  });
  it('replaces a broken skill icon with a bundled fallback without retrying forever', () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/missing.png';
    img.crossOrigin = 'anonymous';
    handleSkillIconError({ currentTarget: img });
    expect(img.getAttribute('src')).toBe(resolveSkillIcon());
    expect(img.hasAttribute('crossorigin')).toBe(false);
    const original = img.getAttribute('src');
    handleSkillIconError({ currentTarget: img });
    expect(img.getAttribute('src')).toBe(original);
  });
});
