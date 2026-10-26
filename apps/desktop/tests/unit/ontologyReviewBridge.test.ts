import { afterEach, describe, expect, it, vi } from 'vitest';
import { initOntologyBridge } from '@process/bridge/ontologyBridge';

const mocks = vi.hoisted(() => ({ providers: new Map<string, (input: unknown) => Promise<unknown>>(), create: vi.fn(), open: vi.fn(), browser: vi.fn(), revoke: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { ontology: new Proxy({}, { get: (_object, name: string) => ({ provider: (callback: (input: unknown) => Promise<unknown>) => mocks.providers.set(name, callback), emit: vi.fn() }) }) } }));
vi.mock('@process/services/ontology/OntologyService', () => ({ ontologyService: { onAgentRegistrationChanged: vi.fn(), createStudioReviewSession: mocks.create } }));
vi.mock('@process/services/browserPanel/localBrowserSessionHost', () => ({ getLocalBrowserSessions: mocks.browser }));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  mocks.providers.clear();
});

describe('native review IPC boundary', () => {
  it('hands the private cookie only to the browser host and returns an opaque result', async () => {
    const launch = { url: 'http://127.0.0.1/review/opaque/', cookie: { value: 'private-credential' }, revoke: mocks.revoke };
    mocks.create.mockResolvedValue(launch);
    mocks.browser.mockReturnValue({ openAuthorizedPage: mocks.open });
    mocks.open.mockResolvedValue({ surface: 'native', conversationId: 'bound-chat' });
    initOntologyBridge();
    const result = await mocks.providers.get('openReview')!({ workspaceId: 'model', conversationId: 'bound-chat' });
    expect(mocks.create).toHaveBeenCalledWith({ workspaceId: 'model', conversationId: 'bound-chat' });
    expect(mocks.open).toHaveBeenCalledWith('bound-chat', launch);
    expect(result).toEqual({ success: true, data: { surface: 'native', conversationId: 'bound-chat' } });
    expect(JSON.stringify(result)).not.toContain('credential');
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('revokes a prepared session when browser launch fails', async () => {
    mocks.create.mockResolvedValue({ url: 'private-route', revoke: mocks.revoke });
    mocks.browser.mockReturnValue({ openAuthorizedPage: mocks.open });
    mocks.open.mockRejectedValue(new Error('ontology.studio.reviewRuntimeUnavailable'));
    initOntologyBridge();
    expect(await mocks.providers.get('openReview')!({ workspaceId: 'model', conversationId: 'bound-chat' })).toEqual({ success: false, msg: 'ontology.studio.reviewRuntimeUnavailable' });
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });

  it('does not allocate a browser when project/conversation authorization fails', async () => {
    mocks.create.mockRejectedValue(new Error('Review conversation does not own this registered model.'));
    initOntologyBridge();
    expect(await mocks.providers.get('openReview')!({ workspaceId: 'model', conversationId: 'foreign-chat' })).toMatchObject({ success: false });
    expect(mocks.browser).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
