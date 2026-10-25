import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { OntologyStudio } from '@sudowork/ontology-ui';
import type { IOntologyStudioApi } from '@sudowork/ontology-ui';
import type { IOntologyStudioProject } from '@sudowork/ontology-common';
import locale from '../../../../packages/renderer/src/i18n/locales/en-US/ontology.json';

const i18n = createInstance();
void i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
const project: IOntologyStudioProject = {
  workspaceId: 'source-1',
  name: 'Support',
  authority: 'sudograph',
  source: { revision: 'revision-1', observedAt: '2026-10-25T00:00:00Z', structureComplete: true, objects: 2, tables: 1, databaseViews: 1, fields: 3, delivery: 'live', rowsEmbedded: 0 },
};

function fixture() {
  let onChanged = (_event: { workspaceId: string }) => {};
  const projects = {
    list: vi.fn().mockResolvedValue({ items: [project], sourceRegistration: { available: true, providers: ['sqlite'], execution: 'desktop' } }),
    get: vi.fn().mockImplementation(async () => structuredClone(project)),
    connectSource: vi.fn().mockResolvedValue(project),
    resumeSource: vi.fn().mockResolvedValue(null),
    onChanged: vi.fn().mockImplementation((callback) => {
      onChanged = callback;
      return () => {};
    }),
  };
  const api = {
    projects,
    onWorkbenchChanged: vi.fn().mockReturnValue(() => {}),
    pickSqliteFile: vi.fn(),
    getWorkbench: vi.fn().mockRejectedValue(new Error('Canonical models have no RDF snapshot')),
    listWorkbenches: vi.fn(),
    createWorkbench: vi.fn(),
    probeConnector: vi.fn(),
  } as unknown as IOntologyStudioApi;
  const renderChat = vi.fn().mockImplementation((workspaceId: string, name: string) => (
    <div data-testid='existing-conversation'>
      {workspaceId}:{name}
    </div>
  ));
  const onNavigate = vi.fn();
  function view(workspaceId?: string) {
    return (
      <I18nextProvider i18n={i18n}>
        <OntologyStudio api={api} workspaceId={workspaceId} renderChat={renderChat} onNavigate={onNavigate} />
      </I18nextProvider>
    );
  }
  return { api, projects, onNavigate, renderChat, changed: (workspaceId: string) => onChanged({ workspaceId }), view };
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

describe('native source intake and project routing', () => {
  it('uses the shared SQLite form, retains the retry identity and never creates a legacy workspace', async () => {
    const test = fixture();
    test.projects.connectSource.mockRejectedValueOnce(new Error('SCAN_INCOMPLETE: repair source schema'));
    render(test.view());
    fireEvent.click(await screen.findByRole('button', { name: 'Connect database' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Support' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'SQLite file path' }), { target: { value: '/host/support.sqlite' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /OK|确定/ }));
    await screen.findByText('SCAN_INCOMPLETE: repair source schema');
    expect(within(dialog).getByRole('textbox', { name: 'SQLite file path' })).toHaveValue('/host/support.sqlite');
    const saved = localStorage.getItem('ontology-studio:source-registration')!;
    expect(saved).not.toContain('support.sqlite');
    expect(saved).not.toContain('password');
    fireEvent.click(within(dialog).getByRole('button', { name: /OK|确定/ }));
    await waitFor(() => expect(test.onNavigate).toHaveBeenCalledWith('source-1', 'model'));
    expect(test.projects.connectSource).toHaveBeenCalledTimes(2);
    const first = test.projects.connectSource.mock.calls[0][0];
    expect(test.projects.connectSource.mock.calls[1][0]).toEqual(first);
    expect(first).toEqual({ operationId: expect.any(String), language: 'en', connector: { name: 'Support', sourceType: 'sqlite', kind: 'database', metadata: {}, writable: false, path: '/host/support.sqlite' } });
    expect(localStorage.getItem('ontology-studio:source-registration')).toBeNull();
    expect(test.api.probeConnector).not.toHaveBeenCalled();
    expect(test.api.createWorkbench).not.toHaveBeenCalled();
  });

  it('resumes a completed operation after reload without rescanning or persisting source details', async () => {
    const test = fixture();
    localStorage.setItem('ontology-studio:source-registration', JSON.stringify({ operationId: '123e4567-e89b-42d3-a456-426614174000', language: 'zh' }));
    test.projects.resumeSource.mockResolvedValue(project);
    render(test.view());
    fireEvent.click(await screen.findByRole('button', { name: 'Connect database' }));
    await waitFor(() => expect(test.onNavigate).toHaveBeenCalledWith('source-1', 'model'));
    expect(test.projects.resumeSource).toHaveBeenCalledExactlyOnceWith({ operationId: '123e4567-e89b-42d3-a456-426614174000' });
    expect(test.projects.connectSource).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('ontology-studio:source-registration')).toBeNull();
  });

  it('opens a canonical project through the existing chat and ignores unrelated or late model events', async () => {
    const test = fixture();
    render(test.view('source-1'));
    expect(await screen.findByText('1 tables · 1 database views · 3 fields')).toBeInTheDocument();
    expect(screen.getByText('Last structure scan complete')).toBeInTheDocument();
    expect(test.renderChat).toHaveBeenCalledWith('source-1', 'Support');
    expect(test.api.getWorkbench).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    await act(async () => test.changed('unrelated'));
    expect(test.projects.get).toHaveBeenCalledTimes(1);
    let oldResponse!: (value: IOntologyStudioProject) => void;
    test.projects.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResponse = resolve;
        })
    );
    test.projects.get.mockResolvedValueOnce({ ...project, source: { ...project.source!, revision: 'revision-3' } });
    await act(async () => {
      test.changed('source-1');
      test.changed('source-1');
    });
    expect(await screen.findByText('revision-3')).toBeInTheDocument();
    await act(async () => oldResponse({ ...project, source: { ...project.source!, revision: 'revision-2' } }));
    expect(screen.queryByText('revision-2')).not.toBeInTheDocument();
    expect(screen.getByText('revision-3')).toBeInTheDocument();
  });

  it('reports canonical read failures and retries without falling back to RDF', async () => {
    const test = fixture();
    test.projects.get.mockRejectedValueOnce(new Error('Compiler unavailable'));
    render(test.view('source-1'));
    await screen.findAllByText('Compiler unavailable');
    expect(test.api.getWorkbench).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByTestId('existing-conversation')).toHaveTextContent('source-1:Support');
    expect(test.api.getWorkbench).not.toHaveBeenCalled();
  });

  it('disables unsupported source intake while preserving existing legacy creation', async () => {
    const test = fixture();
    test.projects.list.mockResolvedValue({ items: [], sourceRegistration: { available: false, providers: ['sqlite'], execution: 'desktop' } });
    render(test.view());
    expect(await screen.findByRole('button', { name: 'Connect database' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New ontology' })).toBeEnabled();
    expect(screen.getByText('Source modeling is not available in this deployment. Contact your administrator.')).toBeInTheDocument();
    expect(test.projects.connectSource).not.toHaveBeenCalled();
  });
});
