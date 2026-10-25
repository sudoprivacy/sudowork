import path from 'node:path';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { safeStorage } from 'electron';
import BetterSqlite3 from 'better-sqlite3';
import { createDefaultOntologyWorkbenchSnapshot, createSemanticDocument, reconcileSemanticModel, recalculateOntologyStats, projectSemanticDocument } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyRepository } from '@sudowork/ontology-engine';
import { getDataPath } from '@process/utils';

interface IStoredWorkspace {
  payload: string;
  revision: number;
}

interface IOntologyAiSessionRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface IStudioOperation {
  id: string;
  payload: string;
}

export type OntologyProject = { id: string; title: string; authority: 'rdf'; modelRef: null } | { id: string; title: string; authority: 'sudograph'; modelRef: string };

/** Independent storage for the redesigned workbench; legacy ontology data is never migrated. */
export class OntologyStudioDatabase implements IOntologyRepository {
  private readonly db: BetterSqlite3.Database;
  private readonly directory: string;

  constructor(directory = path.join(getDataPath(), 'ontology-studio')) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    this.db = new BetterSqlite3(path.join(directory, 'studio.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_workspaces (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_operations (workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace_id, id));
      CREATE TABLE IF NOT EXISTS studio_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE, conversation_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_sessions_workspace ON studio_sessions(workspace_id, updated_at);
    `);
    // Conversations belong to projects, not to an RDF serialization. Migrate
    // the foreign key atomically, retaining all existing session ownership.
    this.db.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS studio_projects (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, authority TEXT NOT NULL CHECK(authority IN ('rdf', 'sudograph')),
        model_ref TEXT UNIQUE, CHECK((authority = 'rdf' AND model_ref IS NULL) OR (authority = 'sudograph' AND model_ref IS NOT NULL))
      )`);
      const workspaces = this.db.prepare('SELECT id FROM studio_workspaces').all() as Array<{ id: string }>;
      for (const { id } of workspaces) this.db.prepare("INSERT OR IGNORE INTO studio_projects VALUES (?, ?, 'rdf', NULL)").run(id, id);
      const foreignKeys = this.db.prepare('PRAGMA foreign_key_list(studio_sessions)').all() as Array<{ table: string }>;
      if (foreignKeys.some((key) => key.table === 'studio_workspaces')) {
        this.db.exec(`
          CREATE TABLE studio_sessions_migrated (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE, conversation_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          INSERT INTO studio_sessions_migrated SELECT * FROM studio_sessions;
          DROP TABLE studio_sessions;
          ALTER TABLE studio_sessions_migrated RENAME TO studio_sessions;
          CREATE INDEX studio_sessions_workspace ON studio_sessions(workspace_id, updated_at);
        `);
      }
    })();
  }

  getProject(workspaceId: string): OntologyProject | null {
    const row = this.db.prepare('SELECT id, title, authority, model_ref AS modelRef FROM studio_projects WHERE id = ?').get(workspaceId);
    return (row as OntologyProject | undefined) || null;
  }

  listProjects(): OntologyProject[] {
    return this.db.prepare('SELECT id, title, authority, model_ref AS modelRef FROM studio_projects ORDER BY title, id').all() as OntologyProject[];
  }

  /** Host registration only. A project cannot switch model authorities implicitly. */
  registerSudographProject(input: { id: string; title: string; modelRef: string }): void {
    if (!input.id.trim() || !input.title.trim() || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.modelRef)) throw new Error('Invalid Sudograph project registration.');
    this.db.transaction(() => {
      const existing = this.getProject(input.id);
      if (existing) {
        if (existing.authority !== 'sudograph' || existing.modelRef !== input.modelRef) throw new Error('Ontology model authority conflict.');
        return;
      }
      this.db.prepare("INSERT INTO studio_projects VALUES (?, ?, 'sudograph', ?)").run(input.id, input.title, input.modelRef);
    })();
  }

  private assertLegacyAuthority(workspaceId: string): void {
    if (this.getProject(workspaceId)?.authority === 'sudograph') throw new Error('Sudograph owns this model. Use its checked model interface; RDF writes and restores are refused.');
  }

  getSnapshot(workspaceId: string): IOntologyWorkbenchSnapshot | null {
    this.assertLegacyAuthority(workspaceId);
    const row = this.db.prepare('SELECT payload, revision FROM studio_workspaces WHERE id = ?').get(workspaceId) as IStoredWorkspace | undefined;
    if (!row) return null;
    const payload = row.payload.startsWith('encrypted:') ? safeStorage.decryptString(Buffer.from(row.payload.slice(10), 'base64')) : row.payload;
    return JSON.parse(payload) as IOntologyWorkbenchSnapshot;
  }

  listSnapshots(): IOntologyWorkbenchSnapshot[] {
    const rows = this.db.prepare('SELECT id FROM studio_workspaces ORDER BY updated_at DESC').all() as Array<{ id: string }>;
    return rows.map((row) => this.getSnapshot(row.id)!);
  }

  hasOperation(workspaceId: string, operation: IStudioOperation): boolean {
    const row = this.db.prepare('SELECT payload FROM studio_operations WHERE workspace_id = ? AND id = ?').get(workspaceId, operation.id) as { payload: string } | undefined;
    if (row && row.payload !== operation.payload) throw new Error('ontology.studio.errors.operationConflict');
    return !!row;
  }

  saveSnapshot(snapshot: IOntologyWorkbenchSnapshot, expectedSnapshot?: IOntologyWorkbenchSnapshot, operation?: IStudioOperation): void {
    this.db.transaction(() => {
      this.assertLegacyAuthority(snapshot.workspaceId);
      const before = this.getSnapshot(snapshot.workspaceId);
      if (!before && snapshot.revision !== undefined) throw new Error('ontology.studio.errors.notFound');
      if (operation && this.hasOperation(snapshot.workspaceId, operation)) {
        if (before) Object.assign(snapshot, before);
        return;
      }
      if ((expectedSnapshot && !isDeepStrictEqual(before, expectedSnapshot)) || (before && (snapshot.revision || 0) !== (before.revision || 0))) throw new Error('ontology.studio.errors.conflict');
      if (before && (snapshot.agentRevision || 0) !== (before.agentRevision || 0)) throw new Error('ontology.studio.errors.conflict');
      assertAgentBindings(snapshot, before);
      snapshot.agentRevision = (before?.agentRevision || 0) + (!isDeepStrictEqual(before?.agentBlueprints || [], snapshot.agentBlueprints) ? 1 : 0);
      const semantic = snapshot.semanticDocument || before?.semanticDocument || createSemanticDocument(snapshot.workspaceId);
      const isDocumentChanged = before && !isDeepStrictEqual(before.semanticDocument, snapshot.semanticDocument);
      if (!isDocumentChanged) snapshot.semanticDocument = reconcileSemanticModel(semantic, before || { objects: [], relations: [] }, snapshot, snapshot.workspaceId);
      else snapshot.semanticDocument = semantic;
      const projection = projectSemanticDocument(snapshot.semanticDocument!, snapshot);
      snapshot.objects = projection.objects;
      snapshot.relations = projection.relations;
      const isModelChanged = !before || modelFingerprint(before) !== modelFingerprint(snapshot);
      snapshot.revision = before ? (before.revision || 0) + (isModelChanged ? 1 : 0) : 0;
      snapshot.stats = recalculateOntologyStats(snapshot);
      snapshot.updatedAt = Date.now();
      const raw = JSON.stringify(snapshot);
      let payload: string;
      if (safeStorage.isEncryptionAvailable()) payload = `encrypted:${safeStorage.encryptString(raw).toString('base64')}`;
      else {
        const isSecretPresent = snapshot.connectors.some((connector) => connector.password || Object.keys(connector.credential || {}).length || Object.keys(connector.headers || {}).length);
        if (isSecretPresent) throw new Error('ontology.studio.errors.credentialStorage');
        payload = raw;
      }
      this.db
        .prepare('INSERT INTO studio_workspaces (id, revision, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at')
        .run(snapshot.workspaceId, snapshot.revision, payload, snapshot.updatedAt);
      this.db.prepare("INSERT INTO studio_projects VALUES (?, ?, 'rdf', NULL) ON CONFLICT(id) DO UPDATE SET title = excluded.title").run(snapshot.workspaceId, snapshot.draft.title);
      if (operation) this.db.prepare('INSERT INTO studio_operations (workspace_id, id, payload) VALUES (?, ?, ?)').run(snapshot.workspaceId, operation.id, operation.payload);
    })();
    this.writeMcpExport(snapshot);
  }

  deleteSnapshot(workspaceId: string): void {
    this.assertLegacyAuthority(workspaceId);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM studio_workspaces WHERE id = ?').run(workspaceId);
      this.db.prepare('DELETE FROM studio_projects WHERE id = ?').run(workspaceId);
    })();
    rmSync(this.getMcpExportPath(workspaceId), { force: true });
  }

  resetSnapshot(workspaceId: string): void {
    const current = this.getSnapshot(workspaceId);
    if (!current) return;
    const empty = createDefaultOntologyWorkbenchSnapshot(Date.now(), { workspaceId, title: current.draft.title });
    empty.revision = current.revision;
    empty.agentRevision = current.agentRevision;
    this.saveSnapshot(empty, current);
  }

  getActiveWorkspaceId(): string | null {
    return (this.db.prepare('SELECT value FROM studio_settings WHERE key = ?').get('activeWorkspace') as { value: string } | undefined)?.value || null;
  }

  setActiveWorkspaceId(workspaceId: string): void {
    this.db.prepare('INSERT INTO studio_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('activeWorkspace', workspaceId);
  }

  listAiSessions(workspaceId?: string): IOntologyAiSessionRow[] {
    return (workspaceId ? this.db.prepare('SELECT * FROM studio_sessions WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) : this.db.prepare('SELECT * FROM studio_sessions ORDER BY updated_at DESC').all()) as IOntologyAiSessionRow[];
  }

  getAiSessionByConversationId(conversationId: string): IOntologyAiSessionRow | undefined {
    return this.db.prepare('SELECT * FROM studio_sessions WHERE conversation_id = ?').get(conversationId) as IOntologyAiSessionRow | undefined;
  }

  getAiSessionById(id: string): IOntologyAiSessionRow | undefined {
    return this.db.prepare('SELECT * FROM studio_sessions WHERE id = ?').get(id) as IOntologyAiSessionRow | undefined;
  }

  createAiSession(row: IOntologyAiSessionRow): void {
    this.db.prepare('INSERT INTO studio_sessions (id, workspace_id, conversation_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.workspace_id, row.conversation_id, row.title, row.created_at, row.updated_at);
  }

  deleteAiSession(id: string): void {
    this.db.prepare('DELETE FROM studio_sessions WHERE id = ?').run(id);
  }
  touchAiSession(conversationId: string, updatedAt: number): void {
    this.db.prepare('UPDATE studio_sessions SET updated_at = ? WHERE conversation_id = ?').run(updatedAt, conversationId);
  }
  close(): void {
    this.db.close();
  }
  getMcpExportPath(workspaceId: string): string {
    return path.join(this.directory, `mcp-${encodeURIComponent(workspaceId)}.json`);
  }

  private writeMcpExport(snapshot: IOntologyWorkbenchSnapshot): void {
    const payload = {
      schemaVersion: snapshot.schemaVersion,
      workspaceId: snapshot.workspaceId,
      title: snapshot.draft.title,
      updatedAt: snapshot.updatedAt,
      versions: snapshot.publishedVersions.map((version) => ({ ...version, snapshot: { ...version.snapshot, logicFunctions: version.snapshot.logicFunctions.map(({ body: _body, ...fn }) => fn), actions: version.snapshot.actions.map(({ configuration: _configuration, ...action }) => action) } })),
    };
    const target = this.getMcpExportPath(snapshot.workspaceId);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600 });
    renameSync(temporary, target);
  }
}

/** Enforce version ownership inside the same transaction that persists the snapshot. */
function assertAgentBindings(snapshot: IOntologyWorkbenchSnapshot, before: IOntologyWorkbenchSnapshot | null): void {
  for (const versionId of new Set(snapshot.skillBlueprints.map((item) => item.ontologyVersionId))) {
    const skills = snapshot.skillBlueprints.filter((item) => item.ontologyVersionId === versionId && item.status !== 'deleted');
    if (skills.length > 1) throw new Error('ontology.studio.skillErrors.duplicate');
    const previous = before?.skillBlueprints.find((item) => item.id === skills[0]?.id);
    if (previous?.registeredSkillId && skills[0]?.registeredSkillId !== previous.registeredSkillId) throw new Error('ontology.studio.skillErrors.identityConflict');
  }
  const skillIds = new Set(snapshot.agentBlueprints.map((item) => item.skillBlueprintId));
  for (const skillId of skillIds) {
    const items = snapshot.agentBlueprints.filter((item) => item.skillBlueprintId === skillId);
    const prior = before?.agentBlueprints.filter((item) => item.skillBlueprintId === skillId) || [];
    // Existing duplicates may be read until the registration service retires them; no new duplicate is accepted.
    if (items.length > 1 && (items.length > prior.length || items.some((item) => !prior.some((old) => old.id === item.id)))) throw new Error('ontology.studio.agentErrors.duplicate');
    if (items.length === 1 && prior.length === 1 && items[0].id !== prior[0].id) throw new Error('ontology.studio.agentErrors.identityConflict');
    for (const item of items) {
      const old = prior.find((entry) => entry.id === item.id);
      if (old?.registeredAssistantId && item.registeredAssistantId !== old.registeredAssistantId) throw new Error('ontology.studio.agentErrors.identityConflict');
    }
  }
}

function modelFingerprint(snapshot: IOntologyWorkbenchSnapshot): string {
  return JSON.stringify(
    {
      document: snapshot.semanticDocument?.statements,
      draft: snapshot.draft,
      objects: snapshot.objects,
      relations: snapshot.relations,
      mappings: snapshot.mappings,
      rules: snapshot.qualityRules,
      functions: snapshot.logicFunctions,
      actions: snapshot.actions,
      assets: snapshot.assets.map((asset) => ({ id: asset.id, fields: asset.fields })),
    },
    (key, value: unknown) => (['updatedAt', 'createdAt', 'executionCount', 'lastExecutedAt', 'reviewDecision'].includes(key) ? undefined : value)
  );
}
