import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import StudioPackageExport from '@sudowork/ontology-ui/studio/StudioPackageExport';
import type { IOntologyPackageExportResult } from '@sudowork/ontology-common';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
  vi.spyOn(Message, 'success').mockReturnValue(vi.fn());
  vi.spyOn(Message, 'info').mockReturnValue(vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fixture() {
  const api = {
    plan: vi.fn().mockResolvedValue({
      versionId: 'v1',
      version: 'v1',
      capabilities: [],
      resources: [
        { id: 'business', name: 'Business database', provider: 'sqlite', assetIds: [], requiredFields: ['path'] },
        { id: 'remote', name: 'Remote API', provider: 'api', assetIds: [], requiredFields: ['url'] },
      ],
    }),
    export: vi.fn().mockResolvedValue({ isCancelled: false, filePath: '/export.ontology.zip', requiresBindings: ['remote'] }),
    cancel: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn().mockReturnValue(() => {}),
  };
  const onClose = vi.fn();
  const onError = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <StudioPackageExport workspaceId='orders' versionId='v1' api={api} onClose={onClose} onError={onError} />
    </I18nextProvider>
  );
  return { api, onClose, onError };
}

describe('ontology runtime package export', () => {
  it('includes local data only after explicit selection and keeps external resources as bindings', async () => {
    const { api, onClose } = fixture();
    const checkbox = await screen.findByRole('checkbox', { name: 'Business database' });
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Remote API' })).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '导出' }));
    await waitFor(() => expect(api.export).toHaveBeenCalledWith({ workspaceId: 'orders', versionId: 'v1', requestId: expect.any(String), embeddedResourceIds: ['business'] }));
    expect(await screen.findByText('/export.ontology.zip')).toBeInTheDocument();
    expect(screen.getByText('目标环境仍需配置 1 项资源绑定')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '完成' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('coalesces export submissions and cancels the active export by its request identity', async () => {
    const { api, onClose } = fixture();
    await screen.findByRole('checkbox', { name: 'Business database' });
    let finish!: (value: IOntologyPackageExportResult) => void;
    api.export.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: '导出' }));
    fireEvent.click(dialog.getByRole('button', { name: '导出' }));
    expect(api.export).toHaveBeenCalledOnce();
    fireEvent.click(dialog.getByRole('button', { name: /取消|Cancel/ }));
    expect(api.cancel).toHaveBeenCalledWith({ requestId: api.export.mock.calls[0][0].requestId });
    finish({ isCancelled: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(Message.success).not.toHaveBeenCalled();
  });
});
