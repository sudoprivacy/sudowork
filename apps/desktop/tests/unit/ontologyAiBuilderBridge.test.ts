import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const bridgeSource = path.resolve(__dirname, '../../src/process/bridge/ontologyAiBuilderBridge.ts');
const dbSource = path.resolve(__dirname, '../../src/process/services/ontology/OntologyDatabase.ts');

describe('ontology AI builder bridge contract', () => {
  it('registers the four IPC providers plus the emitter', () => {
    const source = fs.readFileSync(bridgeSource, 'utf8');
    expect(source).toContain('ipcBridge.ontologyAiBuilder.listSessions.provider');
    expect(source).toContain('ipcBridge.ontologyAiBuilder.createSession.provider');
    expect(source).toContain('ipcBridge.ontologyAiBuilder.deleteSession.provider');
    expect(source).toContain('ipcBridge.ontologyAiBuilder.getSessionByConversation.provider');
    expect(source).toContain('ipcBridge.ontologyAiBuilder.sessionsChanged.emit');
  });

  it('createSession is idempotent for a repeated conversationId', () => {
    // Guard against introducing UNIQUE-constraint errors when the renderer
    // resubmits after a hot reload / navigation. Keeping this pinned as a
    // contract test avoids re-testing SQLite specifics.
    const source = fs.readFileSync(bridgeSource, 'utf8');
    expect(source).toContain('getAiSessionByConversationId(input.conversationId)');
    expect(source).toMatch(/if \(existing\) \{[\s\S]*return \{ success: true, data: toSession\(existing\) \};/);
  });

  it('installs the builder MCP so the AI can write to the ontology', () => {
    // This is the single most important behavioural invariant of the AI
    // Builder flow: without the MCP registration, the chat becomes a plain
    // conversation and the workbench data stays empty. Pinning it here
    // catches regressions if someone deletes the registration call.
    const source = fs.readFileSync(bridgeSource, 'utf8');
    expect(source).toContain('ensureOntologyBuilderMcpServer');
  });

  it('surfaces the mcpConfig on ensureBuilderMcp so the caller can inject it into session/new', () => {
    // Scode's user-scope MCP is NOT auto-loaded into acp sessions — the
    // caller MUST pass mcpConfig via conversation.create's extra so
    // session/new.mcp_servers contains ontology-builder. Verify the wiring
    // is still in place.
    const source = fs.readFileSync(bridgeSource, 'utf8');
    expect(source).toContain('data: { ready: true, mcpConfig }');
  });

  it('deleteSession routes through conversationReaper so sider deletion stays in sync', () => {
    // Two-way cascade: Builder-delete → reap conversation (which cascades
    // back to remove the session row via OntologyAiSessionRegistry). Guards
    // against the split-brain the user hit on 2026-09-20 where each side had
    // its own independent delete.
    const source = fs.readFileSync(bridgeSource, 'utf8');
    expect(source).toContain('reapConversation(row.conversation_id');
  });
});

describe('conversationReaper → ontology AI session cascade', () => {
  const reaperSource = fs.readFileSync(path.resolve(__dirname, '../../src/process/services/conversationReaper.ts'), 'utf8');

  it('drops the ontology-ai session registry row when a conversation is reaped', () => {
    expect(reaperSource).toContain('removeOntologyAiSessionForConversation');
  });

  it('also sweeps orphan ontology-ai session rows when the conversation is already gone', () => {
    // The early return branch (`conversation not found`) used to skip every
    // subsequent step, including our cascade. This left the AI 构建 list
    // showing a dangling card that "delete" appeared to succeed on but kept
    // returning. Pin the orphan sweep to the early return path so deletion
    // is one-shot even after the conversation is reaped from the sider first.
    const earlyReturnBlock = reaperSource.match(/if \(!conversation\) \{[\s\S]*?return result;\s*\}/);
    expect(earlyReturnBlock).not.toBeNull();
    expect(earlyReturnBlock?.[0]).toContain('removeOntologyAiSessionForConversation');
  });
});

describe('OntologyAiSessionRegistry', () => {
  const registrySource = fs.readFileSync(path.resolve(__dirname, '../../src/process/services/ontology/OntologyAiSessionRegistry.ts'), 'utf8');

  it('emits sessionsChanged so the Builder page refreshes after cascade delete', () => {
    expect(registrySource).toContain('ipcBridge.ontologyAiBuilder.sessionsChanged.emit');
  });
});

describe('AcpAgent extraMcpConfigs plumbing', () => {
  const acpAgentSource = fs.readFileSync(path.resolve(__dirname, '../../src/process/task/AcpAgent.ts'), 'utf8');

  it('AcpAgentData accepts extraMcpConfigs', () => {
    expect(acpAgentSource).toContain('extraMcpConfigs?: Array<{');
  });

  it('createOrResumeSession merges teamMcpConfig + extraMcpConfigs into mcp_servers', () => {
    expect(acpAgentSource).toContain('this.options.extraMcpConfigs?.length');
    expect(acpAgentSource).toContain('mcpConfigs.push(...this.options.extraMcpConfigs)');
  });
});

describe('OntologyAIBuilderPage passes MCP config to session/new', () => {
  const pageSource = fs.readFileSync(path.resolve(__dirname, '../../../../packages/ontology-ai/src/OntologyAIBuilderPage.tsx'), 'utf8');

  it('runs ensureBuilderMcp BEFORE conversation.create (scode reads MCP at spawn)', () => {
    const ensureIndex = pageSource.indexOf('ontologyAiBuilder.ensureBuilderMcp.invoke');
    const createIndex = pageSource.indexOf('conversation.create.invoke');
    expect(ensureIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(ensureIndex).toBeLessThan(createIndex);
  });

  it('injects the returned mcpConfig into extra.extraMcpConfigs', () => {
    expect(pageSource).toContain('extraMcpConfigs: [mcpRes.data.mcpConfig]');
  });
});

describe('OntologyDatabase AI session helpers', () => {
  it('exposes the four public methods used by the bridge', () => {
    const source = fs.readFileSync(dbSource, 'utf8');
    expect(source).toMatch(/listAiSessions\(workspaceId\?/);
    expect(source).toContain('getAiSessionByConversationId(conversationId: string)');
    expect(source).toContain('createAiSession(row: IOntologyAiSessionRow)');
    expect(source).toContain('deleteAiSession(id: string)');
  });

  it('scopes listAiSessions by workspace_id when provided', () => {
    const source = fs.readFileSync(dbSource, 'utf8');
    expect(source).toContain('WHERE workspace_id = ? ORDER BY updated_at DESC');
    expect(source).toContain('ORDER BY updated_at DESC');
  });

  it('CREATE TABLE declares conversation_id UNIQUE to prevent duplicate registrations', () => {
    const source = fs.readFileSync(dbSource, 'utf8');
    expect(source).toContain('conversation_id TEXT NOT NULL UNIQUE');
  });
});
