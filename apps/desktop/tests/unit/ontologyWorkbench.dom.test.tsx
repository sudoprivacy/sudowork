import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOntologyWorkbenchSnapshot, recalculateOntologyStats, summarizeOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import OntologyWorkbench, { type IOntologyWorkbenchApi } from '@sudowork/ontology-ui/OntologyWorkbench';

const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }));

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
  const summary = summarizeOntologyWorkbenchSnapshot(snapshot, snapshot.workspaceId);
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
    upsertAttribute: vi.fn().mockImplementation(async (input) => {
      snapshot.objects = snapshot.objects.map((object) =>
        object.id === input.objectId
          ? {
              ...object,
              attributes: [
                ...object.attributes,
                {
                  id: input.id ?? `attribute-${object.attributes.length + 1}`,
                  code: input.code || input.name,
                  name: input.name,
                  dataType: input.dataType,
                  required: input.required ?? false,
                  description: input.description,
                  example: input.example,
                  constraints: input.constraints,
                },
              ],
            }
          : object
      );
      return refreshSnapshot();
    }),
    deleteAttribute: vi.fn().mockResolvedValue(snapshot),
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
    onWorkbenchChanged: vi.fn().mockReturnValue(() => undefined),
  };
}

describe('OntologyWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation(
      (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })
    );
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
    vi.mocked(api.createAgentBlueprint).mockResolvedValue({
      snapshot,
      blueprint: {
        id: 'agent-version-2',
        name: 'Versioned Agent',
        status: 'draft',
        ontologyVersionId: 'version-2',
        entityIds: ['customer'],
        promptTemplate: 'ontology.agent.defaultPrompt',
        toolManifest: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
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
    });
    expect(await screen.findByText('ontology.objectBuilder.templateReadyTitle')).toBeInTheDocument();
    expect(api.generateDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('ontology.objectBuilder.confirmTemplate'));
    await waitFor(() =>
      expect(api.generateDraft).toHaveBeenCalledWith({
        assetIds: ['template_asset'],
        mode: 'merge',
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
    fireEvent.change(screen.getByPlaceholderText('ontology.objectBuilder.businessGoalPlaceholder'), {
      target: { value: 'Model operational documents' },
    });
    fireEvent.click(screen.getByText('ontology.objectBuilder.next'));
    expect(await screen.findByText('ontology.objectBuilder.extractStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.objectBuilder.startExtraction'));
    await waitFor(() =>
      expect(api.generateDraft).toHaveBeenCalledWith({
        assetIds: ['operations_document'],
        businessGoal: 'Model operational documents',
        mode: 'merge',
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
        businessGoal: 'Model customer data',
        mode: 'merge',
      })
    );
    expect(await screen.findByText('ontology.objectBuilder.reviewStepTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ontology.review.approveAll'));
    expect(await screen.findByText('ontology.objectBuilder.hydrateStepTitle')).toBeInTheDocument();
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
    fireEvent.change(await screen.findByPlaceholderText('ontology.editor.displayName'), {
      target: { value: 'Manual Customer' },
    });
    fireEvent.change(screen.getByPlaceholderText('ontology.editor.englishName'), {
      target: { value: 'manual_customer' },
    });
    fireEvent.click(screen.getAllByText('ontology.editor.save').at(-1) as HTMLElement);
    await waitFor(() => expect(api.upsertObject).toHaveBeenCalled());

    fireEvent.click(await screen.findByText('ontology.editor.addAttributeShort'));
    fireEvent.change(await screen.findByPlaceholderText('ontology.editor.name'), {
      target: { value: 'Customer ID' },
    });
    fireEvent.change(screen.getByPlaceholderText('ontology.editor.code'), {
      target: { value: 'customer_id' },
    });
    fireEvent.click(screen.getAllByText('ontology.editor.save').at(-1) as HTMLElement);
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
