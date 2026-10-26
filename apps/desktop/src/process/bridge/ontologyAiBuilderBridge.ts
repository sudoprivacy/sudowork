import { randomUUID } from 'node:crypto';
import type { IOntologyAiBuilderSession } from '@sudowork/host-bridge/ipcBridge';
import { ipcBridge } from '@/common';
import { mainError } from '@process/utils/mainLogger';
import { OntologyStudioDatabase as OntologyDatabase } from '@process/services/ontology/OntologyStudioDatabase';
import { ontologyService } from '@process/services/ontology/OntologyService';
import { prepareOntologyProject } from '@process/services/ontology/ontologyProjectRuntime';
import { getDatabase } from '@process/database';
import { assertConversationAccount, isConversationInCurrentAccount } from '@process/services/mossExecutionContext';

interface IOntologyAiSessionRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/**
 * Singleton so all handlers share one connection. `ontologyService` already
 * instantiates its own `OntologyDatabase` for the workbench; we open a
 * separate handle here for AI-session bookkeeping so we don't have to touch
 * OntologyService's public surface. Both handles read/write the same file at
 * ~/.nexus/data/ontology/ontology.db, so cross-handle inserts remain visible
 * to workbench queries and vice versa (SQLite handles concurrent readers).
 */
let db: OntologyDatabase | null = null;
function getDb(): OntologyDatabase {
  if (!db) db = new OntologyDatabase();
  return db;
}

function toSession(row: IOntologyAiSessionRow): IOntologyAiBuilderSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isCurrentSession(row: IOntologyAiSessionRow): boolean {
  const conversation = getDatabase().getConversation(row.conversation_id).data;
  return !!conversation && conversation.extra.purpose === 'ontology' && conversation.extra.ontologyId === row.workspace_id && isConversationInCurrentAccount(conversation);
}

async function resolveActiveWorkspaceId(): Promise<string> {
  const summary = await ontologyService.listWorkbenches();
  return summary.activeWorkspaceId || summary.items[0]?.workspaceId || 'default';
}

export function initOntologyAiBuilderBridge(): void {
  ipcBridge.ontologyAiBuilder.listSessions.provider(async (input) => {
    try {
      const workspaceId = input?.workspaceId?.trim() || undefined;
      // Recover an interrupted cross-database create from the persisted conversation ownership.
      const conversations = getDatabase().getUserConversations(undefined, 0, 10000).data || [];
      for (const conversation of conversations) {
        const ontologyId = conversation.extra.ontologyId;
        if (conversation.extra.purpose !== 'ontology' || !ontologyId || (workspaceId && ontologyId !== workspaceId) || !isConversationInCurrentAccount(conversation)) continue;
        if (!getDb().getProject(ontologyId) || getDb().getAiSessionByConversationId(conversation.id)) continue;
        getDb().createAiSession({ id: `oai_${randomUUID()}`, workspace_id: ontologyId, conversation_id: conversation.id, title: conversation.name, created_at: conversation.createTime, updated_at: conversation.modifyTime });
      }
      const rows = getDb().listAiSessions(workspaceId);
      return { success: true, data: { items: rows.filter(isCurrentSession).map(toSession) } };
    } catch (err) {
      mainError('OntologyAiBuilderBridge', 'listSessions failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.ontologyAiBuilder.createSession.provider(async (input) => {
    try {
      if (!input?.conversationId?.trim()) return { success: false, msg: 'conversationId is required' };
      const workspaceId = input.workspaceId?.trim() || (await resolveActiveWorkspaceId());
      if (!getDb().getProject(workspaceId)) throw new Error('ontology.studio.errors.notFound');
      const conversation = getDatabase().getConversation(input.conversationId).data;
      if (conversation?.extra.purpose !== 'ontology' || conversation.extra.ontologyId !== workspaceId) throw new Error('Ontology conversation scope mismatch.');
      assertConversationAccount(conversation);
      const existing = getDb().getAiSessionByConversationId(input.conversationId);
      if (existing) {
        // Idempotent: creating a session for a conversation that already has
        // one just returns the record so the renderer never sees UNIQUE-key
        // errors after page refreshes.
        return { success: true, data: toSession(existing) };
      }
      const now = Date.now();
      const row: IOntologyAiSessionRow = {
        id: `oai_${randomUUID()}`,
        workspace_id: workspaceId,
        conversation_id: input.conversationId,
        title: input.title?.trim() || 'AI 构建会话',
        created_at: now,
        updated_at: now,
      };
      getDb().createAiSession(row);
      ipcBridge.ontologyAiBuilder.sessionsChanged.emit({ workspaceId });
      return { success: true, data: toSession(row) };
    } catch (err) {
      mainError('OntologyAiBuilderBridge', 'createSession failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.ontologyAiBuilder.deleteSession.provider(async (input) => {
    try {
      if (!input?.id) return { success: false, msg: 'id is required' };
      // Delete the underlying conversation via the reaper SSOT — that already
      // releases every runtime resource (WorkerManage tasks, workspace,
      // deliverables, dify session, …) and, thanks to the cascade in
      // OntologyAiSessionRegistry, also removes this registry row and emits
      // sessionsChanged. So we don't call getDb().deleteAiSession() here;
      // the reaper's cleanup step is the single source of truth.
      const row = getDb().getAiSessionById(input.id);
      if (!row) return { success: true, data: undefined };
      const conversation = getDatabase().getConversation(row.conversation_id).data;
      if (conversation && !isCurrentSession(row)) throw new Error('Ontology conversation scope mismatch.');
      if (!conversation) {
        getDb().deleteAiSession(row.id);
        ipcBridge.ontologyAiBuilder.sessionsChanged.emit({ workspaceId: row.workspace_id });
        return { success: true, data: undefined };
      }
      const { reapConversation } = await import('@process/services/conversationReaper');
      await reapConversation(row.conversation_id, { reason: 'user-delete' });
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.ontologyAiBuilder.getSessionByConversation.provider(async (input) => {
    try {
      if (!input?.conversationId) return { success: false, msg: 'conversationId is required' };
      const row = getDb().getAiSessionByConversationId(input.conversationId);
      return { success: true, data: row && isCurrentSession(row) ? toSession(row) : null };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.ontologyAiBuilder.prepareProject.provider(async (input) => {
    try {
      const prepared = await prepareOntologyProject(input.workspaceId);
      return { success: true, data: prepared };
    } catch (err) {
      mainError('OntologyAiBuilderBridge', 'prepareProject failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
