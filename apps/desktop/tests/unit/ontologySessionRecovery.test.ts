import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initOntologyAiBuilderBridge } from '@process/bridge/ontologyAiBuilderBridge';

const fixture = vi.hoisted(() => ({ handlers: new Map<string, (input?: any) => Promise<any>>(), sessions: [] as Array<Record<string, any>>, conversations: [] as Array<Record<string, any>>, foreign: new Set<string>(), reap: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    ontologyAiBuilder: Object.fromEntries(['listSessions', 'createSession', 'deleteSession', 'getSessionByConversation', 'prepareProject', 'sessionsChanged'].map((name) => [name, { provider: (callback: (input?: any) => Promise<any>) => fixture.handlers.set(name, callback), emit: vi.fn() }])),
  },
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({ ontologyService: {} }));
vi.mock('@process/services/ontology/ontologyProjectRuntime', () => ({ prepareOntologyProject: vi.fn() }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getUserConversations: () => ({ data: fixture.conversations }), getConversation: (id: string) => ({ data: fixture.conversations.find((row) => row.id === id) }) }) }));
vi.mock('@process/services/mossExecutionContext', () => ({
  isConversationInCurrentAccount: (conversation: { id: string }) => !fixture.foreign.has(conversation.id),
  assertConversationAccount: (conversation: { id: string }) => {
    if (fixture.foreign.has(conversation.id)) throw new Error('Conversation belongs to a different Moss account');
  },
}));
vi.mock('@process/services/conversationReaper', () => ({ reapConversation: fixture.reap }));
vi.mock('@process/services/ontology/OntologyStudioDatabase', () => ({
  OntologyStudioDatabase: class {
    getProject(id: string) {
      return ['orders', 'canonical'].includes(id) ? { id, authority: id === 'canonical' ? 'sudograph' : 'rdf' } : null;
    }
    getSnapshot() {
      throw new Error('Session recovery must not require an RDF payload.');
    }
    getAiSessionByConversationId(id: string) {
      return fixture.sessions.find((row) => row.conversation_id === id);
    }
    getAiSessionById(id: string) {
      return fixture.sessions.find((row) => row.id === id);
    }
    deleteAiSession(id: string) {
      const index = fixture.sessions.findIndex((row) => row.id === id);
      if (index >= 0) fixture.sessions.splice(index, 1);
    }
    createAiSession(row: Record<string, unknown>) {
      fixture.sessions.push(row);
    }
    listAiSessions(workspaceId?: string) {
      return fixture.sessions.filter((row) => !workspaceId || row.workspace_id === workspaceId);
    }
  },
}));

beforeEach(() => {
  fixture.sessions.length = 0;
  fixture.conversations.length = 0;
  fixture.foreign.clear();
  fixture.reap.mockReset();
  initOntologyAiBuilderBridge();
});
describe('ontology session recovery', () => {
  it('hides guest or other-account sessions after login without deleting or adopting them', async () => {
    for (const id of ['own', 'guest', 'other']) {
      fixture.conversations.push({ id, name: id, createTime: 1, modifyTime: 2, extra: { purpose: 'ontology', ontologyId: 'canonical' } });
      fixture.sessions.push({ id: `session-${id}`, conversation_id: id, workspace_id: 'canonical' });
    }
    fixture.foreign.add('guest');
    fixture.foreign.add('other');
    const result = await fixture.handlers.get('listSessions')!({ workspaceId: 'canonical' });
    expect(result.success, result.msg).toBe(true);
    expect(result.data.items.map((row: any) => row.conversationId)).toEqual(['own']);
    expect((await fixture.handlers.get('getSessionByConversation')!({ conversationId: 'guest' })).data).toBeNull();
    expect((await fixture.handlers.get('createSession')!({ workspaceId: 'canonical', conversationId: 'guest' })).success).toBe(false);
    expect((await fixture.handlers.get('deleteSession')!({ id: 'session-guest' })).success).toBe(false);
    expect(fixture.reap).not.toHaveBeenCalled();
    expect(fixture.sessions).toHaveLength(3);
    fixture.foreign.clear();
    expect((await fixture.handlers.get('listSessions')!({ workspaceId: 'canonical' })).data.items).toHaveLength(3);
  });

  it('only purges a missing conversation and preserves the registry when resource cleanup fails', async () => {
    fixture.sessions.push({ id: 'orphan', conversation_id: 'missing', workspace_id: 'canonical' }, { id: 'owned', conversation_id: 'own', workspace_id: 'canonical' });
    fixture.conversations.push({ id: 'own', extra: { purpose: 'ontology', ontologyId: 'canonical' } });
    const result = await fixture.handlers.get('listSessions')!({ workspaceId: 'canonical' });
    expect(result.success, result.msg).toBe(true);
    expect(result.data.items).toHaveLength(1);
    expect((await fixture.handlers.get('deleteSession')!({ id: 'orphan' })).success).toBe(true);
    fixture.reap.mockRejectedValueOnce(new Error('Engine shutdown failed'));
    expect((await fixture.handlers.get('deleteSession')!({ id: 'owned' })).success).toBe(false);
    expect(fixture.sessions.map((row) => row.id)).toEqual(['owned']);
  });
  it('recovers canonical model sessions through project ownership without an RDF snapshot', async () => {
    fixture.conversations.push({ id: 'canonical-chat', name: 'Build canonical', createTime: 1, modifyTime: 2, extra: { purpose: 'ontology', ontologyId: 'canonical' } });
    const result = await fixture.handlers.get('listSessions')!({ workspaceId: 'canonical' });
    expect(result.success).toBe(true);
    expect(result.data.items[0].conversationId).toBe('canonical-chat');
  });
  it('recovers a conversation created before an interrupted registry insert without duplicating it', async () => {
    fixture.conversations.push({ id: 'chat', name: 'Build orders', createTime: 1, modifyTime: 2, extra: { purpose: 'ontology', ontologyId: 'orders' } });
    const first = await fixture.handlers.get('listSessions')!({ workspaceId: 'orders' });
    const second = await fixture.handlers.get('listSessions')!({ workspaceId: 'orders' });
    expect(first.data.items).toHaveLength(1);
    expect(second.data.items[0].id).toBe(first.data.items[0].id);
    expect(second.data.items[0].conversationId).toBe('chat');
  });
  it('does not adopt ordinary conversations or resurrect a deleted ontology', async () => {
    fixture.conversations.push({ id: 'general', extra: {} }, { id: 'deleted', extra: { purpose: 'ontology', ontologyId: 'deleted' } });
    const result = await fixture.handlers.get('listSessions')!({ workspaceId: 'orders' });
    expect(result.data.items).toEqual([]);
  });
});
