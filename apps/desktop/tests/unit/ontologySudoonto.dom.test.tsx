import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyPackagePreview } from '@sudowork/ontology-common';
import StudioPackageImport from '@sudowork/ontology-ui/studio/StudioPackageImport';
import StudioRuntimeEnvironment from '@sudowork/ontology-ui/studio/StudioRuntimeEnvironment';
import StudioAgentDefinition from '@sudowork/ontology-ui/studio/StudioAgentDefinition';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
const wrap = (children: React.ReactNode) => render(<I18nextProvider i18n={i18n}>{children}</I18nextProvider>);
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
  vi.spyOn(Message, 'success').mockReturnValue(vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Sudowork package authoring UI', () => {
  it('previews a package with missing bindings and imports an explicitly selected derivative', async () => {
    const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'imported' });
    const preview = {
      fingerprint: 'a'.repeat(64),
      manifest: { name: 'Orders', version: 'v3' },
      capabilities: [],
      agent: { name: 'Sales analyst', description: 'Order evidence', instructions: 'Use actual orders.' },
      objectCount: 2,
      relationCount: 1,
      missingBindings: ['business'],
    } as IOntologyPackagePreview;
    const api = { preview: vi.fn(), import: vi.fn().mockResolvedValue(snapshot) };
    const onImported = vi.fn();
    wrap(<StudioPackageImport filePath='/orders.sudoonto' preview={preview} api={api} onImported={onImported} onClose={vi.fn()} onError={vi.fn()} />);
    expect(api.import).not.toHaveBeenCalled();
    expect(screen.getByText('目标环境仍需配置 1 项资源绑定')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'My orders' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '导入本体' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(snapshot));
    expect(api.import).toHaveBeenCalledWith({ filePath: '/orders.sudoonto', fingerprint: preview.fingerprint, name: 'My orders', isFork: true });
  });

  it('saves local environment bindings separately and enables verification after configuration', async () => {
    const resource = { id: 'business', name: 'Business database', provider: 'sqlite' as const, assetIds: [], requiredFields: ['path'] };
    const template = { connections: { business: { sourceType: 'sqlite' as const, path: '', writable: false } } };
    const api = { get: vi.fn().mockResolvedValue({ resources: [resource], missingBindings: ['business'], template }), configure: vi.fn().mockResolvedValue({ resources: [resource], missingBindings: [], template }), verify: vi.fn().mockResolvedValue({ isValid: true }) };
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    wrap(<StudioRuntimeEnvironment workspaceId='orders' api={api} onRefresh={onRefresh} onError={vi.fn()} />);
    await screen.findByText('待配置');
    expect(screen.getByRole('button', { name: '验证环境' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '配置资源绑定' }));
    const bindings = { connections: { business: { sourceType: 'sqlite', path: '/enterprise.db', writable: false } } };
    fireEvent.change(screen.getByRole('textbox', { name: '配置资源绑定' }), { target: { value: JSON.stringify(bindings) } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ workspaceId: 'orders', bindings }));
    await waitFor(() => expect(screen.getByRole('button', { name: '验证环境' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '验证环境' }));
    await waitFor(() => expect(api.verify).toHaveBeenCalledWith({ workspaceId: 'orders' }));
  });

  it('edits the portable agent instructions against the current model revision', async () => {
    const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'orders', title: 'Orders' });
    snapshot.revision = 7;
    snapshot.agentDefinition = { name: 'Analyst', description: 'Sales', instructions: 'Original instructions' };
    const onSave = vi.fn().mockResolvedValue(snapshot);
    wrap(<StudioAgentDefinition snapshot={snapshot} onSave={onSave} onRefresh={vi.fn().mockResolvedValue(undefined)} onError={vi.fn()} isDisabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox', { name: '智能体指令' }), { target: { value: 'Explain the result with order evidence.' } });
    fireEvent.click(dialog.getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ workspaceId: 'orders', expectedRevision: 7, definition: { name: 'Analyst', description: 'Sales', instructions: 'Explain the result with order evidence.' } }));
  });
});
