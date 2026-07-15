/**
 * team-mcp MCP server.
 *
 * Per-member bridge injected into each team agent's session via ACP
 * session/new.mcp_servers (K2 wire format). Exposes team_* tools so a member
 * agent can talk to teammates, spawn new members, and query the roster.
 *
 * Identity (slot_id + bearer token + port) is read from env vars injected by
 * TeamService at session/new time. If any is missing this is a normal
 * (non-team) session that somehow spawned team-mcp — exit cleanly to avoid
 * polluting it (fallback guard, see plan §1.5).
 *
 * Tools are not filtered by role here: team-mcp forwards every call uniformly
 * over HTTP loopback to TeamService, which resolves the caller's role from
 * slot_id and enforces Lead-only tools server-side.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import * as http from 'node:http';

const TEAM_MCP_PORT = process.env.TEAM_MCP_PORT;
const TEAM_MCP_TOKEN = process.env.TEAM_MCP_TOKEN;
const TEAM_MCP_SLOT_ID = process.env.TEAM_MCP_SLOT_ID;

// Per-member guard: normal sessions never inject these. If absent, exit so the
// agent session runs without a useless team server (plan §1.5 fallback).
if (!TEAM_MCP_PORT || !TEAM_MCP_TOKEN || !TEAM_MCP_SLOT_ID) {
  // eslint-disable-next-line no-console
  console.error('[team-mcp] missing TEAM_MCP_PORT/TEAM_MCP_TOKEN/TEAM_MCP_SLOT_ID env; exiting (non-team session).');
  process.exit(0);
}

const PORT = Number(TEAM_MCP_PORT);
// 300s matches the protocol budget (plan §I.6) — spawn/send can take a while.
const REQUEST_TIMEOUT_MS = 300_000;
const TEAM_SERVICE_PATH = '/team-mcp';

interface LoopbackResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// Forward a tool invocation to TeamService over HTTP loopback. The caller's
// identity travels in the body (slot_id); TeamService authorizes by role there.
function forwardTool(tool: string, args: Record<string, unknown>): Promise<LoopbackResponse> {
  return new Promise((resolve) => {
    const payload = Buffer.from(
      JSON.stringify({ slot_id: TEAM_MCP_SLOT_ID, tool, args }),
      'utf-8',
    );
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: TEAM_SERVICE_PATH,
        method: 'POST',
        headers: {
          authorization: `Bearer ${TEAM_MCP_TOKEN}`,
          'content-type': 'application/json',
          'content-length': payload.length,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve(JSON.parse(text) as LoopbackResponse);
          } catch {
            resolve({ ok: false, error: `bad_response (status=${res.statusCode}): ${text.slice(0, 200)}` });
          }
        });
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      resolve({ ok: false, error: `team_service_unavailable: ${err.message}` });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.write(payload);
    req.end();
  });
}

// Stage 2 ships the first 3 tools; the remaining 8 (task_*, rename, shutdown,
// list_assistants, describe_assistant, list_models) arrive in later stages.
const TOOLS: Tool[] = [
  {
    name: 'team_send_message',
    description:
      "Send a message to a teammate by slot_id, or to all teammates with to='*' (everyone except the caller). Delivery is async; returns a queue ack.",
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: "Recipient slot_id, or '*' for all teammates except the caller." },
        message: { type: 'string' },
      },
      required: ['to', 'message'],
    },
  },
  {
    name: 'team_spawn_agent',
    description:
      "Spawn a new team member. Lead-only — non-lead callers are rejected by the team service. Returns the spawned member's slot_id and status.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        assistant_id: { type: 'string', description: 'Assistant id from team_list_assistants.' },
        model: { type: 'string' },
        role: { type: 'string', enum: ['lead', 'teammate'] },
      },
      required: ['name', 'assistant_id'],
    },
  },
  {
    name: 'team_members',
    description: 'List current team members with their slot_id, name, role, status, backend, and model.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function textReply(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

function errorReply(text: string): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return { isError: true, content: [{ type: 'text', text }] };
}

const server = new Server(
  { name: 'sudowork-team-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const toolName = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  // Uniform forward: TeamService resolves role from slot_id and rejects
  // Lead-only tools (e.g. team_spawn_agent) for non-lead callers.
  const res = await forwardTool(toolName, args);
  if (!res.ok) return errorReply(res.error ?? 'team tool failed');
  const data = res.data === undefined ? '{}' : JSON.stringify(res.data);
  return textReply(data);
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[team-mcp] failed to start stdio transport:', err);
});
