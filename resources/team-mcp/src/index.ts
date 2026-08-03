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

// All 11 team_* tools (附录 I.6). Every call forwards uniformly over HTTP loopback
// to TeamService, which resolves the caller's role from slot_id and enforces
// Lead-only tools (spawn/rename/shutdown) server-side.
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
      'Create a new teammate agent to join the team. Lead-only — non-lead callers are rejected by the team service.\n\n' +
      'Use this only when one of the following is true:\n' +
      '- The user explicitly approved the proposed teammate lineup in a previous message\n' +
      '- The user explicitly instructed you to create a specific teammate immediately\n\n' +
      'Before calling this tool in the normal planning flow:\n' +
      '- Start with one short sentence explaining why additional teammates would help\n' +
      '- Present the proposal as a table with: teammate name, responsibility, recommended assistant, and recommended model\n' +
      '- Ask whether to create them as proposed or to change any names, responsibilities, or assistant choices\n' +
      '- Do NOT call this tool in that same turn; wait for explicit confirmation in a later user message\n\n' +
      "When calling this tool, always provide assistant_id from team_list_assistants, and model from team_list_models — never guess. Returns the spawned member's slot_id and status.",
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
    description: 'List current team members with their slot_id, name, role, status, backend, model, and assistant_id.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'team_task_create',
    description: 'Create a task on the shared task board. blocked_by lists task_ids this task waits on; cycles are rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        description: { type: 'string' },
        owner: { type: 'string', description: 'slot_id of the member owning the task.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'task_ids this task depends on.' },
      },
      required: ['subject'],
    },
  },
  {
    name: 'team_task_update',
    description: 'Update a task. Setting status to a terminal value (completed/failed/cancelled) dismantles its dependency edges. blocked_by changes are cycle-checked.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] },
        description: { type: 'string' },
        owner: { type: 'string' },
        blocked_by: { type: 'array', items: { type: 'string' } },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'team_task_list',
    description: 'List all tasks on the shared task board.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'team_rename_agent',
    description: 'Rename a team member. Lead-only.',
    inputSchema: {
      type: 'object',
      properties: {
        slot_id: { type: 'string' },
        new_name: { type: 'string' },
      },
      required: ['slot_id', 'new_name'],
    },
  },
  {
    name: 'team_shutdown_agent',
    description: 'Ask a teammate to shut down gracefully. Lead-only; the team lead cannot be shut down. The teammate replies via team_send_message with "shutdown_approved" or "shutdown_rejected:<reason>".',
    inputSchema: {
      type: 'object',
      properties: {
        slot_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['slot_id'],
    },
  },
  {
    name: 'team_list_assistants',
    description:
      'List assistants available to spawn as teammates (merged guide agents + installed assistants, deduped and priority-sorted). Use this BEFORE team_spawn_agent to get the real assistant_id values — do NOT guess from backend names like claude/codex/gemini. Each entry has an assistant_id usable with team_spawn_agent.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'team_describe_assistant',
    description:
      'Describe a single assistant: its rules, enabled skills, preset agent type, and resolved backend. Use this before spawning when two or more assistants look relevant, to judge which fits the user’s request and to populate spawn context.',
    inputSchema: {
      type: 'object',
      properties: {
        assistant_id: { type: 'string' },
        locale: { type: 'string' },
      },
      required: ['assistant_id'],
    },
  },
  {
    name: 'team_list_models',
    description:
      'List the model configs available for an assistant (by assistant_id). Use this BEFORE team_spawn_agent to pick a valid model — pass the exact model ID it returns, or omit model to use the assistant’s default.',
    inputSchema: {
      type: 'object',
      properties: {
        assistant_id: { type: 'string' },
      },
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
