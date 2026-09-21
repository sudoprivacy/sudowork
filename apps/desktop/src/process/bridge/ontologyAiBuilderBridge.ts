import { randomUUID } from 'node:crypto';
import type { IOntologyAiBuilderSession } from '@sudowork/host-bridge/ipcBridge';
import { ipcBridge } from '@/common';
import { mainError, mainLog } from '@process/utils/mainLogger';
import { OntologyDatabase } from '@process/services/ontology/OntologyDatabase';
import { ontologyService } from '@process/services/ontology/OntologyService';
import { ensureOntologyBuilderMcpServer } from '@process/services/ontology/OntologyMcpRegistration';

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

async function resolveActiveWorkspaceId(): Promise<string> {
  const summary = await ontologyService.listWorkbenches();
  return summary.activeWorkspaceId || summary.items[0]?.workspaceId || 'default';
}

export function initOntologyAiBuilderBridge(): void {
  ipcBridge.ontologyAiBuilder.listSessions.provider(async (input) => {
    try {
      const workspaceId = input?.workspaceId?.trim() || undefined;
      const rows = getDb().listAiSessions(workspaceId);
      return { success: true, data: { items: rows.map(toSession) } };
    } catch (err) {
      mainError('OntologyAiBuilderBridge', 'listSessions failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.ontologyAiBuilder.createSession.provider(async (input) => {
    try {
      if (!input?.conversationId?.trim()) return { success: false, msg: 'conversationId is required' };
      const workspaceId = input.workspaceId?.trim() || (await resolveActiveWorkspaceId());
      const existing = getDb().getAiSessionByConversationId(input.conversationId);
      if (existing) {
        // Idempotent: creating a session for a conversation that already has
        // one just returns the record so the renderer never sees UNIQUE-key
        // errors after page refreshes.
        return { success: true, data: toSession(existing) };
      }
      // Ensure the builder MCP is installed in Sudocode before the AI turn
      // fires, so the very first message can already invoke ontology_* tools.
      // Best-effort: if MCP install fails (e.g. bundle missing during dev),
      // the session is still created — the chat just won't be able to write.
      try {
        await ensureOntologyBuilderMcpServer();
      } catch (err) {
        mainLog('OntologyAiBuilderBridge', `builder MCP registration skipped: ${err instanceof Error ? err.message : String(err)}`);
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
      const { reapConversation } = await import('@process/services/conversationReaper');
      await reapConversation(row.conversation_id, { reason: 'user-delete' }).catch((err) => {
        // If the conversation is already gone (e.g. user deleted it from the
        // sider first), still purge our registry row so the Builder page
        // doesn't keep showing a dangling card.
        mainError('OntologyAiBuilderBridge', 'reapConversation failed, purging session row only', err);
        getDb().deleteAiSession(row.id);
        ipcBridge.ontologyAiBuilder.sessionsChanged.emit({ workspaceId: row.workspace_id });
      });
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.ontologyAiBuilder.getSessionByConversation.provider(async (input) => {
    try {
      if (!input?.conversationId) return { success: false, msg: 'conversationId is required' };
      const row = getDb().getAiSessionByConversationId(input.conversationId);
      return { success: true, data: row ? toSession(row) : null };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.ontologyAiBuilder.ensureBuilderMcp.provider(async () => {
    try {
      const mcpConfig = await ensureOntologyBuilderMcpServer();
      return { success: true, data: { ready: true, mcpConfig } };
    } catch (err) {
      mainError('OntologyAiBuilderBridge', 'ensureBuilderMcp failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
