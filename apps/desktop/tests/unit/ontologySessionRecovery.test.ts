import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initOntologyAiBuilderBridge } from '@process/bridge/ontologyAiBuilderBridge';

const fixture = vi.hoisted(() => ({ handlers: new Map<string, (input?: any) => Promise<any>>(), sessions: [] as Array<Record<string, any>>, conversations: [] as Array<Record<string, any>> }));
vi.mock('@/common', () => ({
  ipcBridge: {
    ontologyAiBuilder: Object.fromEntries(['listSessions', 'createSession', 'deleteSession', 'getSessionByConversation', 'prepareProject', 'sessionsChanged'].map((name) => [name, { provider: (callback: (input?: any) => Promise<any>) => fixture.handlers.set(name, callback), emit: vi.fn() }])),
  },
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({ ontologyService: {} }));
vi.mock('@process/services/ontology/ontologyProjectRuntime', () => ({ prepareOntologyProject: vi.fn() }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getUserConversations: () => ({ data: fixture.conversations }) }) }));
vi.mock('@process/services/mossExecutionContext', () => ({ isConversationInCurrentAccount: () => true }));
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
  initOntologyAiBuilderBridge();
});
describe('ontology session recovery', () => {
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
