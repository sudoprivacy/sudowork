import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message, Modal } from '@arco-design/web-react';
// Vitest loads Arco's CommonJS build; mirror the renderer's React 19 adapter for imperative modals.
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { createDefaultOntologyWorkbenchSnapshot, ONTOLOGY_DOCUMENT_ERROR_KEYS, recalculateOntologyStats, summarizeOntologyWorkbenchSnapshot, type IOntologyAttributeDraft } from '@sudowork/ontology-common';
import OntologyWorkbench, { type IOntologyWorkbenchApi } from '@sudowork/ontology-ui/OntologyWorkbench';
import ontologyEn from '@renderer/i18n/locales/en-US/ontology.json';
import ontologyZh from '@renderer/i18n/locales/zh-CN/ontology.json';

const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, options?: Record<string, unknown>) => (key === 'ontology.objectBuilder.attributes' ? `${key} (${options?.count})` : key)),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      error: vi.fn(),
      success: vi.fn(),
    },
  };
});

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid='ontology-graph' />,
}));

function createApi(): IOntologyWorkbenchApi {
  const snapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), {
    workspaceId: 'customer_domain',
    title: 'Customer Domain',
  });
  snapshot.objects = [
    {
      id: 'customer',
      code: 'customer',
      name: 'Customer',
      description: 'Customer object',
      tier: 3,
      status: 'active',
      sourceAssetIds: [],
      attributes: [],
      reviewDecision: 'pending',
      updatedAt: Date.now(),
    },
  ];
  snapshot.assets = [
    {
      id: 'customers_asset',
      kind: 'table',
      name: 'customers',
      sourceName: 'furnace-db',
      path: 'mysql://127.0.0.1/furnace/customers',
      profileStatus: 'ready',
      fields: [{ name: 'id', dataType: 'bigint', nullable: false }],
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'operations_document',
      kind: 'document',
      name: 'operations.md',
      sourceName: 'local-file',
      path: '/tmp/operations.md',
      profileStatus: 'ready',
      fields: [],
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
  snapshot.draft.selectedAssetIds = snapshot.assets.map((asset) => asset.id);
  snapshot.publishedVersions = [
    {
      id: 'version-1',
      version: 'v1',
      status: 'published',
      isActive: true,
      objectCount: snapshot.objects.length,
      relationCount: 0,
      publishedAt: Date.now(),
      summary: 'Published test ontology',
      diff: {
        addedObjectIds: ['customer'],
        changedObjectIds: [],
        removedObjectIds: [],
        addedRelationIds: [],
        changedRelationIds: [],
        removedRelationIds: [],
        riskLevel: 'low',
        summary: 'Initial version',
      },
      snapshot: {
        objects: snapshot.objects,
        relations: [],
        mappings: [],
        qualityRules: [],
        logicFunctions: [],
        actions: [],
        serviceEndpoints: [],
        businessDocuments: [],
      },
      createdAt: Date.now(),
    },
  ];
  snapshot.publishedVersions.push({ ...snapshot.publishedVersions[0], id: 'version-2', version: 'v2' }, { ...snapshot.publishedVersions[0], id: 'version-3', version: 'v3' });
  snapshot.stats = recalculateOntologyStats(snapshot);
  const summary = summarizeOntologyWorkbenchSnapshot(snapshot);
  const mutationResult = { snapshot, summaries: [summary], activeWorkspaceId: snapshot.workspaceId };
  const refreshSnapshot = () => {
    snapshot.stats = recalculateOntologyStats(snapshot);
    return {
      ...snapshot,
      objects: [...snapshot.objects],
      relations: [...snapshot.relations],
      mappings: [...snapshot.mappings],
      qualityRules: [...snapshot.qualityRules],
    };
  };

  return {
    listWorkbenches: vi.fn().mockResolvedValue({ activeWorkspaceId: snapshot.workspaceId, items: [summary] }),
    getWorkbench: vi.fn().mockResolvedValue(snapshot),
    createWorkbench: vi.fn().mockResolvedValue(mutationResult),
    selectWorkbench: vi.fn().mockResolvedValue(snapshot),
    deleteWorkbench: vi.fn().mockResolvedValue(mutationResult),
    updateDraft: vi.fn().mockResolvedValue(snapshot),
    transitionPhase: vi.fn().mockResolvedValue(snapshot),
    pickBuildFiles: vi.fn().mockResolvedValue([]),
    importFiles: vi.fn().mockResolvedValue({ snapshot, files: [] }),
    probeConnector: vi.fn(),
    browseConnectorAssets: vi.fn(),
    deleteConnector: vi.fn().mockResolvedValue(snapshot),
    deleteAsset: vi.fn().mockResolvedValue(snapshot),
    profileAsset: vi.fn().mockResolvedValue(snapshot),
    syncAssetSchema: vi.fn().mockResolvedValue(snapshot),
    previewAsset: vi.fn(),
    generateDraft: vi.fn().mockResolvedValue(snapshot),
    upsertObject: vi.fn().mockImplementation(async (input) => {
      const existing = input.id ? snapshot.objects.find((object) => object.id === input.id) : undefined;
      const object = {
        id: existing?.id ?? `object-${snapshot.objects.length + 1}`,
        code: input.code || input.name,
        name: input.name,
        description: input.description ?? existing?.description ?? '',
        tier: input.tier ?? existing?.tier ?? 3,
        status: input.status ?? existing?.status ?? 'active',
        namespace: input.namespace ?? existing?.namespace,
        sourceAssetIds: input.sourceAssetIds ?? existing?.sourceAssetIds ?? [],
        attributes: existing?.attributes ?? [],
        reviewDecision: 'pending' as const,
        updatedAt: Date.now(),
      };
      snapshot.objects = existing ? snapshot.objects.map((item) => (item.id === object.id ? object : item)) : [...snapshot.objects, object];
      return refreshSnapshot();
    }),
    deleteObject: vi.fn().mockResolvedValue(snapshot),
    upsertAttribute: vi.fn().mockImplementation(async (input: Parameters<IOntologyWorkbenchApi['upsertAttribute']>[0]) => {
      snapshot.objects = snapshot.objects.map((object) => {
        if (object.id !== input.objectId) return object;
        const existing = object.attributes.find((attribute) => attribute.id === input.id);
        const attribute: IOntologyAttributeDraft = {
          id: existing?.id ?? input.id ?? `attribute-${object.attributes.length + 1}`,
          code: input.code || input.name,
          name: input.name,
          dataType: input.dataType,
          required: input.required ?? false,
          description: input.description,
          example: input.example,
          constraints: input.constraints,
          mappedField: input.mappedField,
        };
        return {
          ...object,
          attributes: existing ? object.attributes.map((item) => (item.id === attribute.id ? attribute : item)) : [...object.attributes, attribute],
        };
      });
      return refreshSnapshot();
    }),
    deleteAttribute: vi.fn().mockImplementation(async (input: Parameters<IOntologyWorkbenchApi['deleteAttribute']>[0]) => {
      snapshot.objects = snapshot.objects.map((object) => (object.id === input.objectId ? { ...object, attributes: object.attributes.filter((attribute) => attribute.id !== input.attributeId) } : object));
      snapshot.mappings = snapshot.mappings.filter((mapping) => mapping.objectId !== input.objectId || mapping.attributeId !== input.attributeId);
      return refreshSnapshot();
    }),
    upsertRelation: vi.fn().mockResolvedValue(snapshot),
    deleteRelation: vi.fn().mockResolvedValue(snapshot),
    upsertMapping: vi.fn().mockResolvedValue(snapshot),
    deleteMapping: vi.fn().mockResolvedValue(snapshot),
    upsertQualityRule: vi.fn().mockResolvedValue(snapshot),
    deleteQualityRule: vi.fn().mockResolvedValue(snapshot),
    upsertLogicFunction: vi.fn().mockResolvedValue(snapshot),
    deleteLogicFunction: vi.fn().mockResolvedValue(snapshot),
    upsertAction: vi.fn().mockResolvedValue(snapshot),
    deleteAction: vi.fn().mockResolvedValue(snapshot),
    executeLogicFunction: vi.fn().mockImplementation(async (input) => ({
      snapshot: refreshSnapshot(),
      execution: {
        kind: 'logic' as const,
        artifactId: input.id ?? 'logic',
        code: 'customer_lookup',
        output: [{ customer_id: 'customer-1' }],
        durationMs: 2,
        executedAt: Date.now(),
      },
    })),
    executeRelation: vi.fn().mockImplementation(async (input) => ({
      snapshot: refreshSnapshot(),
      execution: {
        kind: 'relation' as const,
        artifactId: input.id ?? 'relation',
        code: 'customer_orders',
        output: { rows: [] },
        durationMs: 2,
        executedAt: Date.now(),
      },
    })),
    executeAction: vi.fn().mockImplementation(async (input) => ({
      snapshot: refreshSnapshot(),
      execution: {
        kind: 'action' as const,
        artifactId: input.id ?? 'action',
        code: 'notify_customer',
        output: { delivered: true },
        durationMs: 2,
        executedAt: Date.now(),
      },
    })),
    reviewTarget: vi.fn().mockImplementation(async (input) => {
      if (input.targetType === 'object') {
        snapshot.objects = snapshot.objects.map((object) => (object.id === input.targetId ? { ...object, reviewDecision: input.decision } : object));
      }
      return refreshSnapshot();
    }),
    approveAll: vi.fn().mockResolvedValue(snapshot),
    runConsistencyCheck: vi.fn().mockResolvedValue({
      isValid: true,
      checkedAt: Date.now(),
      issues: [],
    }),
    publishCurrentDraft: vi.fn(),
    approvePublishedVersion: vi.fn().mockResolvedValue(snapshot),
    rejectPublishedVersion: vi.fn().mockResolvedValue(snapshot),
    rollbackToVersion: vi.fn().mockResolvedValue(snapshot),
    createAgentBlueprint: vi.fn(),
    registerAgentBlueprint: vi.fn(),
    deleteAgentBlueprint: vi.fn().mockResolvedValue(snapshot),
    resetWorkbench: vi.fn().mockResolvedValue(snapshot),
    onWorkbenchChanged: vi.fn().mockReturnValue((): void => undefined),
  };
}

function createAttribute(overrides: Partial<IOntologyAttributeDraft> = {}): IOntologyAttributeDraft {
  return {
    id: 'customer_id',
    name: 'Customer ID',
    code: 'customer_id',
    dataType: 'bigint',
    required: true,
    description: 'Stable customer identifier',
    example: '123',
    constraints: { min: 1 },
    mappedField: { assetId: 'customers_asset', fieldName: 'id' },
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function openGuidedBuilder(api: IOntologyWorkbenchApi, method: 'document' | 'asset' = 'document') {
  render(<OntologyWorkbench api={api} />);
  await screen.findAllByText(translate('ontology.console.views.connections.title'));
  fireEvent.click(screen.getAllByText(translate('ontology.console.views.ontology.title'))[0]);
  fireEvent.click((await screen.findAllByText(translate('ontology.list.detail')))[0]);
  fireEvent.click(await screen.findByText(translate('ontology.detail.tabs.objects')));
  fireEvent.click(screen.getByText(translate('ontology.editor.addObject')));
  fireEvent.click(await screen.findByText(translate(`ontology.objectBuilder.${method}`)));
  await screen.findByText(translate(`ontology.objectBuilder.${method === 'document' ? 'document' : 'business'}StepTitle`));
}

function onSelectDocumentForExtraction() {
  fireEvent.click(screen.getByText('operations.md'));
  fireEvent.change(screen.getByPlaceholderText(translate('ontology.documentBuilder.documentGoalPlaceholder')), {
    target: { value: 'Model operational documents' },
  });
  fireEvent.click(screen.getByText(translate('ontology.objectBuilder.next')));
}

async function openObjectEditor(api: IOntologyWorkbenchApi) {
  render(<OntologyWorkbench api={api} />);
  await screen.findAllByText('ontology.console.views.connections.title');
  fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
  fireEvent.click(await screen.findByText('ontology.list.detail'));
  fireEvent.click(await screen.findByText('ontology.detail.tabs.objects'));
  fireEvent.click(await screen.findByRole('button', { name: 'Customer' }));
  const dialog = await screen.findByRole('dialog', { name: 'ontology.editor.editObject' });
  expect(dialog.closest('.ontology-object-editor')).not.toBeNull();
  return dialog;
}

async function openAttributeEditor(parent: HTMLElement, name?: string) {
  if (name) {
    fireEvent.click(within(getAttributeRow(parent, name)).getByRole('button', { name: 'ontology.editor.edit' }));
  } else {
    fireEvent.click(within(parent).getByRole('button', { name: 'ontology.editor.addAttributeShort' }));
  }
  const dialog = await screen.findByRole('dialog', { name: name ? 'ontology.editor.editAttribute' : 'ontology.editor.addAttribute' });
  expect(dialog.closest('.ontology-attribute-editor')).not.toBeNull();
  return dialog;
}

function getAttributeRow(parent: HTMLElement, name: string) {
  const row = within(parent).getByTitle(name).closest('div')?.parentElement;
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function changeEditorFields(dialog: HTMLElement, fields: Record<string, string>) {
  for (const [field, value] of Object.entries(fields)) {
    fireEvent.change(within(dialog).getByPlaceholderText(`ontology.editor.${field}`), { target: { value } });
  }
}

function expectEditorFields(dialog: HTMLElement, fields: Record<string, string>) {
  for (const [field, value] of Object.entries(fields)) {
    expect(within(dialog).getByPlaceholderText(`ontology.editor.${field}`)).toHaveValue(value);
  }
}

function expectAttributeCount(parent: HTMLElement, count: number) {
  expect(within(parent).getByText(`ontology.objectBuilder.attributes (${count})`)).toBeInTheDocument();
  const header = screen.getByRole('columnheader', { name: 'ontology.generate.columns.attributes' });
  const table = header.closest('table') as HTMLElement;
  const columnIndex = within(table).getAllByRole('columnheader').indexOf(header);
  const row = within(table).getByRole('button', { name: 'Customer' }).closest('tr') as HTMLElement;
  expect(within(row).getAllByRole('cell')[columnIndex]).toHaveTextContent(new RegExp(`^${count}$`));
}

function expectParentBlocked(parent: HTMLElement) {
  const scope = within(parent);
  expect(scope.getByRole('button', { name: 'ontology.objectEditor.saveBasicInfo' })).toBeDisabled();
  expect(scope.getByRole('button', { name: 'ontology.objectEditor.close' })).toBeDisabled();
  expect(scope.getByRole('button', { name: 'ontology.editor.addAttributeShort' })).toBeDisabled();
  expect(scope.getByPlaceholderText('ontology.editor.displayName')).toBeDisabled();
  expect(scope.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  const wrapper = parent.closest('.ontology-object-editor') as HTMLElement;
  fireEvent.keyDown(wrapper, { key: 'Escape', code: 'Escape' });
  fireEvent.mouseDown(wrapper);
  fireEvent.click(wrapper);
  expect(parent).toBeVisible();
}

async function onCloseModal(button: HTMLElement) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await act(async () => {
      fireEvent.click(button);
    });
    // Arco registers its 400ms exit timer after the asynchronous save commits.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  } finally {
    vi.useRealTimers();
  }
}

async function openNewConnector(category = 'database') {
  fireEvent.click(await screen.findByRole('button', { name: 'ontology.console.actions.newConnection' }));
  const picker = await screen.findByRole('dialog', { name: 'ontology.console.connectionPicker.title' });
  const categoryCard = within(picker).getByText(`ontology.console.connectionPicker.categories.${category}.title`).closest('[role="button"]') as HTMLElement;
  await onCloseModal(categoryCard);
  return screen.findByRole('dialog', { name: 'ontology.console.connectionForm.newTitle' });
}

function getConnectorFormItem(dialog: HTMLElement, field: string) {
  return within(dialog).getByText(`ontology.console.connectionForm.${field}`).closest('.arco-form-item') as HTMLElement;
}

function getConnectorField(dialog: HTMLElement, field: string) {
  return getConnectorFormItem(dialog, field).querySelector('input, textarea') as HTMLInputElement;
}

async function openConnectorTypeOptions(dialog: HTMLElement) {
  fireEvent.click(getConnectorFormItem(dialog, 'type').querySelector('.arco-select-view') as HTMLElement);
  return screen.findAllByRole('option');
}

async function openDeleteConfirmation(parent: HTMLElement, name = 'Customer ID') {
  fireEvent.click(within(getAttributeRow(parent, name)).getByRole('button', { name: 'ontology.editor.delete' }));
  return screen.findByRole('dialog', { name: 'ontology.objectEditor.deleteAttributeTitle' });
}

describe('OntologyWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    translate.mockImplementation((key, options) => (key === 'ontology.objectBuilder.attributes' ? `${key} (${options?.count})` : key));
    window.matchMedia = vi.fn<(query: string) => MediaQueryList>().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(async () => {
    act(() => Modal.destroyAll());
    cleanup();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    vi.restoreAllMocks();
  });

  describe.each(['ontology', 'publish'])('%s card titles', (view) => {
    it.each(['Customer Domain', ''])('keeps the name or fallback for "%s" with an explicit font-size class', async (name) => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.draft.title = name;
      vi.mocked(api.listWorkbenches).mockResolvedValue({ activeWorkspaceId: snapshot.workspaceId, items: [{ ...summarizeOntologyWorkbenchSnapshot(snapshot), name }] });
      render(<OntologyWorkbench api={api} />);

      fireEvent.click((await screen.findAllByText(`ontology.console.views.${view}.title`))[0]);
      const title = (await screen.findByText(name || 'ontology.list.defaultName')).closest('.arco-typography');
      expect(title?.closest('[role="button"]')).not.toBeNull();
      expect(title).toHaveTextContent(name || 'ontology.list.defaultName');
      expect(title).toHaveClass('block', 'truncate', 'text-size-base');
      expect(title).not.toHaveClass('text-base');
      expect(title?.parentElement).toHaveClass('min-w-0', 'flex-1', 'basis-24');
      expect(title?.parentElement?.parentElement).toHaveClass('flex-wrap');
    });
  });

  describe('connector type options', () => {
    it('offers only MySQL and PostgreSQL for new databases and submits PostgreSQL parameters', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      vi.mocked(api.probeConnector).mockImplementation(async ({ connector }) => ({
        snapshot,
        connector: { ...connector, id: 'new-postgresql', metadata: connector.metadata ?? {}, probeStatus: 'reachable', createdAt: 1, updatedAt: 1 },
        assets: [],
      }));
      render(<OntologyWorkbench api={api} />);
      const dialog = await openNewConnector();
      expect(getConnectorField(dialog, 'category')).toHaveValue('ontology.console.connectionPicker.categories.database.title');
      expect(getConnectorFormItem(dialog, 'type')).toHaveTextContent('ontology.connectorType.mysql');
      const options = await openConnectorTypeOptions(dialog);
      expect.soft(options.map((option) => option.textContent)).toEqual(['ontology.connectorType.mysql', 'ontology.connectorType.postgresql']);
      fireEvent.click(screen.getByRole('option', { name: 'ontology.connectorType.postgresql' }));
      expect(getConnectorField(dialog, 'port')).toHaveValue('5432');
      const fields = { name: 'Reporting database', host: 'postgres.example.invalid', port: '15432', database: 'reporting', username: 'test_reader', password: 'fake-test-password', poolSize: '6', rateLimitQps: '35', description: 'Reporting connection' };
      for (const [field, value] of Object.entries(fields)) {
        fireEvent.change(getConnectorField(dialog, field), { target: { value } });
      }
      fireEvent.click(within(getConnectorFormItem(dialog, 'writable')).getByRole('switch'));
      await onCloseModal(within(dialog).getByRole('button', { name: 'ontology.connector.scan' }));

      expect(api.probeConnector).toHaveBeenCalledExactlyOnceWith({
        connector: {
          name: fields.name,
          sourceType: 'postgresql',
          kind: 'database',
          host: fields.host,
          port: 15432,
          database: fields.database,
          username: fields.username,
          password: fields.password,
          credential: { username: fields.username, password: fields.password },
          writable: true,
          poolSize: 6,
          rateLimitQps: 35,
          description: fields.description,
          metadata: { displayName: fields.name, host: fields.host, port: 15432, database: fields.database },
        },
        recursive: true,
        maxAssets: 300,
      });
      expect(dialog).not.toBeVisible();
    });

    it.each(['oracle', 'sqlserver'] as const)('preserves legacy %s edits and restores restricted options when creating next', async (sourceType) => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      const fields = { host: `${sourceType}.example.invalid`, port: sourceType === 'oracle' ? 1522 : 1434, database: 'legacy_reporting', username: 'test_reader', password: 'fake-legacy-password', writable: true, poolSize: 7, rateLimitQps: 45, description: 'Legacy reporting connection' };
      const metadata = { displayName: `Legacy ${sourceType}`, owner: 'test-fixture', host: fields.host, port: fields.port, database: fields.database };
      const connector = { id: `legacy-${sourceType}`, name: `${sourceType}::stored-name`, sourceType, kind: 'database' as const, ...fields, metadata, probeStatus: 'reachable' as const, createdAt: 1, updatedAt: 1 };
      snapshot.connectors = [connector];
      vi.mocked(api.probeConnector).mockResolvedValue({ snapshot, connector, assets: [] });
      render(<OntologyWorkbench api={api} />);
      const row = (await screen.findByText(metadata.displayName)).closest('tr') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'ontology.editor.edit' }));
      const dialog = await screen.findByRole('dialog', { name: 'ontology.console.connectionForm.editTitle' });
      expect(getConnectorField(dialog, 'name')).toHaveValue(metadata.displayName);
      expect(getConnectorField(dialog, 'category')).toHaveValue('ontology.console.connectionPicker.categories.database.title');
      expect(getConnectorFormItem(dialog, 'type')).toHaveTextContent(`ontology.connectorType.${sourceType}`);
      for (const [field, value] of Object.entries(fields)) {
        if (field !== 'writable') expect(getConnectorField(dialog, field)).toHaveValue(String(value));
      }
      expect(within(getConnectorFormItem(dialog, 'writable')).getByRole('switch')).toBeChecked();
      const options = await openConnectorTypeOptions(dialog);
      expect(options.map((option) => option.textContent)).toEqual(['ontology.connectorType.mysql', 'ontology.connectorType.postgresql', 'ontology.connectorType.oracle', 'ontology.connectorType.sqlserver']);
      expect(screen.getByRole('option', { name: `ontology.connectorType.${sourceType}` })).toHaveAttribute('aria-selected', 'true');
      await onCloseModal(within(dialog).getByRole('button', { name: 'ontology.connector.scan' }));
      expect(api.probeConnector).toHaveBeenCalledExactlyOnceWith({
        connector: { id: connector.id, name: connector.name, sourceType, kind: 'database', ...fields, credential: { username: fields.username, password: fields.password }, metadata },
        recursive: true,
        maxAssets: 300,
      });
      expect(dialog).not.toBeVisible();

      const newDialog = await openNewConnector();
      expect(getConnectorFormItem(newDialog, 'type')).toHaveTextContent('ontology.connectorType.mysql');
      for (const field of ['name', 'host', 'database', 'username', 'password', 'description']) {
        expect(getConnectorField(newDialog, field)).toHaveValue('');
      }
      expect(getConnectorField(newDialog, 'port')).toHaveValue('3306');
      expect(within(getConnectorFormItem(newDialog, 'writable')).getByRole('switch')).not.toBeChecked();
      expect((await openConnectorTypeOptions(newDialog)).map((option) => option.textContent)).toEqual(['ontology.connectorType.mysql', 'ontology.connectorType.postgresql']);
      expect(snapshot.connectors).toEqual([connector]);
      expect(api.probeConnector).toHaveBeenCalledTimes(1);
    });

    it.each(['ftp', 'sftp'])('keeps file transfer options and %s fields available', async (sourceType) => {
      render(<OntologyWorkbench api={createApi()} />);
      const dialog = await openNewConnector('file_transfer');
      expect(getConnectorField(dialog, 'category')).toHaveValue('ontology.console.connectionPicker.categories.file_transfer.title');
      const options = await openConnectorTypeOptions(dialog);
      expect(options.map((option) => option.textContent)).toEqual(['ontology.connectorType.ftp', 'ontology.connectorType.sftp']);
      fireEvent.click(screen.getByRole('option', { name: `ontology.connectorType.${sourceType}` }));
      expect(getConnectorFormItem(dialog, 'type')).toHaveTextContent(`ontology.connectorType.${sourceType}`);
      expect(getConnectorField(dialog, 'port')).toHaveValue(sourceType === 'ftp' ? '21' : '22');
      expect(getConnectorField(dialog, 'rootPath')).toHaveValue('/');
      expect(getConnectorField(dialog, 'username')).toHaveValue('');
      expect(getConnectorField(dialog, 'password')).toHaveValue('');
      expect(within(dialog).queryByText('ontology.console.connectionForm.database')).not.toBeInTheDocument();
      if (sourceType === 'ftp') {
        expect(within(getConnectorFormItem(dialog, 'useTls')).getByRole('switch')).not.toBeChecked();
      } else {
        expect(within(dialog).queryByText('ontology.console.connectionForm.useTls')).not.toBeInTheDocument();
      }
    });
  });

  describe('object attribute editor', () => {
    it('shows existing attributes, required state, counts and the immediate-save hint', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.objects[0].attributes = [createAttribute(), createAttribute({ id: 'nickname', name: 'Nickname', code: 'nickname', dataType: 'string', required: false })];
      const parent = await openObjectEditor(api);

      expectEditorFields(parent, { displayName: 'Customer', englishName: 'customer', description: 'Customer object' });
      expect(within(parent).getByText('ontology.objectEditor.attributeSaveHint')).toBeInTheDocument();
      expect(within(parent).getByRole('button', { name: 'ontology.objectEditor.saveBasicInfo' })).toBeEnabled();
      expect(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' })).toBeEnabled();
      expectAttributeCount(parent, 2);
      const requiredRow = within(getAttributeRow(parent, 'Customer ID'));
      expect(requiredRow.getByText('customer_id')).toBeInTheDocument();
      expect(requiredRow.getByText('bigint')).toBeInTheDocument();
      expect(requiredRow.getByText('ontology.editor.required')).toBeInTheDocument();
      const optionalRow = within(getAttributeRow(parent, 'Nickname'));
      expect(optionalRow.getByText('nickname')).toBeInTheDocument();
      expect(optionalRow.getByText('string')).toBeInTheDocument();
      expect(optionalRow.queryByText('ontology.editor.required')).not.toBeInTheDocument();
      expect(within(parent).queryByText('ontology.objectBuilder.emptyAttributes')).not.toBeInTheDocument();
      expect(api.upsertObject).not.toHaveBeenCalled();
      expect(api.upsertAttribute).not.toHaveBeenCalled();
    });

    it('creates an attribute immediately from an empty list and retains it after closing without saving basic fields', async () => {
      const api = createApi();
      const parent = await openObjectEditor(api);
      expect(within(parent).getByText('ontology.objectBuilder.emptyAttributes')).toBeInTheDocument();
      expectAttributeCount(parent, 0);
      const basicFields = { displayName: 'Unsaved customer', englishName: 'unsaved_customer', description: 'Unsaved description' };
      changeEditorFields(parent, basicFields);
      const child = await openAttributeEditor(parent);
      expectEditorFields(child, { name: '', code: '', dataType: 'string', description: '', example: '', constraints: '{}' });
      expect(within(child).getByRole('checkbox', { name: 'ontology.editor.required' })).not.toBeChecked();
      expect(within(child).getByRole('button', { name: 'ontology.editor.save' })).toBeDisabled();
      expectParentBlocked(parent);
      changeEditorFields(child, { name: 'Email', code: 'email', description: 'Contact email', example: 'a@example.com', constraints: '{"maxLength": 255}' });
      fireEvent.click(within(child).getByRole('checkbox', { name: 'ontology.editor.required' }));
      await onCloseModal(within(child).getByRole('button', { name: 'ontology.editor.save' }));

      await waitFor(() => expect(child).not.toBeVisible());
      expect(api.upsertAttribute).toHaveBeenCalledExactlyOnceWith({
        id: undefined,
        objectId: 'customer',
        name: 'Email',
        code: 'email',
        dataType: 'string',
        description: 'Contact email',
        example: 'a@example.com',
        required: true,
        constraints: { maxLength: 255 },
        mappedField: undefined,
      });
      expectAttributeCount(parent, 1);
      expectEditorFields(parent, basicFields);
      expect(getAttributeRow(parent, 'Email')).toBeInTheDocument();
      expect(within(parent).queryByText('ontology.objectBuilder.emptyAttributes')).not.toBeInTheDocument();
      await onCloseModal(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' }));
      await waitFor(() => expect(parent).not.toBeVisible());
      expect(api.upsertObject).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
      const reopened = await screen.findByRole('dialog', { name: 'ontology.editor.editObject' });
      expectEditorFields(reopened, { displayName: 'Customer', englishName: 'customer', description: 'Customer object' });
      expectAttributeCount(reopened, 1);
      const reopenedChild = await openAttributeEditor(reopened, 'Email');
      expectEditorFields(reopenedChild, { name: 'Email', code: 'email', description: 'Contact email', example: 'a@example.com' });
      expect(JSON.parse((within(reopenedChild).getByPlaceholderText('ontology.editor.constraints') as HTMLTextAreaElement).value)).toEqual({ maxLength: 255 });
      expect(within(reopenedChild).getByRole('checkbox', { name: 'ontology.editor.required' })).toBeChecked();
    });

    it('edits by existing ID with description and the latest mapped field without resetting unsaved basic fields', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.objects[0] = { ...snapshot.objects[0], tier: 2, status: 'warning', namespace: 'crm', sourceAssetIds: ['customers_asset'], attributes: [createAttribute()] };
      const parent = await openObjectEditor(api);
      const basicFields = { displayName: 'Saved customer', englishName: 'saved_customer', description: 'Saved description' };
      changeEditorFields(parent, basicFields);
      const child = await openAttributeEditor(parent, 'Customer ID');
      expectEditorFields(child, { name: 'Customer ID', code: 'customer_id', dataType: 'bigint', description: 'Stable customer identifier', example: '123' });
      expect(JSON.parse((within(child).getByPlaceholderText('ontology.editor.constraints') as HTMLTextAreaElement).value)).toEqual({ min: 1 });
      expect(within(child).getByRole('checkbox', { name: 'ontology.editor.required' })).toBeChecked();
      const attributeFields = { name: 'External ID', code: 'external_id', dataType: 'string', description: 'External customer identifier', example: 'C-123', constraints: '{"minLength": 2, "maxLength": 20}' };
      changeEditorFields(child, attributeFields);
      fireEvent.click(within(child).getByRole('checkbox', { name: 'ontology.editor.required' }));

      const mappedField = { assetId: 'customers_asset', fieldName: 'external_id' };
      snapshot.objects = snapshot.objects.map((object) => ({ ...object, attributes: object.attributes.map((attribute) => ({ ...attribute, mappedField })) }));
      const onWorkbenchChanged = vi.mocked(api.onWorkbenchChanged).mock.calls.at(-1)![0];
      await act(async () => onWorkbenchChanged({ ...snapshot }));
      expectEditorFields(child, attributeFields);
      expectEditorFields(parent, basicFields);
      await onCloseModal(within(child).getByRole('button', { name: 'ontology.editor.save' }));
      await waitFor(() => expect(child).not.toBeVisible());

      expect(api.upsertAttribute).toHaveBeenCalledExactlyOnceWith({
        id: 'customer_id',
        objectId: 'customer',
        name: 'External ID',
        code: 'external_id',
        dataType: 'string',
        description: 'External customer identifier',
        example: 'C-123',
        required: false,
        constraints: { minLength: 2, maxLength: 20 },
        mappedField,
      });
      expectAttributeCount(parent, 1);
      expect(within(parent).queryByTitle('Customer ID')).not.toBeInTheDocument();
      expect(within(getAttributeRow(parent, 'External ID')).queryByText('ontology.editor.required')).not.toBeInTheDocument();
      expectEditorFields(parent, basicFields);
      expect(api.upsertObject).not.toHaveBeenCalled();
      await onCloseModal(within(parent).getByRole('button', { name: 'ontology.objectEditor.saveBasicInfo' }));
      await waitFor(() => expect(parent).not.toBeVisible());
      expect(api.upsertObject).toHaveBeenCalledExactlyOnceWith({ id: 'customer', name: 'Saved customer', code: 'saved_customer', description: 'Saved description', tier: 2, status: 'warning', namespace: 'crm', sourceAssetIds: ['customers_asset'] });
      fireEvent.click(screen.getByRole('button', { name: 'Saved customer' }));
      const reopened = await screen.findByRole('dialog', { name: 'ontology.editor.editObject' });
      expectEditorFields(reopened, basicFields);
      const reopenedChild = await openAttributeEditor(reopened, 'External ID');
      expectEditorFields(reopenedChild, { ...attributeFields, constraints: JSON.stringify({ minLength: 2, maxLength: 20 }, null, 2) });
      expect((await api.getWorkbench()).objects[0].attributes).toHaveLength(1);
      expect((await api.getWorkbench()).objects[0].attributes[0].mappedField).toEqual(mappedField);
    });

    it('deletes immediately after confirmation, removes only matching mappings and preserves unsaved basic fields', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.objects[0].attributes = [createAttribute(), createAttribute({ id: 'email', name: 'Email', code: 'email', required: false })];
      const mapping = { id: 'customer_mapping', objectId: 'customer', attributeId: 'customer_id', assetId: 'customers_asset', fieldName: 'id', confidence: 1, strategy: 'manual' as const, status: 'approved' as const, updatedAt: Date.now() };
      snapshot.mappings = [mapping, { ...mapping, id: 'email_mapping', attributeId: 'email' }, { ...mapping, id: 'other_object_mapping', objectId: 'other_customer' }];
      const parent = await openObjectEditor(api);
      const basicFields = { displayName: 'Unsaved customer', englishName: 'unsaved_customer', description: 'Unsaved description' };
      changeEditorFields(parent, basicFields);
      const confirmation = await openDeleteConfirmation(parent);
      expect(within(confirmation).getByText('ontology.objectEditor.deleteAttributeContent')).toBeInTheDocument();
      expect(api.deleteAttribute).not.toHaveBeenCalled();
      expectParentBlocked(parent);
      fireEvent.click(within(confirmation).getByRole('button', { name: 'ontology.editor.delete' }));
      await waitFor(() => expect(confirmation).not.toBeInTheDocument());

      expect(api.deleteAttribute).toHaveBeenCalledExactlyOnceWith({ objectId: 'customer', attributeId: 'customer_id' });
      expectAttributeCount(parent, 1);
      expect(within(parent).queryByTitle('Customer ID')).not.toBeInTheDocument();
      expect(getAttributeRow(parent, 'Email')).toBeInTheDocument();
      expect(snapshot.mappings.map((item) => item.id)).toEqual(['email_mapping', 'other_object_mapping']);
      expectEditorFields(parent, basicFields);
      expect(api.upsertObject).not.toHaveBeenCalled();
      await onCloseModal(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' }));
      await waitFor(() => expect(parent).not.toBeVisible());
      fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
      const reopened = await screen.findByRole('dialog', { name: 'ontology.editor.editObject' });
      expect(within(reopened).queryByTitle('Customer ID')).not.toBeInTheDocument();
      expectAttributeCount(reopened, 1);
      expectEditorFields(reopened, { displayName: 'Customer', englishName: 'customer', description: 'Customer object' });
    });

    it.each(['create', 'edit'] as const)('cancels child %s without changing attributes or unsaved parent fields', async (mode) => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.objects[0].attributes = [createAttribute()];
      const parent = await openObjectEditor(api);
      const basicFields = { displayName: 'Unsaved customer', englishName: 'unsaved_customer', description: 'Unsaved description' };
      changeEditorFields(parent, basicFields);
      const child = await openAttributeEditor(parent, mode === 'edit' ? 'Customer ID' : undefined);
      expectParentBlocked(parent);
      changeEditorFields(child, { name: 'Discarded attribute', code: 'discarded', description: 'Discarded description' });
      fireEvent.click(within(child).getByRole('button', { name: 'ontology.reset.cancel' }));
      await waitFor(() => expect(child).not.toBeVisible());

      expectEditorFields(parent, basicFields);
      expectAttributeCount(parent, 1);
      expect(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' })).toBeEnabled();
      expect(api.upsertAttribute).not.toHaveBeenCalled();
      expect(api.upsertObject).not.toHaveBeenCalled();
      expect(snapshot.objects[0].attributes).toEqual([createAttribute()]);
      const reopened = await openAttributeEditor(parent, mode === 'edit' ? 'Customer ID' : undefined);
      expectEditorFields(reopened, mode === 'edit' ? { name: 'Customer ID', code: 'customer_id', description: 'Stable customer identifier' } : { name: '', code: '', description: '' });
    });

    it('dismisses only the child with Escape and allows closing the parent afterwards', async () => {
      const api = createApi();
      const parent = await openObjectEditor(api);
      changeEditorFields(parent, { displayName: 'Unsaved customer' });
      const child = await openAttributeEditor(parent);
      changeEditorFields(child, { name: 'Discarded attribute' });
      fireEvent.keyDown(within(child).getByPlaceholderText('ontology.editor.name'), { key: 'Escape', code: 'Escape' });
      await waitFor(() => expect(child).not.toBeVisible());
      expect(parent).toBeVisible();
      expectEditorFields(parent, { displayName: 'Unsaved customer' });
      await onCloseModal(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' }));
      await waitFor(() => expect(parent).not.toBeVisible());
      expect(api.upsertObject).not.toHaveBeenCalled();
      expect(api.upsertAttribute).not.toHaveBeenCalled();
    });

    it('cancels deletion without mutating attributes or mappings and unlocks the parent', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.objects[0].attributes = [createAttribute()];
      snapshot.mappings = [{ id: 'customer_mapping', objectId: 'customer', attributeId: 'customer_id', assetId: 'customers_asset', fieldName: 'id', confidence: 1, strategy: 'manual', status: 'approved', updatedAt: Date.now() }];
      const originalMappings = [...snapshot.mappings];
      const parent = await openObjectEditor(api);
      changeEditorFields(parent, { displayName: 'Unsaved customer' });
      const confirmation = await openDeleteConfirmation(parent);
      expectParentBlocked(parent);
      fireEvent.click(within(confirmation).getByRole('button', { name: 'ontology.reset.cancel' }));
      await waitFor(() => expect(confirmation).not.toBeInTheDocument());

      expect(api.deleteAttribute).not.toHaveBeenCalled();
      expect(snapshot.mappings).toEqual(originalMappings);
      expectAttributeCount(parent, 1);
      expectEditorFields(parent, { displayName: 'Unsaved customer' });
      expect(within(parent).getByRole('button', { name: 'ontology.objectEditor.saveBasicInfo' })).toBeEnabled();
      expect(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' })).toBeEnabled();
      const child = await openAttributeEditor(parent, 'Customer ID');
      expectEditorFields(child, { name: 'Customer ID' });
    });

    it.each(['name', 'dataType'])('disables saving a whitespace-only attribute %s', async (field) => {
      const api = createApi();
      const parent = await openObjectEditor(api);
      const child = await openAttributeEditor(parent);
      changeEditorFields(child, { name: 'Valid name', code: 'valid_code', dataType: 'string', [field]: '   ' });
      const save = within(child).getByRole('button', { name: 'ontology.editor.save' });
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(api.upsertAttribute).not.toHaveBeenCalled();
      expect(child).toBeVisible();
      expectEditorFields(child, { [field]: '   ' });
      changeEditorFields(child, { [field]: field === 'name' ? 'Valid name' : 'string' });
      expect(save).toBeEnabled();
    });

    it.each(['{invalid', '[]', 'null', '"text"', '123'])('retains inputs and skips the API for invalid constraints %s', async (constraints) => {
      const api = createApi();
      const parent = await openObjectEditor(api);
      const child = await openAttributeEditor(parent);
      const fields = { name: 'Email', code: 'email', dataType: 'string', description: 'Contact email', example: 'a@example.com', constraints };
      changeEditorFields(child, fields);
      fireEvent.click(within(child).getByRole('checkbox', { name: 'ontology.editor.required' }));
      fireEvent.click(within(child).getByRole('button', { name: 'ontology.editor.save' }));
      await waitFor(() => expect(Message.error).toHaveBeenCalledWith('ontology.errors.withMessage'));

      expect(api.upsertAttribute).not.toHaveBeenCalled();
      expect(child).toBeVisible();
      expectEditorFields(child, fields);
      expect(within(child).getByRole('checkbox', { name: 'ontology.editor.required' })).toBeChecked();
      expect(within(child).getByRole('button', { name: 'ontology.editor.save' })).toBeEnabled();
      expect(within(child).getByRole('button', { name: 'ontology.reset.cancel' })).toBeEnabled();
    });

    it('retains all inputs after a duplicate-code API failure and saves successfully after correction', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.objects[0].attributes = [createAttribute()];
      vi.mocked(api.upsertAttribute).mockRejectedValueOnce(new Error('Duplicate attribute code: customer_id'));
      const parent = await openObjectEditor(api);
      const child = await openAttributeEditor(parent);
      const fields = { name: 'External ID', code: 'customer_id', dataType: 'string', description: 'External identifier', example: 'C-123', constraints: '{"minLength": 1}' };
      changeEditorFields(child, fields);
      fireEvent.click(within(child).getByRole('checkbox', { name: 'ontology.editor.required' }));
      fireEvent.click(within(child).getByRole('button', { name: 'ontology.editor.save' }));
      await waitFor(() => expect(Message.error).toHaveBeenCalledWith('ontology.errors.withMessage'));

      expect(api.upsertAttribute).toHaveBeenCalledTimes(1);
      expect(child).toBeVisible();
      expectEditorFields(child, fields);
      expect(within(child).getByRole('checkbox', { name: 'ontology.editor.required' })).toBeChecked();
      expectAttributeCount(parent, 1);
      expectParentBlocked(parent);
      changeEditorFields(child, { code: 'external_id' });
      await onCloseModal(within(child).getByRole('button', { name: 'ontology.editor.save' }));
      await waitFor(() => expect(child).not.toBeVisible());
      expect(api.upsertAttribute).toHaveBeenCalledTimes(2);
      expect(api.upsertAttribute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'External ID', code: 'external_id', description: 'External identifier', example: 'C-123', required: true, constraints: { minLength: 1 } }));
      expectAttributeCount(parent, 2);
      expect(getAttributeRow(parent, 'External ID')).toBeInTheDocument();
    });

    it('blocks duplicate submissions, cancellation and closing both dialogs while an attribute save is pending', async () => {
      const api = createApi();
      const pending = createDeferred<void>();
      const saveAttribute = vi.mocked(api.upsertAttribute).getMockImplementation()!;
      vi.mocked(api.upsertAttribute).mockImplementationOnce(async (input) => {
        await pending.promise;
        return saveAttribute(input);
      });
      const parent = await openObjectEditor(api);
      changeEditorFields(parent, { displayName: 'Unsaved customer' });
      const child = await openAttributeEditor(parent);
      changeEditorFields(child, { name: 'Email', code: 'email' });
      const save = within(child).getByRole('button', { name: 'ontology.editor.save' });
      fireEvent.click(save);
      await waitFor(() => expect(api.upsertAttribute).toHaveBeenCalledTimes(1));

      expect(save).toBeDisabled();
      expect(save).toHaveClass('arco-btn-loading');
      expect(within(child).getByRole('button', { name: 'ontology.reset.cancel' })).toBeDisabled();
      expect(within(child).getByPlaceholderText('ontology.editor.name')).toBeDisabled();
      expect(within(child).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
      expectParentBlocked(parent);
      fireEvent.click(save);
      fireEvent.click(within(child).getByRole('button', { name: 'ontology.reset.cancel' }));
      const wrapper = child.closest('.ontology-attribute-editor') as HTMLElement;
      fireEvent.keyDown(wrapper, { key: 'Escape', code: 'Escape' });
      fireEvent.mouseDown(wrapper);
      fireEvent.click(wrapper);
      expect(child).toBeVisible();
      expect(api.upsertAttribute).toHaveBeenCalledTimes(1);
      expect(api.upsertObject).not.toHaveBeenCalled();
      expectAttributeCount(parent, 0);

      await act(async () => pending.resolve());
      await waitFor(() => expect(child).not.toBeVisible());
      expectAttributeCount(parent, 1);
      expectEditorFields(parent, { displayName: 'Unsaved customer' });
      expect(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' })).toBeEnabled();
    });

    it('keeps a failed deletion open for retry and blocks cancellation and closing while each request is pending', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.objects[0].attributes = [createAttribute()];
      const firstAttempt = createDeferred<Awaited<ReturnType<IOntologyWorkbenchApi['deleteAttribute']>>>();
      const retry = createDeferred<void>();
      const deleteAttribute = vi.mocked(api.deleteAttribute).getMockImplementation()!;
      vi.mocked(api.deleteAttribute)
        .mockReturnValueOnce(firstAttempt.promise)
        .mockImplementationOnce(async (input) => {
          await retry.promise;
          return deleteAttribute(input);
        });
      const onConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const parent = await openObjectEditor(api);
      changeEditorFields(parent, { displayName: 'Unsaved customer' });
      const confirmation = await openDeleteConfirmation(parent);
      const confirmScope = within(confirmation);
      const deleteButton = confirmScope.getByRole('button', { name: 'ontology.editor.delete' });
      const cancelButton = confirmScope.getByRole('button', { name: 'ontology.reset.cancel' });
      fireEvent.click(deleteButton);
      await waitFor(() => expect(cancelButton).toBeDisabled());
      expectParentBlocked(parent);
      expect(deleteButton).toHaveClass('arco-btn-loading');
      expect(confirmScope.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
      fireEvent.click(cancelButton);
      fireEvent.click(deleteButton);
      const wrapper = confirmation.closest('.arco-modal-wrapper') as HTMLElement;
      fireEvent.keyDown(wrapper, { key: 'Escape', code: 'Escape' });
      fireEvent.mouseDown(wrapper);
      fireEvent.click(wrapper);
      expect(confirmation).toBeVisible();
      expect(api.deleteAttribute).toHaveBeenCalledTimes(1);
      expectAttributeCount(parent, 1);

      const failure = new Error('Deletion unavailable');
      await act(async () => firstAttempt.reject(failure));
      await waitFor(() => expect(onConsoleError).toHaveBeenCalledWith(failure));
      expect(Message.error).toHaveBeenCalledWith('ontology.errors.withMessage');
      expect(confirmation).toBeVisible();
      expect(cancelButton).toBeEnabled();
      expect(deleteButton).not.toHaveClass('arco-btn-loading');
      expectAttributeCount(parent, 1);
      expectEditorFields(parent, { displayName: 'Unsaved customer' });
      expectParentBlocked(parent);

      fireEvent.click(deleteButton);
      await waitFor(() => expect(cancelButton).toBeDisabled());
      expect(api.deleteAttribute).toHaveBeenNthCalledWith(2, { objectId: 'customer', attributeId: 'customer_id' });
      expect(deleteButton).toHaveClass('arco-btn-loading');
      await act(async () => retry.resolve());
      await waitFor(() => expect(confirmation).not.toBeInTheDocument());
      expectAttributeCount(parent, 0);
      expect(within(parent).getByText('ontology.objectBuilder.emptyAttributes')).toBeInTheDocument();
      expectEditorFields(parent, { displayName: 'Unsaved customer' });
      expect(within(parent).getByRole('button', { name: 'ontology.objectEditor.close' })).toBeEnabled();
      expect(api.upsertObject).not.toHaveBeenCalled();
    });
  });

  it('validates quality rule expressions and displays execution results', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    snapshot.objects[0].attributes = [createAttribute()];
    snapshot.qualityRules = [
      {
        id: 'customer-id-required',
        objectId: 'customer',
        code: 'customer_id_required',
        name: 'Customer ID required',
        expression: 'customer_id IS NOT NULL',
        severity: 'warning',
        status: 'active',
        updatedAt: Date.now(),
      },
    ];
    vi.mocked(api.runConsistencyCheck).mockResolvedValue({
      isValid: true,
      checkedAt: Date.now(),
      issues: [],
      qualityRuleResults: [
        {
          ruleId: 'customer-id-required',
          ruleCode: 'customer_id_required',
          ruleName: 'Customer ID required',
          objectId: 'customer',
          severity: 'warning',
          status: 'failed',
          referencedAttributes: ['customer_id'],
          evaluatedRows: 3,
          failedRows: 1,
          isTruncated: false,
          assetId: 'customers_asset',
        },
      ],
    });
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    fireEvent.click(await screen.findByText('ontology.list.detail'));
    fireEvent.click(await screen.findByText('ontology.detail.tabs.mapping'));
    fireEvent.click(screen.getByRole('button', { name: 'ontology.editor.addRule' }));

    const dialog = await screen.findByRole('dialog', { name: 'ontology.editor.addRule' });
    fireEvent.change(within(dialog).getByPlaceholderText('ontology.editor.name'), { target: { value: 'Valid customer ID' } });
    const expression = within(dialog).getByPlaceholderText('ontology.editor.expression');
    fireEvent.change(expression, { target: { value: 'missing IS NOT NULL' } });
    expect(within(dialog).getByText('ontology.editor.expressionUnknownAttribute')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'ontology.editor.save' })).toBeDisabled();

    fireEvent.change(expression, { target: { value: 'customer_id IS NOT NULL' } });
    expect(within(dialog).queryByText('ontology.editor.expressionUnknownAttribute')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'ontology.editor.save' })).toBeEnabled();
    await onCloseModal(within(dialog).getByRole('button', { name: 'ontology.reset.cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'ontology.mapping.runQualityRules' }));
    await waitFor(() => expect(api.runConsistencyCheck).toHaveBeenCalledWith({ workspaceId: 'customer_domain' }));
    expect(await screen.findByText('ontology.qualityRuleRun.title')).toBeInTheDocument();
    expect(screen.getByText('ontology.qualityRuleRun.status.failed')).toBeInTheDocument();
  });

  it('shows field-level relation bindings and executes relation traversal', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    snapshot.objects[0].attributes = [createAttribute({ id: 'customer-id', code: 'id', name: 'ID' })];
    snapshot.objects.push({
      id: 'order',
      code: 'order',
      name: 'Order',
      description: 'Order object',
      tier: 3,
      status: 'active',
      sourceAssetIds: [],
      attributes: [createAttribute({ id: 'order-customer-id', code: 'customer_id', name: 'Customer ID' })],
      reviewDecision: 'pending',
      updatedAt: Date.now(),
    });
    snapshot.relations = [
      {
        id: 'customer-orders',
        code: 'customer_orders',
        name: 'Customer Orders',
        fromObjectId: 'customer',
        toObjectId: 'order',
        cardinality: 'one_to_many',
        relationType: 'object_property',
        semanticType: 'association',
        dataBinding: { mode: 'direct', joinKeys: [{ fromAttributeId: 'customer-id', toAttributeId: 'order-customer-id' }] },
        isAcyclic: false,
        reviewDecision: 'approved',
        updatedAt: Date.now(),
      },
    ];
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    fireEvent.click(await screen.findByText('ontology.list.detail'));
    fireEvent.click(await screen.findByText('ontology.detail.tabs.relations'));

    const row = (await screen.findByText('Customer Orders')).closest('tr')!;
    expect(within(row).getByText(/id .* = customer_id/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'ontology.editor.edit' }));
    const editor = await screen.findByRole('dialog', { name: 'ontology.editor.editRelation' });
    expect(within(editor).getByText('ontology.editor.relationBindingMode')).toBeInTheDocument();
    expect(within(editor).getByText('ontology.editor.relationJoinKeys')).toBeInTheDocument();
    const relationTypeSelect = within(editor).getByText('ontology.editor.relationTypeLabel').closest('.arco-form-item')?.querySelector('.arco-select-view');
    fireEvent.click(relationTypeSelect as HTMLElement);
    expect(screen.getAllByText('ontology.editor.relationType.object_property').length).toBeGreaterThan(0);
    expect(screen.queryByText('ontology.editor.relationType.symmetric_property')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.relationType.transitive_property')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.relationType.functional_property')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('ontology.editor.relationType.object_property').at(-1)!);
    const semanticTypeSelect = within(editor).getByText('ontology.editor.semanticTypeLabel').closest('.arco-form-item')?.querySelector('.arco-select-view');
    fireEvent.click(semanticTypeSelect as HTMLElement);
    expect(screen.getAllByText('ontology.editor.semanticType.association').length).toBeGreaterThan(0);
    expect(screen.queryByText('ontology.editor.semanticType.composition')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.semanticType.event')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.semanticType.inheritance')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.semanticType.dependency')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('ontology.editor.semanticType.association').at(-1)!);
    await onCloseModal(within(editor).getByRole('button', { name: 'ontology.reset.cancel' }));

    fireEvent.click(within(row).getByRole('button', { name: 'ontology.runtime.run' }));
    const runner = await screen.findByRole('dialog', { name: 'ontology.relationRuntime.runTitle' });
    fireEvent.change(within(runner).getByRole('textbox'), { target: { value: '{"query":{"id":"customer-1"}}' } });
    fireEvent.click(within(runner).getByRole('button', { name: 'ontology.runtime.run' }));
    await waitFor(() =>
      expect(api.executeRelation).toHaveBeenCalledWith({
        id: 'customer-orders',
        arguments: { query: { id: 'customer-1' } },
      })
    );
    expect(await within(runner).findByText(/rows/)).toBeInTheDocument();
  });

  it('runs logic functions with JSON arguments and displays the result', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    snapshot.logicFunctions = [
      {
        id: 'customer-lookup',
        code: 'customer_lookup',
        name: 'Customer Lookup',
        description: 'Look up customers.',
        runtime: 'typescript',
        objectIds: ['customer'],
        signature: 'customerLookup(query)',
        body: '',
        returnType: 'object[]',
        parameters: [{ name: 'query', type: 'object', required: true }],
        configuration: { builtIn: 'lookup', objectId: 'customer' },
        origin: 'generated',
        status: 'active',
        executionCount: 0,
        updatedAt: Date.now(),
      },
    ];
    snapshot.stats = recalculateOntologyStats(snapshot);
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    fireEvent.click(await screen.findByText('ontology.list.detail'));
    fireEvent.click(await screen.findByText('ontology.detail.tabs.runtime'));
    const functionRow = (await screen.findByText('Customer Lookup')).closest('.rounded') as HTMLElement;
    fireEvent.click(within(functionRow).getByRole('button', { name: 'ontology.runtime.run' }));

    const dialog = await screen.findByRole('dialog', { name: 'ontology.runtime.runTitle' });
    expect(within(dialog).getByRole('textbox')).toHaveValue('{\n  "query": {}\n}');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ontology.runtime.run' }));
    await waitFor(() =>
      expect(api.executeLogicFunction).toHaveBeenCalledWith({
        id: 'customer-lookup',
        arguments: { query: {} },
      })
    );
    expect(await within(dialog).findByText(/customer-1/)).toBeInTheDocument();
  });

  it('edits complete action contracts and runs actions with JSON arguments', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    snapshot.actions = [
      {
        id: 'notify-customer',
        code: 'notify_customer',
        name: 'Notify Customer',
        executor: 'notification',
        objectIds: ['customer'],
        description: 'Notify an account owner.',
        configuration: { title: 'Customer', message: 'Customer {{customerId}} requires attention.' },
        parameters: [{ name: 'customerId', type: 'string', required: true }],
        outputSchema: [{ name: 'delivered', type: 'boolean' }],
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: Date.now(),
      },
    ];
    snapshot.stats = recalculateOntologyStats(snapshot);
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    fireEvent.click(await screen.findByText('ontology.list.detail'));
    fireEvent.click(await screen.findByText('ontology.detail.tabs.runtime'));
    const actionRow = (await screen.findByText('Notify Customer')).closest('.rounded') as HTMLElement;
    fireEvent.click(within(actionRow).getByRole('button', { name: 'ontology.editor.edit' }));
    const editor = await screen.findByRole('dialog', { name: 'ontology.runtime.editAction' });
    expect(within(editor).getByText('ontology.runtime.parametersJson')).toBeInTheDocument();
    expect(within(editor).getByText('ontology.runtime.outputSchemaJson')).toBeInTheDocument();
    await onCloseModal(within(editor).getByRole('button', { name: 'ontology.reset.cancel' }));

    fireEvent.click(within(actionRow).getByRole('button', { name: 'ontology.runtime.run' }));
    const runner = await screen.findByRole('dialog', { name: 'ontology.runtime.runTitle' });
    fireEvent.change(within(runner).getByRole('textbox'), { target: { value: '{"customerId":"customer-1"}' } });
    fireEvent.click(within(runner).getByRole('button', { name: 'ontology.runtime.run' }));
    await waitFor(() =>
      expect(api.executeAction).toHaveBeenCalledWith({
        id: 'notify-customer',
        arguments: { customerId: 'customer-1' },
      })
    );
    expect(await within(runner).findByText(/delivered/)).toBeInTheDocument();
  });

  it('opens the active ontology detail and exposes object modeling controls', async () => {
    const api = createApi();
    const { container } = render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    expect(container.querySelector('.lucide-circle-x')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    const ontologyCard = (await screen.findAllByText('Customer Domain'))[0].closest('[role="button"]');
    expect(ontologyCard).not.toBeNull();
    const statisticValues = ontologyCard?.querySelectorAll('.ontology-resource-stat-value');
    expect(statisticValues).toHaveLength(4);
    statisticValues?.forEach((value) => expect(value).toHaveClass('!text-[var(--color-text-1)]'));
    fireEvent.click(ontologyCard as HTMLElement);

    await waitFor(() => expect(api.selectWorkbench).toHaveBeenCalledWith({ workspaceId: 'customer_domain' }));
    expect(await screen.findByText('ontology.detail.back')).toBeInTheDocument();
    expect(screen.queryByText('ontology.generate.action')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.review.approveAll')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.detail.tabs.objects'));
    expect(await screen.findByText('ontology.objectBuilder.objectState.draft')).toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.tierLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.reviewDecision.pending')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('ontology.editor.addObject'));
    expect(await screen.findByText('ontology.objectBuilder.template')).toBeInTheDocument();
    expect(screen.getByText('ontology.objectBuilder.document')).toBeInTheDocument();
    expect(screen.getByText('ontology.objectBuilder.asset')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.manual'));
    expect(await screen.findByText('ontology.objectBuilder.manualWorkspaceTitle')).toBeInTheDocument();
    expect(screen.queryByText('Customer')).not.toBeInTheDocument();
    expect(screen.getByText('ontology.generate.emptyObjects')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'ontology.editor.addObject' })[0]);
    expect(await screen.findByText('ontology.editor.displayName')).toBeInTheDocument();
    expect(screen.getByText('ontology.editor.englishName')).toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.tierLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.editor.statusLabel')).not.toBeInTheDocument();
  });

  it('opens the ontology creation form with labeled and empty fields every time', async () => {
    const api = createApi();
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    fireEvent.click(await screen.findByText('ontology.list.newOntology'));

    expect(await screen.findByText('ontology.list.nameLabel')).toBeInTheDocument();
    expect(screen.getByText('ontology.list.codeLabel')).toBeInTheDocument();
    expect(screen.getByText('ontology.list.descriptionLabel')).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText('ontology.list.namePlaceholder');
    const codeInput = screen.getByPlaceholderText('ontology.list.codePlaceholder');
    const descriptionInput = screen.getByPlaceholderText('ontology.list.descriptionPlaceholder');
    expect(nameInput).toHaveValue('');
    expect(codeInput).toHaveValue('');
    expect(descriptionInput).toHaveValue('');

    fireEvent.change(nameInput, { target: { value: 'Temporary ontology' } });
    fireEvent.change(codeInput, { target: { value: 'temporary_ontology' } });
    fireEvent.click(screen.getByText('ontology.reset.cancel'));
    fireEvent.click(screen.getByText('ontology.list.newOntology'));

    expect(screen.getByPlaceholderText('ontology.list.namePlaceholder')).toHaveValue('');
    expect(screen.getByPlaceholderText('ontology.list.codePlaceholder')).toHaveValue('');
    expect(screen.getByPlaceholderText('ontology.list.descriptionPlaceholder')).toHaveValue('');
  });

  it('opens the Agent creation form with an empty name every time', async () => {
    const api = createApi();
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.agent.title')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'ontology.agentManage.newAgent' }));

    const nameInput = screen.getByPlaceholderText('ontology.agent.namePlaceholder');
    expect(nameInput).toHaveValue('');
    expect(screen.getAllByText('ontology.agentManage.servicePlaceholder').length).toBeGreaterThan(0);

    fireEvent.change(nameInput, { target: { value: 'Temporary Agent' } });
    fireEvent.click(screen.getByText('ontology.reset.cancel'));
    fireEvent.click(screen.getByRole('button', { name: 'ontology.agentManage.newAgent' }));

    expect(screen.getByPlaceholderText('ontology.agent.namePlaceholder')).toHaveValue('');
    expect(screen.getAllByText('ontology.agentManage.servicePlaceholder').length).toBeGreaterThan(0);
  });

  it('creates an Agent bound to the selected published ontology service', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    vi.mocked(api.createAgentBlueprint).mockResolvedValue({ snapshot });
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.agent.title')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'ontology.agentManage.newAgent' }));
    fireEvent.change(screen.getByPlaceholderText('ontology.agent.namePlaceholder'), {
      target: { value: 'Versioned Agent' },
    });

    const createButton = screen.getByText('ontology.agentManage.create').closest('button');
    expect(createButton).toBeDisabled();
    const serviceSelect = screen.getAllByText('ontology.agentManage.servicePlaceholder')[0].closest('.arco-select-view');
    fireEvent.click(serviceSelect as HTMLElement);
    fireEvent.click(await screen.findByText('Customer Domain · v2 · ontology.agentManage.servingVersion'));
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton as HTMLElement);

    await waitFor(() =>
      expect(api.createAgentBlueprint).toHaveBeenCalledWith({
        name: 'Versioned Agent',
        ontologyVersionId: 'version-2',
        workspaceId: 'customer_domain',
        promptTemplate: 'ontology.agent.defaultPrompt',
      })
    );
  });

  it('shows published services and Agents from every ontology workbench', async () => {
    const api = createApi();
    const primarySnapshot = await api.getWorkbench();
    primarySnapshot.agentBlueprints = [
      {
        id: 'customer-agent',
        name: 'Customer Agent',
        status: 'registered',
        ontologyVersionId: 'version-1',
        entityIds: ['customer'],
        promptTemplate: 'Customer prompt',
        toolManifest: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    const secondarySnapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), {
      workspaceId: 'user_domain',
      title: 'User Domain',
    });
    secondarySnapshot.objects = [{ ...primarySnapshot.objects[0], id: 'user', name: 'User' }];
    secondarySnapshot.publishedVersions = [
      {
        ...primarySnapshot.publishedVersions[0],
        id: 'user-version-1',
        version: 'v1',
        snapshot: {
          ...primarySnapshot.publishedVersions[0].snapshot,
          objects: secondarySnapshot.objects,
        },
      },
      {
        ...primarySnapshot.publishedVersions[0],
        id: 'user-version-2',
        version: 'v2',
        status: 'submitted',
        isActive: false,
        createdAt: Date.now() + 1_000,
        snapshot: {
          ...primarySnapshot.publishedVersions[0].snapshot,
          objects: secondarySnapshot.objects,
        },
      },
    ];
    secondarySnapshot.agentBlueprints = [
      {
        id: 'user-agent',
        name: 'User Agent',
        status: 'registered',
        ontologyVersionId: 'user-version-1',
        entityIds: ['user'],
        promptTemplate: 'User prompt',
        toolManifest: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    secondarySnapshot.stats = recalculateOntologyStats(secondarySnapshot);
    vi.mocked(api.listWorkbenches).mockResolvedValue({
      activeWorkspaceId: primarySnapshot.workspaceId,
      items: [summarizeOntologyWorkbenchSnapshot(primarySnapshot), summarizeOntologyWorkbenchSnapshot(secondarySnapshot)],
    });
    vi.mocked(api.getWorkbench).mockImplementation(async (input) => (input?.workspaceId === secondarySnapshot.workspaceId ? secondarySnapshot : primarySnapshot));
    vi.mocked(api.selectWorkbench).mockImplementation(async ({ workspaceId }) => (workspaceId === secondarySnapshot.workspaceId ? secondarySnapshot : primarySnapshot));
    vi.mocked(api.approvePublishedVersion).mockResolvedValue(secondarySnapshot);
    vi.mocked(api.rejectPublishedVersion).mockResolvedValue(secondarySnapshot);
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.publish.title')[0]);
    expect(await screen.findByText('Customer Domain')).toBeInTheDocument();
    const userPublishCard = screen.getByText('User Domain').closest('[role="button"]');
    expect(userPublishCard).not.toBeNull();
    fireEvent.click(userPublishCard as HTMLElement);
    await waitFor(() => expect(api.selectWorkbench).toHaveBeenCalledWith({ workspaceId: 'user_domain' }));
    expect(await screen.findByText('ontology.publishConsole.back')).toBeInTheDocument();
    fireEvent.click(screen.getByText('v2'));
    fireEvent.click(screen.getByText('ontology.publishConsole.approve'));
    await waitFor(() =>
      expect(api.approvePublishedVersion).toHaveBeenCalledWith({
        versionId: 'user-version-2',
        workspaceId: 'user_domain',
        reviewerId: 'local-reviewer',
      })
    );
    fireEvent.click(screen.getByText('ontology.publishConsole.reject'));
    fireEvent.change(screen.getByPlaceholderText('ontology.publishConsole.rejectReasonPlaceholder'), {
      target: { value: 'Needs revision' },
    });
    fireEvent.click(screen.getAllByText('ontology.publishConsole.reject').at(-1) as HTMLElement);
    await waitFor(() =>
      expect(api.rejectPublishedVersion).toHaveBeenCalledWith({
        versionId: 'user-version-2',
        workspaceId: 'user_domain',
        reviewerId: 'local-reviewer',
        reason: 'Needs revision',
      })
    );

    fireEvent.click(screen.getAllByText('ontology.console.views.agent.title')[0]);
    expect(await screen.findByText('Customer Agent')).toBeInTheDocument();
    expect(screen.getByText('User Agent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ontology.agentManage.newAgent' }));
    const serviceSelect = screen.getAllByText('ontology.agentManage.servicePlaceholder')[0].closest('.arco-select-view');
    fireEvent.click(serviceSelect as HTMLElement);
    expect(await screen.findByText('User Domain · v1 · ontology.agentManage.servingVersion')).toBeInTheDocument();
  });

  it('keeps unpublished ontologies available after another ontology has been published', async () => {
    const api = createApi();
    const publishedSnapshot = await api.getWorkbench();
    const unpublishedSnapshot = createDefaultOntologyWorkbenchSnapshot(Date.now(), {
      workspaceId: 'user_domain',
      title: 'User Domain',
    });
    unpublishedSnapshot.objects = [{ ...publishedSnapshot.objects[0], id: 'user', name: 'User' }];
    unpublishedSnapshot.stats = recalculateOntologyStats(unpublishedSnapshot);
    vi.mocked(api.listWorkbenches).mockResolvedValue({
      activeWorkspaceId: publishedSnapshot.workspaceId,
      items: [summarizeOntologyWorkbenchSnapshot(publishedSnapshot), summarizeOntologyWorkbenchSnapshot(unpublishedSnapshot)],
    });
    vi.mocked(api.getWorkbench).mockImplementation(async (input) => (input?.workspaceId === unpublishedSnapshot.workspaceId ? unpublishedSnapshot : publishedSnapshot));
    vi.mocked(api.selectWorkbench).mockResolvedValue(unpublishedSnapshot);
    vi.mocked(api.publishCurrentDraft).mockResolvedValue({
      snapshot: unpublishedSnapshot,
      version: {
        ...publishedSnapshot.publishedVersions[0],
        id: 'user-version-1',
        version: 'v1',
        status: 'submitted',
        isActive: false,
      },
    });
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.publish.title')[0]);

    expect(await screen.findByText('User Domain')).toBeInTheDocument();
    expect(screen.getAllByText('ontology.publishConsole.notPublished').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('User Domain').closest('[role="button"]') as HTMLElement);
    await waitFor(() => expect(api.selectWorkbench).toHaveBeenCalledWith({ workspaceId: 'user_domain' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ontology.publishConsole.createVersion' }));

    await waitFor(() => expect(api.publishCurrentDraft).toHaveBeenCalledWith({ workspaceId: 'user_domain' }));
  });

  it('opens the selected ontology publish flow without a global current marker', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    snapshot.publishedVersions = [];
    snapshot.stats = recalculateOntologyStats(snapshot);
    vi.mocked(api.listWorkbenches).mockResolvedValue({
      activeWorkspaceId: snapshot.workspaceId,
      items: [summarizeOntologyWorkbenchSnapshot(snapshot)],
    });
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    expect(screen.queryByText('ontology.list.active')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('ontology.list.detail'));
    fireEvent.click(await screen.findByRole('button', { name: 'ontology.detail.publish' }));

    expect(await screen.findByText('ontology.publishConsole.back')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ontology.publishConsole.createVersion' })).toBeInTheDocument();
  });

  it('does not display scene reference counts on Agent cards or details', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    snapshot.agentBlueprints = [
      {
        id: 'agent-1',
        name: 'Customer Agent',
        status: 'registered',
        ontologyVersionId: 'version-1',
        registeredAssistantId: 'customer-agent',
        entityIds: ['customer'],
        promptTemplate: 'Use the customer ontology.',
        toolManifest: [
          {
            name: 'ontology.lookup',
            description: 'Look up ontology objects.',
            category: 'ontology',
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.agent.title')[0]);
    const agentName = await screen.findByText('Customer Agent');
    expect(screen.queryByText('ontology.agentManage.referenceCount')).not.toBeInTheDocument();
    const agentCard = agentName.closest('[role="button"]') as HTMLElement;
    expect(agentCard).toHaveTextContent('ontology.agentManage.boundService');

    fireEvent.click(agentCard);
    expect((await screen.findAllByText('Use the customer ontology.')).length).toBeGreaterThan(1);
    expect(screen.queryByText('ontology.agentManage.references')).not.toBeInTheDocument();
    expect(screen.getByText('ontology.agentManage.ontologyService')).toBeInTheDocument();
  });

  it('does not display counters beside workbench navigation items', async () => {
    const api = createApi();
    render(<OntologyWorkbench api={api} />);

    const publishLabel = (await screen.findAllByText('ontology.console.views.publish.title'))[0];
    expect(publishLabel.closest('button')).toHaveTextContent('ontology.console.views.publish.title');
    expect(publishLabel.closest('button')).not.toHaveTextContent(/\d/);
  });

  it('merges ontology publishing and service capabilities into one page', async () => {
    const api = createApi();
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    await screen.findByText('ontology.list.title');
    expect(document.querySelector('[class*="linear-gradient"]')).toBeNull();

    fireEvent.click(screen.getAllByText('ontology.console.views.publish.title')[0]);
    await screen.findByText('ontology.publishConsole.environmentTitle');
    expect(document.querySelector('[class*="linear-gradient"]')).toBeNull();
    expect(screen.queryByText('ontology.console.views.service.title')).not.toBeInTheDocument();
    const serviceCard = screen.getByText('Customer Domain').closest('[role="button"]');
    fireEvent.click(serviceCard as HTMLElement);
    expect(await screen.findByText('ontology.mcpService.detailsTitle')).toBeInTheDocument();
    expect(screen.queryByText('ontology.mcpService.toolDistribution')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.mcpService.tabs.docs')).not.toBeInTheDocument();
    expect(screen.queryByText('ontology.mcpService.managedServers')).not.toBeInTheDocument();
  });

  it('offers all four object construction workflows', async () => {
    const api = createApi();
    const snapshot = await api.getWorkbench();
    vi.mocked(api.pickBuildFiles).mockResolvedValue(['/tmp/template.json']);
    vi.mocked(api.importFiles).mockResolvedValue({
      snapshot,
      files: [{ id: 'template_asset', name: 'template.json', path: '/tmp/template.json', sizeBytes: 128, extension: '.json' }],
    });
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    fireEvent.click(await screen.findByText('ontology.list.detail'));
    fireEvent.click(await screen.findByText('ontology.detail.tabs.objects'));
    fireEvent.click(screen.getByText('ontology.editor.addObject'));

    expect(await screen.findByText('ontology.objectBuilder.manual')).toBeInTheDocument();
    expect(screen.getByText('ontology.objectBuilder.template')).toBeInTheDocument();
    expect(screen.getByText('ontology.objectBuilder.document')).toBeInTheDocument();
    expect(screen.getByText('ontology.objectBuilder.asset')).toBeInTheDocument();
    expect(screen.getByText('ontology.objectBuilder.manual').closest('[role="menu"]')).toHaveClass('grid', 'grid-cols-2');

    fireEvent.click(screen.getByText('ontology.objectBuilder.template'));
    expect(await screen.findByText('ontology.objectBuilder.templateStepTitle')).toBeInTheDocument();
    const currentStepIndicator = document.querySelector('[aria-current="step"]');
    expect(currentStepIndicator).toHaveTextContent('1');
    expect(currentStepIndicator).toHaveClass('bg-[rgb(var(--primary-1))]', 'text-[rgb(var(--primary-6))]');
    fireEvent.click(screen.getByText('ontology.objectBuilder.chooseTemplateFile'));
    await waitFor(() => expect(api.pickBuildFiles).toHaveBeenCalledWith('template'));
    expect(api.importFiles).toHaveBeenCalledWith({
      filePaths: ['/tmp/template.json'],
      purpose: 'template',
      workspaceId: 'customer_domain',
    });
    expect(await screen.findByText('ontology.objectBuilder.templateReadyTitle')).toBeInTheDocument();
    expect(api.generateDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('ontology.objectBuilder.confirmTemplate'));
    await waitFor(() =>
      expect(api.generateDraft).toHaveBeenCalledWith({
        assetIds: ['template_asset'],
        mode: 'merge',
        workspaceId: 'customer_domain',
      })
    );
    expect(await screen.findByText('ontology.objectBuilder.reviewStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.review.approveAll'));
    expect(await screen.findByText('ontology.objectBuilder.hydrateStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.publishConsole.check'));
    expect(await screen.findByText('ontology.publish.valid')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.finish'));

    fireEvent.click(screen.getByText('ontology.editor.addObject'));
    fireEvent.click(await screen.findByText('ontology.objectBuilder.document'));
    expect(await screen.findByText('ontology.objectBuilder.documentStepTitle')).toBeInTheDocument();
    expect(screen.getByText('operations.md')).toBeInTheDocument();
    fireEvent.click(screen.getByText('operations.md'));
    fireEvent.change(screen.getByPlaceholderText('ontology.documentBuilder.documentGoalPlaceholder'), {
      target: { value: 'Model operational documents' },
    });
    fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
    expect(await screen.findByText('ontology.objectBuilder.extractStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
    await waitFor(() =>
      expect(api.generateDraft).toHaveBeenCalledWith({
        assetIds: ['operations_document'],
        documentAssetIds: ['operations_document'],
        businessGoal: 'Model operational documents',
        mode: 'merge',
        workspaceId: 'customer_domain',
      })
    );
    expect(await screen.findByText('ontology.objectBuilder.mappingStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
    expect(await screen.findByText('ontology.objectBuilder.confirmStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
    expect(await screen.findByText('ontology.objectBuilder.reviewStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.review.approveAll'));
    expect(await screen.findByText('ontology.objectBuilder.hydrateStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.finish'));

    fireEvent.click(screen.getByText('ontology.editor.addObject'));
    fireEvent.click(await screen.findByText('ontology.objectBuilder.asset'));
    expect(await screen.findByText('ontology.objectBuilder.businessStepTitle')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Model customer data' } });
    fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
    expect(await screen.findByText('ontology.objectBuilder.assetStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('customers'));
    fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
    expect(await screen.findByText('ontology.objectBuilder.documentStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.skipDocuments'));
    expect(await screen.findByText('ontology.objectBuilder.extractStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
    await waitFor(() =>
      expect(api.generateDraft).toHaveBeenCalledWith({
        assetIds: ['customers_asset'],
        documentAssetIds: [],
        businessGoal: 'Model customer data',
        mode: 'merge',
        workspaceId: 'customer_domain',
      })
    );
    expect(await screen.findByText('ontology.objectBuilder.reviewStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.review.approveAll'));
    expect(await screen.findByText('ontology.objectBuilder.hydrateStepTitle')).toBeInTheDocument();
  });

  describe('document builder', () => {
    it.each(['en-US', 'zh-CN'])('shows format, limits, parsing and model hints in %s', async (lng) => {
      const i18n = createInstance();
      await i18n.init({ lng, resources: { 'en-US': { translation: { ontology: ontologyEn } }, 'zh-CN': { translation: { ontology: ontologyZh } } }, interpolation: { escapeValue: false } });
      translate.mockImplementation((key, options) => i18n.t(key, options));
      await openGuidedBuilder(createApi());
      const formats = screen.getByText(lng === 'en-US' ? /^Supported formats:/ : /^支持格式：/);
      expect(formats).toHaveTextContent('MD / MARKDOWN / TXT / PDF / DOC / DOCX / PPT / PPTX / CSV / XLS / XLSX');
      expect(screen.getByText(lng === 'en-US' ? /^Up to 10 files/ : /^每批最多 10 个文件/)).toHaveTextContent('50 MiB');
      expect(screen.getByText(lng === 'en-US' ? /^Up to 10 files/ : /^每批最多 10 个文件/)).toHaveTextContent('100 MiB');
      expect(screen.getByText(lng === 'en-US' ? /OCR is not supported/ : /不支持 OCR/)).toHaveTextContent('LibreOffice');
      expect(screen.getByText(lng === 'en-US' ? /currently configured model/ : /当前配置的模型/)).toHaveTextContent('60000');
      const goal = screen.getByPlaceholderText(i18n.t('ontology.documentBuilder.documentGoalPlaceholder'));
      expect(goal).toHaveAttribute('maxlength', '2000');
      fireEvent.click(screen.getByText('operations.md'));
      expect(screen.getByRole('button', { name: i18n.t('ontology.objectBuilder.next') })).toBeDisabled();
      fireEvent.change(goal, { target: { value: 'Model operations' } });
      fireEvent.click(screen.getByRole('button', { name: i18n.t('ontology.objectBuilder.next') }));
      expect(await screen.findByText(i18n.t('ontology.objectBuilder.extractStepTitle'))).toBeInTheDocument();
      expect(screen.getByText(lng === 'en-US' ? /currently configured model/ : /当前配置的模型/)).toHaveTextContent('60000');
    });

    it('selects imported CSV and Excel documents and excludes a deselected import from extraction', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      const csv = { ...snapshot.assets[1], id: 'csv_document', name: 'orders.csv', path: '/tmp/orders.csv', kind: 'table' as const };
      const excel = { ...csv, id: 'excel_document', name: 'sales.xlsx', path: '/tmp/sales.xlsx' };
      snapshot.assets.push(excel);
      vi.mocked(api.pickBuildFiles).mockResolvedValue(['/tmp/orders.csv']);
      vi.mocked(api.importFiles).mockResolvedValue({
        snapshot: { ...snapshot, assets: [...snapshot.assets, csv] },
        files: [{ id: csv.id, name: csv.name, path: csv.path, sizeBytes: 100, extension: '.csv' }],
      });
      await openGuidedBuilder(api);
      expect(screen.getByText('sales.xlsx')).toBeInTheDocument();
      fireEvent.click(screen.getByText('ontology.objectBuilder.chooseDocumentFiles'));
      const csvLabel = (await screen.findByText('orders.csv')).closest('label') as HTMLElement;
      expect(within(csvLabel).getByRole('checkbox')).toBeChecked();
      expect(api.importFiles).toHaveBeenCalledWith({ filePaths: ['/tmp/orders.csv'], purpose: 'document', workspaceId: 'customer_domain' });
      fireEvent.click(within(csvLabel).getByRole('checkbox'));
      expect(within(csvLabel).getByRole('checkbox')).not.toBeChecked();
      fireEvent.click(screen.getByText('sales.xlsx'));
      onSelectDocumentForExtraction();
      fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
      await waitFor(() =>
        expect(api.generateDraft).toHaveBeenCalledWith({
          assetIds: ['excel_document', 'operations_document'],
          documentAssetIds: ['excel_document', 'operations_document'],
          businessGoal: 'Model operational documents',
          mode: 'merge',
          workspaceId: 'customer_domain',
        })
      );
      expect(await screen.findByText('ontology.objectBuilder.mappingStepTitle')).toBeInTheDocument();
    });

    it('sends explicit document IDs in mixed asset builds and deduplicates shared sources', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.assets.push({ ...snapshot.assets[1], id: 'local_csv', kind: 'table', name: 'orders.csv', path: '/tmp/orders.csv' });
      await openGuidedBuilder(api, 'asset');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Model mixed sources' } });
      fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
      fireEvent.click(screen.getByText('orders.csv'));
      fireEvent.click(screen.getByText('customers'));
      fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
      fireEvent.click(screen.getByText('orders.csv'));
      fireEvent.click(screen.getByText('operations.md'));
      fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
      fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
      await waitFor(() =>
        expect(api.generateDraft).toHaveBeenCalledWith({
          assetIds: ['local_csv', 'customers_asset', 'operations_document'],
          documentAssetIds: ['local_csv', 'operations_document'],
          businessGoal: 'Model mixed sources',
          mode: 'merge',
          workspaceId: 'customer_domain',
        })
      );
    });

    it('excludes remote, unsupported and template assets from document candidates', async () => {
      const api = createApi();
      const snapshot = await api.getWorkbench();
      snapshot.assets.push(
        { ...snapshot.assets[1], id: 'remote', name: 'remote.md', path: 'https://example.com/remote.md' },
        { ...snapshot.assets[1], id: 'unsupported', name: 'unsupported.json', path: '/tmp/unsupported.json' },
        { ...snapshot.assets[1], id: 'template', name: 'template.xlsx', path: '/tmp/template.xlsx', metadata: { ontologyTemplate: {} } },
        { ...snapshot.assets[1], id: 'connector', name: 'connector.md', path: '/tmp/connector.md', metadata: { connectorId: 'connector' } }
      );
      await openGuidedBuilder(api);
      for (const name of ['remote.md', 'unsupported.json', 'template.xlsx', 'connector.md', 'customers']) expect(screen.queryByText(name)).not.toBeInTheDocument();
      expect(screen.getByText('operations.md')).toBeInTheDocument();
    });

    it('blocks duplicate picker/import and navigation, preserving selection and goal after import failure', async () => {
      const api = createApi();
      const picker = createDeferred<string[]>();
      const imported = createDeferred<Awaited<ReturnType<IOntologyWorkbenchApi['importFiles']>>>();
      vi.mocked(api.pickBuildFiles).mockReturnValueOnce(picker.promise);
      vi.mocked(api.importFiles).mockReturnValueOnce(imported.promise);
      await openGuidedBuilder(api);
      fireEvent.click(screen.getByText('operations.md'));
      const goal = screen.getByPlaceholderText('ontology.documentBuilder.documentGoalPlaceholder');
      fireEvent.change(goal, { target: { value: 'Keep this goal' } });
      const choose = screen.getByRole('button', { name: 'ontology.objectBuilder.chooseDocumentFiles' });
      fireEvent.click(choose);
      fireEvent.click(choose);
      expect(api.pickBuildFiles).toHaveBeenCalledTimes(1);
      expect(choose).toBeDisabled();
      expect(goal).toBeDisabled();
      expect(screen.getByRole('button', { name: 'ontology.objectBuilder.backToObjects' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'ontology.objectBuilder.next' })).toBeDisabled();
      expect(screen.getByRole('checkbox')).toBeDisabled();
      await act(async () => picker.resolve(['/tmp/missing.pdf']));
      expect(api.importFiles).toHaveBeenCalledTimes(1);
      await act(async () => imported.reject(new Error('ontology.documentErrors.fileUnavailable')));
      expect(Message.error).toHaveBeenCalledWith('ontology.documentErrors.fileUnavailable');
      expect(goal).toHaveValue('Keep this goal');
      expect(goal).toBeEnabled();
      expect(screen.getByRole('checkbox')).toBeChecked();
      expect(screen.getByText('ontology.objectBuilder.documentStepTitle')).toBeInTheDocument();
      expect(api.generateDraft).not.toHaveBeenCalled();
    });

    it('keeps the extraction step while pending or failed and supports retry without losing inputs', async () => {
      const api = createApi();
      const pending = createDeferred<Awaited<ReturnType<IOntologyWorkbenchApi['generateDraft']>>>();
      vi.mocked(api.generateDraft).mockReturnValueOnce(pending.promise);
      await openGuidedBuilder(api);
      onSelectDocumentForExtraction();
      const extract = screen.getByRole('button', { name: 'ontology.objectBuilder.startExtraction' });
      fireEvent.click(extract);
      fireEvent.click(extract);
      expect(api.generateDraft).toHaveBeenCalledTimes(1);
      expect(extract).toBeDisabled();
      expect(screen.getByRole('button', { name: 'ontology.objectBuilder.previous' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'ontology.objectBuilder.backToObjects' })).toBeDisabled();
      expect(screen.queryByText('ontology.objectBuilder.mappingStepTitle')).not.toBeInTheDocument();
      await act(async () => pending.reject(new Error('ontology.documentErrors.modelTimeout')));
      expect(Message.error).toHaveBeenCalledWith('ontology.documentErrors.modelTimeout');
      expect(screen.getByText('ontology.objectBuilder.extractStepTitle')).toBeInTheDocument();
      fireEvent.click(screen.getByText('ontology.objectBuilder.previous'));
      expect(screen.getByPlaceholderText('ontology.documentBuilder.documentGoalPlaceholder')).toHaveValue('Model operational documents');
      expect(screen.getByRole('checkbox')).toBeChecked();
      fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
      fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
      expect(await screen.findByText('ontology.objectBuilder.mappingStepTitle')).toBeInTheDocument();
      expect(api.generateDraft).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.generateDraft).mock.calls[0]).toEqual(vi.mocked(api.generateDraft).mock.calls[1]);
    });

    it('translates only exact allowlisted document error keys', async () => {
      const api = createApi();
      const i18n = createInstance();
      await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: ontologyZh } } } });
      translate.mockImplementation((key, options) => (key.startsWith('ontology.documentErrors.') ? i18n.t(key, options) : key));
      await openGuidedBuilder(api);
      onSelectDocumentForExtraction();
      for (const key of ONTOLOGY_DOCUMENT_ERROR_KEYS) {
        vi.mocked(api.generateDraft).mockRejectedValueOnce(new Error(`ontology.documentErrors.${key}`));
        fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
        await waitFor(() => expect(Message.error).toHaveBeenLastCalledWith(i18n.t(`ontology.documentErrors.${key}`)));
        expect(screen.getByText('ontology.objectBuilder.extractStepTitle')).toBeInTheDocument();
      }
      for (const message of ['ontology.documentErrors.modelFailed.extra', 'ontology.documentErrors.unknown', 'ontology.header.title']) {
        translate.mockClear();
        vi.mocked(api.generateDraft).mockRejectedValueOnce(new Error(message));
        fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
        await waitFor(() => expect(translate).toHaveBeenCalledWith('ontology.errors.withMessage', { message }));
        expect(translate.mock.calls.some(([key]) => key === message)).toBe(false);
      }
    });

    it.each(['import', 'generate'] as const)('does not apply a late %s result to a different workspace', async (operation) => {
      const api = createApi();
      const primary = await api.getWorkbench();
      const secondary = createDefaultOntologyWorkbenchSnapshot(Date.now(), { workspaceId: 'user_domain', title: 'User Domain' });
      secondary.objects = [{ ...primary.objects[0], id: 'user', name: 'User' }];
      secondary.stats = recalculateOntologyStats(secondary);
      vi.mocked(api.listWorkbenches).mockResolvedValue({ activeWorkspaceId: primary.workspaceId, items: [summarizeOntologyWorkbenchSnapshot(primary), summarizeOntologyWorkbenchSnapshot(secondary)] });
      vi.mocked(api.getWorkbench).mockImplementation(async (input) => (input?.workspaceId === secondary.workspaceId ? secondary : primary));
      vi.mocked(api.selectWorkbench).mockImplementation(async ({ workspaceId }) => (workspaceId === secondary.workspaceId ? secondary : primary));
      const picker = createDeferred<string[]>();
      const generated = createDeferred<typeof primary>();
      vi.mocked(api.pickBuildFiles).mockReturnValueOnce(picker.promise);
      vi.mocked(api.generateDraft).mockReturnValueOnce(generated.promise);
      vi.mocked(api.importFiles).mockResolvedValue({ snapshot: primary, files: [{ id: 'late_doc', name: 'late.md', path: '/tmp/late.md', sizeBytes: 20, extension: '.md' }] });
      await openGuidedBuilder(api);
      if (operation === 'import') {
        fireEvent.click(screen.getByText('ontology.objectBuilder.chooseDocumentFiles'));
      } else {
        onSelectDocumentForExtraction();
        fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
      }
      fireEvent.click(screen.getAllByText('ontology.console.views.publish.title')[0]);
      fireEvent.click((await screen.findByText('User Domain')).closest('[role="button"]') as HTMLElement);
      await waitFor(() => expect(api.selectWorkbench).toHaveBeenCalledWith({ workspaceId: 'user_domain' }));
      fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
      fireEvent.click(within((await screen.findByText('User Domain')).closest('[role="button"]') as HTMLElement).getByText('ontology.list.detail'));
      await screen.findByText('ontology.detail.tabs.objects');
      fireEvent.click(screen.getByText('ontology.detail.tabs.objects'));
      if (operation === 'import') {
        await act(async () => picker.resolve(['/tmp/late.md']));
        expect(api.importFiles).toHaveBeenCalledWith({ filePaths: ['/tmp/late.md'], purpose: 'document', workspaceId: 'customer_domain' });
      } else {
        await act(async () => generated.resolve(primary));
        expect(api.generateDraft).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'customer_domain' }));
      }
      expect(screen.getByText('User Domain')).toBeInTheDocument();
      expect(screen.queryByText('ontology.objectBuilder.mappingStepTitle')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('ontology.editor.addObject'));
      fireEvent.click(await screen.findByText('ontology.objectBuilder.document'));
      expect(await screen.findByText('ontology.objectBuilder.documentStepTitle')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('ontology.documentBuilder.documentGoalPlaceholder')).toHaveValue('');
      expect(screen.queryByText('operations.md')).not.toBeInTheDocument();
    });
  });

  it('runs the complete manual modeling workflow', async () => {
    const api = createApi();
    render(<OntologyWorkbench api={api} />);

    await screen.findAllByText('ontology.console.views.connections.title');
    fireEvent.click(screen.getAllByText('ontology.console.views.ontology.title')[0]);
    fireEvent.click(await screen.findByText('ontology.list.detail'));
    fireEvent.click(await screen.findByText('ontology.detail.tabs.objects'));
    fireEvent.click(screen.getByText('ontology.editor.addObject'));
    fireEvent.click(await screen.findByText('ontology.objectBuilder.manual'));

    const submitButton = await screen.findByText('ontology.objectBuilder.submitReview');
    expect(submitButton.closest('button')).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'ontology.editor.addObject' })[0]);
    const objectDialog = await screen.findByRole('dialog', { name: 'ontology.editor.addObject' });
    changeEditorFields(objectDialog, { displayName: 'Manual Customer', englishName: 'manual_customer' });
    fireEvent.click(within(objectDialog).getByRole('button', { name: 'ontology.editor.save' }));
    await waitFor(() => expect(api.upsertObject).toHaveBeenCalled());

    fireEvent.click(await screen.findByText('ontology.editor.addAttributeShort'));
    const attributeDialog = await screen.findByRole('dialog', { name: 'ontology.editor.addAttribute' });
    changeEditorFields(attributeDialog, { name: 'Customer ID', code: 'customer_id' });
    fireEvent.click(within(attributeDialog).getByRole('button', { name: 'ontology.editor.save' }));
    await waitFor(() => expect(api.upsertAttribute).toHaveBeenCalled());

    fireEvent.click(screen.getByText('ontology.objectBuilder.submitReview'));
    await waitFor(() =>
      expect(api.transitionPhase).toHaveBeenCalledWith({
        phase: 'generate',
        status: 'completed',
        summary: 'ontology.phaseSummary.generate',
      })
    );
    expect(await screen.findByText('ontology.objectBuilder.reviewStepTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByText('ontology.review.approveAll'));
    await waitFor(() =>
      expect(api.reviewTarget).toHaveBeenCalledWith({
        targetType: 'object',
        targetId: 'object-2',
        decision: 'approved',
      })
    );
    expect(api.approveAll).not.toHaveBeenCalled();
    expect(await screen.findByText('ontology.objectBuilder.mappingStepTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
    expect(await screen.findByText('ontology.objectBuilder.hydrateStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.publishConsole.check'));
    await waitFor(() => expect(api.runConsistencyCheck).toHaveBeenCalled());
    expect(await screen.findByText('ontology.publish.valid')).toBeInTheDocument();
  });
});
