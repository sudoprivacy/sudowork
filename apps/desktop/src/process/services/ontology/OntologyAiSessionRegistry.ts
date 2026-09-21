import { ipcBridge } from '@/common';
import { OntologyDatabase } from '@process/services/ontology/OntologyDatabase';

/**
 * Shared handle for the AI-构建 session table. Both the AI Builder bridge and
 * the conversation reaper need to read/delete rows, and each of them used to
 * `new OntologyDatabase()` on demand. That works because SQLite handles
 * concurrent handles, but centralising it here keeps cascade semantics in
 * one place: `conversation.remove` → reaper → this module → drop registry
 * row → broadcast `sessionsChanged` so the Builder page refreshes.
 */
let db: OntologyDatabase | null = null;
function getDb(): OntologyDatabase {
  if (!db) db = new OntologyDatabase();
  return db;
}

export function removeOntologyAiSessionForConversation(conversationId: string): void {
  const row = getDb().getAiSessionByConversationId(conversationId);
  if (!row) return;
  getDb().deleteAiSession(row.id);
  try {
    ipcBridge.ontologyAiBuilder.sessionsChanged.emit({ workspaceId: row.workspace_id });
  } catch {
    // Emitter failures shouldn't break conversation deletion.
  }
}
