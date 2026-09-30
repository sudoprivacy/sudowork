import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { OntologyStudio } from '@sudowork/ontology-ui';
import type { IOntologyStudioApi } from '@sudowork/ontology-ui';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
let changed: (snapshot: IOntologyWorkbenchSnapshot) => void;
function fixture() {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'a', title: '订单模型' });
  snapshot.revision = 0;
  const api = {
    listWorkbenches: vi.fn().mockResolvedValue({ activeWorkspaceId: '', items: [] }),
    getWorkbench: vi.fn().mockImplementation(async () => structuredClone(snapshot)),
    createWorkbench: vi.fn().mockResolvedValue({ snapshot }),
    onWorkbenchChanged: vi.fn().mockImplementation((callback) => {
      changed = callback;
      return () => {};
    }),
    saveStudioModel: vi.fn().mockImplementation(async (input) => ({ ...snapshot, objects: input.objects, relations: input.relations, revision: 1 })),
  } as unknown as IOntologyStudioApi;
  return { api, snapshot };
}
function mount(api: IOntologyStudioApi, workspaceId?: string) {
  const onNavigate = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <OntologyStudio api={api} workspaceId={workspaceId} onNavigate={onNavigate} renderChat={() => <div>本体内对话</div>} />
    </I18nextProvider>
  );
  return { onNavigate };
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ontology studio workspace', () => {
  it('creates a workspace from its name and opens it without another naming dialog', async () => {
    const { api } = fixture();
    const { onNavigate } = mount(api);
    await screen.findByText('还没有本体，可以新建或导入 RDF/OWL 文件');
    const importHint = '支持 .owl、.rdf、.xml（RDF/XML 或 OWL/XML），最大 5 MB';
    expect(screen.queryByText(importHint)).not.toBeInTheDocument();
    const importButton = screen.getByRole('button', { name: '导入本体' });
    fireEvent.mouseEnter(importButton);
    expect(await screen.findByText(importHint)).toBeInTheDocument();
    fireEvent.mouseLeave(importButton);
    await waitFor(() => expect(screen.queryByText(importHint)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '新建本体' }));
    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByRole('textbox', { name: '名称' }), { target: { value: '订单模型' } });
    fireEvent.click(within(modal).getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('a', 'model'));
    expect(api.createWorkbench).toHaveBeenCalledWith(expect.objectContaining({ name: '订单模型' }));
  });

  it('keeps graph edits local until an explicit scoped save', async () => {
    const { api } = fixture();
    mount(api, 'a');
    await screen.findByText('订单模型');
    expect(screen.getByText('本体内对话')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '新增对象' })[0]);
    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByRole('textbox', { name: '名称' }), { target: { value: '客户' } });
    fireEvent.click(within(modal).getByRole('button', { name: /确定|OK/ }));
    await screen.findByText('未保存修改');
    const inspector = screen.getByRole('heading', { name: '客户' }).closest('aside')!;
    expect(within(inspector).getByText('客户')).toBeInTheDocument();
    expect(within(inspector).queryByText(/^urn:sudowork:/)).not.toBeInTheDocument();
    expect(api.saveStudioModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存工作稿' }));
    await waitFor(() => expect(api.saveStudioModel).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'a', expectedRevision: 0, objects: [expect.objectContaining({ name: '客户', iri: expect.stringMatching(/^urn:sudowork:/) })] })));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存工作稿' })).toBeDisabled());
  });

  it('retains local edits when an AI update arrives and ignores other ontology events', async () => {
    const { api, snapshot } = fixture();
    mount(api, 'a');
    await screen.findByText('订单模型');
    fireEvent.click(screen.getAllByRole('button', { name: '新增对象' })[0]);
    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByRole('textbox', { name: '名称' }), { target: { value: '客户' } });
    fireEvent.click(within(modal).getByRole('button', { name: /确定|OK/ }));
    await screen.findByText('未保存修改');
    act(() => changed({ ...snapshot, workspaceId: 'b', draft: { ...snapshot.draft, title: '其他本体' }, revision: 5 }));
    expect(screen.queryByText('其他本体')).not.toBeInTheDocument();
    act(() => changed({ ...snapshot, revision: 2 }));
    expect(await screen.findByText(/后台已更新此本体/)).toBeInTheDocument();
    const cached = JSON.parse(localStorage.getItem('ontology-studio:draft:a')!);
    expect(cached.model.objects[0].name).toBe('客户');
    expect(cached.revision).toBe(0);
  });
});
