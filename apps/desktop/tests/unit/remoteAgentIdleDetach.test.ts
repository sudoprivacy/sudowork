import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----------------------------------------------------------------
//
// RemoteAgent pulls in a lot of process-level singletons (ipc, db, message
// persistence, MossSessionApi, file-system tracking). These tests are
// behavioral — we care about the idle-detach timer interacting with the
// MossWsConnection lifecycle. Everything else is stubbed.

const responseStreamEmit = vi.fn();
const confirmationAddEmit = vi.fn();
const confirmationUpdateEmit = vi.fn();
const confirmationRemoveEmit = vi.fn();
const conversationChangedEmit = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: { emit: responseStreamEmit },
      confirmation: {
        add: { emit: confirmationAddEmit },
        update: { emit: confirmationUpdateEmit },
        remove: { emit: confirmationRemoveEmit },
      },
    },
    database: {
      conversationChanged: { emit: conversationChangedEmit },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: (() => {
    let counter = 0;
    return (_: number) => `uuid-${++counter}`;
  })(),
}));

vi.mock('@/process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@/process/database/export', () => ({
  getDatabase: () => ({
    getConversation: () => ({ success: true, data: { id: 'conv-1', extra: {} } }),
    updateConversation: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(() => ({ success: true })),
    getConversationMessages: () => ({ data: [], total: 0, hasMore: false }),
    insertMessage: vi.fn(),
    deleteConversationMessages: vi.fn(),
    getUserConversations: () => ({ data: [], total: 0, hasMore: false }),
  }),
}));

vi.mock('@/process/message', () => ({
  addOrUpdateMessage: vi.fn(),
}));

vi.mock('@/process/task/draftsCleanup', () => ({
  detectFileIntent: () => ({ intent: 'final' as const }),
  matchesDraftPattern: () => false,
}));

const terminateSessionSpy = vi.fn(async () => {});
vi.mock('@/process/remote/MossSessionApi', () => ({
  initMossApi: () => ({
    setAccessToken: vi.fn(),
    ensureAuthenticated: vi.fn(async () => 'token'),
    resumeSession: vi.fn(),
    terminateSession: terminateSessionSpy,
  }),
  getMossApi: () => null,
  getMossApiServerUrl: () => null,
}));

vi.mock('@/common/utils/workspaceSkillSync', () => ({
  isRemoteContainerPath: () => false,
}));

vi.mock('@/process/utils/enabledSkillFilter', () => ({
  filterEnabledSkillNames: vi.fn(async (skills?: string[]) => skills),
}));

// ProcessConfig getSync is read each time scheduleIdleDetachTimer fires, so
// tests parameterize this per-test via vi.mocked() below.
const processConfigGetSync = vi.fn();
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: { getSync: processConfigGetSync },
}));

// MossWsConnection is the WS lifecycle object the agent owns. Tests track
// instance count to assert that a detach + next sendMessage rebuilds it.
type FakeCallbacks = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onMessage?: (msg: any) => void;
  onPermissionRequest?: (req: any, id: string) => void;
  onReconnecting?: (a: number, m: number) => void;
  onError?: (err: Error) => void;
};

class FakeMossWsConnection {
  static instances: FakeMossWsConnection[] = [];
  static reset() {
    FakeMossWsConnection.instances = [];
  }

  disconnectCalls = 0;
  sendMessageCalls = 0;
  connected = false;
  callbacks: FakeCallbacks;
  config: any;

  constructor(config: any, callbacks: FakeCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    FakeMossWsConnection.instances.push(this);
  }

  async connect() {
    this.connected = true;
    this.callbacks.onConnected?.();
  }

  disconnect() {
    this.disconnectCalls++;
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  getSessionId() {
    return this.config.sessionId ?? 'moss-session-1';
  }

  getWsUrl() {
    return this.config.wsUrl ?? 'ws://moss.example/session';
  }

  getWorkDir() {
    return null;
  }

  sendMessage() {
    this.sendMessageCalls++;
    return { success: true };
  }

  sendInterruptAndWait() {
    return Promise.resolve(true);
  }

  sendQuestionAnswer() {
    return { success: true };
  }

  respondToPermissionRequest() {
    /* no-op */
  }
}

vi.mock('@/agent/remote/MossWsConnection', () => ({
  MossWsConnection: FakeMossWsConnection,
}));

// ---- Helpers --------------------------------------------------------------

type RemoteAgentClass = typeof import('@/process/task/RemoteAgent').default;
type RemoteAgentInstance = InstanceType<RemoteAgentClass>;

interface RemoteAgentInternals {
  idleDetachTimer: NodeJS.Timeout | null;
  connection: FakeMossWsConnection | null;
  bootstrap: Promise<void> | undefined;
  turnActive: boolean;
  scheduleIdleDetachTimer: () => void;
  handleStreamMessage: (msg: any) => void;
}

const internals = (agent: RemoteAgentInstance) => agent as unknown as RemoteAgentInternals;

async function loadRemoteAgent(): Promise<RemoteAgentClass> {
  const mod = await import('@/process/task/RemoteAgent');
  return mod.default;
}

function makeAgent(RemoteAgent: RemoteAgentClass): RemoteAgentInstance {
  return new RemoteAgent({
    conversation_id: 'conv-1',
    serverUrl: 'https://moss.example',
    authToken: 'eyJ.test',
    assistantName: 'default',
    mossSessionPending: false,
    wsUrl: 'ws://moss.example/session',
    sessionId: 'moss-session-1',
  });
}

function makePendingAgent(RemoteAgent: RemoteAgentClass): RemoteAgentInstance {
  return new RemoteAgent({
    conversation_id: 'conv-1',
    serverUrl: 'https://moss.example',
    authToken: 'eyJ.test',
    assistantName: 'default',
    mossSessionPending: true,
  });
}

// ---- Tests ----------------------------------------------------------------

describe('RemoteAgent idle detach', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMossWsConnection.reset();
    responseStreamEmit.mockClear();
    confirmationAddEmit.mockClear();
    confirmationUpdateEmit.mockClear();
    confirmationRemoveEmit.mockClear();
    conversationChangedEmit.mockClear();
    terminateSessionSpy.mockClear();
    processConfigGetSync.mockReset();
    // Default: 1 minute idle detach for fast test runs.
    processConfigGetSync.mockImplementation((key: string) => (key === 'remote.idleDetachMinutes' ? 1 : undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('detaches after the idle window when finished', async () => {
    const RemoteAgent = await loadRemoteAgent();
    const agent = makeAgent(RemoteAgent);

    await agent.sendMessage({ content: 'hello', msg_id: 'm1' });
    expect(FakeMossWsConnection.instances).toHaveLength(1);
    const conn = FakeMossWsConnection.instances[0];
    expect(internals(agent).turnActive).toBe(true);
    expect(internals(agent).idleDetachTimer).toBeNull();

    // Simulate Moss-emitted finish.
    internals(agent).handleStreamMessage({ type: 'finish', conversation_id: 'conv-1', msg_id: 'm1', data: null });
    expect(internals(agent).turnActive).toBe(false);
    expect(internals(agent).idleDetachTimer).not.toBeNull();
    expect(conn.disconnectCalls).toBe(0);

    // Advance past the 1-min idle window — detach should fire.
    vi.advanceTimersByTime(60_000 + 10);
    expect(conn.disconnectCalls).toBe(1);
    expect(internals(agent).connection).toBeNull();
    expect(internals(agent).bootstrap).toBeUndefined();
    expect(internals(agent).idleDetachTimer).toBeNull();
    // Critical: detach must never terminate the Moss session.
    expect(terminateSessionSpy).not.toHaveBeenCalled();
  });

  it('does not detach while a turn is running', async () => {
    const RemoteAgent = await loadRemoteAgent();
    const agent = makeAgent(RemoteAgent);

    await agent.sendMessage({ content: 'hello', msg_id: 'm1' });
    const conn = FakeMossWsConnection.instances[0];

    // Manually try to schedule — running guard should refuse.
    internals(agent).scheduleIdleDetachTimer();
    expect(internals(agent).idleDetachTimer).toBeNull();

    vi.advanceTimersByTime(60_000 + 10);
    expect(conn.disconnectCalls).toBe(0);
    expect(internals(agent).connection).not.toBeNull();
  });

  it('cancels the timer when a new stream message arrives', async () => {
    const RemoteAgent = await loadRemoteAgent();
    const agent = makeAgent(RemoteAgent);

    await agent.sendMessage({ content: 'hello', msg_id: 'm1' });
    internals(agent).handleStreamMessage({ type: 'finish', conversation_id: 'conv-1', msg_id: 'm1', data: null });
    expect(internals(agent).idleDetachTimer).not.toBeNull();

    // Inbound activity (e.g. Moss replays a content frame) should cancel the timer.
    internals(agent).handleStreamMessage({ type: 'content', conversation_id: 'conv-1', msg_id: 'm2', data: 'hi' });
    expect(internals(agent).idleDetachTimer).toBeNull();

    vi.advanceTimersByTime(60_000 + 10);
    expect(FakeMossWsConnection.instances[0].disconnectCalls).toBe(0);
  });

  it('treats remote.idleDetachMinutes=0 as disabled', async () => {
    processConfigGetSync.mockImplementation((key: string) => (key === 'remote.idleDetachMinutes' ? 0 : undefined));
    const RemoteAgent = await loadRemoteAgent();
    const agent = makeAgent(RemoteAgent);

    await agent.sendMessage({ content: 'hello', msg_id: 'm1' });
    internals(agent).handleStreamMessage({ type: 'finish', conversation_id: 'conv-1', msg_id: 'm1', data: null });

    expect(internals(agent).idleDetachTimer).toBeNull();
    vi.advanceTimersByTime(3 * 60_000);
    expect(FakeMossWsConnection.instances[0].disconnectCalls).toBe(0);
  });

  it('detach() never calls MossSessionApi.terminateSession', async () => {
    const RemoteAgent = await loadRemoteAgent();
    const agent = makeAgent(RemoteAgent);

    await agent.sendMessage({ content: 'hello', msg_id: 'm1' });
    const conn = FakeMossWsConnection.instances[0];

    (agent as unknown as { detach: () => void }).detach();

    expect(conn.disconnectCalls).toBe(1);
    expect(internals(agent).connection).toBeNull();
    expect(internals(agent).bootstrap).toBeUndefined();
    expect(terminateSessionSpy).not.toHaveBeenCalled();
  });

  it('next sendMessage after detach rebuilds the connection via resume path', async () => {
    const RemoteAgent = await loadRemoteAgent();
    const agent = makeAgent(RemoteAgent);

    await agent.sendMessage({ content: 'hello', msg_id: 'm1' });
    internals(agent).handleStreamMessage({ type: 'finish', conversation_id: 'conv-1', msg_id: 'm1', data: null });
    vi.advanceTimersByTime(60_000 + 10);
    expect(FakeMossWsConnection.instances).toHaveLength(1);
    expect(internals(agent).connection).toBeNull();

    // Switch back to real timers for the async sendMessage flow — fake timers
    // would freeze the microtask scheduling inside initAgent().
    vi.useRealTimers();
    await agent.sendMessage({ content: 'again', msg_id: 'm2' });

    expect(FakeMossWsConnection.instances).toHaveLength(2);
    const resumed = FakeMossWsConnection.instances[1];
    // The rebuilt connection must use the persisted wsUrl/sessionId (resume),
    // not create a new Moss session.
    expect(resumed.config.wsUrl).toBe('ws://moss.example/session');
    expect(resumed.config.sessionId).toBe('moss-session-1');
    expect(resumed.sendMessageCalls).toBe(1);
  });

  it('lazy-created sessions resume after idle detach instead of creating another Moss session', async () => {
    const RemoteAgent = await loadRemoteAgent();
    const agent = makePendingAgent(RemoteAgent);

    await agent.sendMessage({ content: 'hello', msg_id: 'm1' });
    expect(FakeMossWsConnection.instances).toHaveLength(1);
    const created = FakeMossWsConnection.instances[0];
    expect(created.config.wsUrl).toBeUndefined();
    expect(created.config.sessionId).toBeUndefined();

    internals(agent).handleStreamMessage({ type: 'finish', conversation_id: 'conv-1', msg_id: 'm1', data: null });
    vi.advanceTimersByTime(60_000 + 10);
    expect(internals(agent).connection).toBeNull();

    vi.useRealTimers();
    await agent.sendMessage({ content: 'again', msg_id: 'm2' });

    expect(FakeMossWsConnection.instances).toHaveLength(2);
    const resumed = FakeMossWsConnection.instances[1];
    expect(resumed.config.wsUrl).toBe('ws://moss.example/session');
    expect(resumed.config.sessionId).toBe('moss-session-1');
    expect(resumed.sendMessageCalls).toBe(1);
  });
});

describe('RemoteConversationProvider.deleteConversation', () => {
  it('still calls MossSessionApi.terminateSession when a mossSessionId is present', async () => {
    // This test uses its own isolated module mocks rather than the agent ones
    // above — the provider has a different dependency graph.
    vi.resetModules();

    const terminateSpy = vi.fn(async () => {});
    const conversationsById = new Map<string, any>([
      [
        'conv-with-session',
        {
          id: 'conv-with-session',
          type: 'remote-agent',
          extra: { mossSessionId: 'moss-abc', mossServerUrl: 'https://moss.example' },
        },
      ],
    ]);

    const dbMock = {
      getConversation: (id: string) =>
        conversationsById.has(id) ? { success: true, data: conversationsById.get(id) } : { success: false, data: undefined },
      updateConversation: vi.fn(() => ({ success: true })),
      deleteConversation: vi.fn(() => {
        conversationsById.delete('conv-with-session');
        return { success: true };
      }),
      createConversation: vi.fn(() => ({ success: true })),
      getUserConversations: () => ({ data: [], total: 0, hasMore: false }),
    };
    // RemoteConversationProvider imports from '@process/database' (which re-exports
    // from './index'). Both must be mocked because Vitest resolves the runtime
    // alias, not the re-export.
    vi.doMock('@process/database', () => ({ getDatabase: () => dbMock }));
    vi.doMock('@/process/database/export', () => ({ getDatabase: () => dbMock }));
    vi.doMock('@/process/database', () => ({ getDatabase: () => dbMock }));

    vi.doMock('@/process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));

    const killSpy = vi.fn();
    vi.doMock('@/process/WorkerManage', () => ({
      default: { kill: killSpy, buildConversation: vi.fn() },
    }));

    vi.doMock('@/process/remote/MossSessionApi', () => ({
      initMossApi: () => ({
        setAccessToken: vi.fn(),
        ensureAuthenticated: vi.fn(async () => 'token'),
        terminateSession: terminateSpy,
      }),
    }));

    vi.doMock('@/process/initStorage', () => ({
      ProcessConfig: { getSync: () => undefined, get: vi.fn(async () => undefined), set: vi.fn() },
    }));

    vi.doMock('@/common/utils/workspaceSkillSync', () => ({ isRemoteContainerPath: () => false }));

    const { RemoteConversationProvider } = await import('@/process/providers/RemoteConversationProvider');
    const provider = new RemoteConversationProvider({
      mossServerUrl: 'https://moss.example',
      authToken: 'eyJ.test',
    } as any);

    const ok = await provider.deleteConversation('conv-with-session');
    expect(ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith('conv-with-session');
    expect(terminateSpy).toHaveBeenCalledWith('moss-abc');
  });
});
