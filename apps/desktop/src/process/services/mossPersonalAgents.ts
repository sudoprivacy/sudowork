import { net } from 'electron';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { IMyAgent, IUserAgent } from '@sudowork/common/personalAgents';
import { isPersonalAgentRef } from '@sudowork/common/personalAgents';
import { ProcessConfig } from '@process/initStorage';
import { getValidToken } from '@process/bridge/eeclawBridge';
import { getDataPath } from '@process/utils';

const myAgentsSchema = z.object({ success: z.literal(true), data: z.array(z.object({ ref: z.string().min(1), displayName: z.string(), kind: z.enum(['default', 'own', 'template']) })) });
const createdAgentSchema = z.object({ success: z.literal(true), data: z.object({ id: z.string().uuid(), displayName: z.string().min(1), createdAt: z.number() }) });
const createAgentSchema = z.object({ displayName: z.string().trim().min(1).max(60) }).strict();

async function requestPersonalAgents(path: string, body?: { displayName: string }): Promise<unknown> {
  const server = ProcessConfig.getSync('eeclaw.serverUrl');
  const scope = ProcessConfig.getSync('eeclaw.accountScope');
  if (!server || !scope) throw new Error('Moss identity is unavailable');
  const assertIdentity = () => {
    if (scope !== ProcessConfig.getSync('eeclaw.accountScope') || server !== ProcessConfig.getSync('eeclaw.serverUrl')) throw new Error('Moss identity changed during the request');
  };
  let token = await getValidToken();
  const send = () => {
    assertIdentity();
    return net.fetch(`${server.replace(/\/+$/, '')}/api/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  };
  let response = await send();
  if (response.status === 401) {
    assertIdentity();
    token = await getValidToken(true);
    response = await send();
  }
  assertIdentity();
  if (!response.ok) throw new Error(`Personal Agent request failed: HTTP ${response.status}`);
  const data: unknown = await response.json();
  assertIdentity();
  return data;
}

/** Fetch the current account's identities; failures must remain visible to callers. */
export async function listMossPersonalAgents(): Promise<IMyAgent[]> {
  return myAgentsSchema.parse(await requestPersonalAgents('agents/mine')).data as IMyAgent[];
}

/** Ownership comes exclusively from the authenticated server session. */
export async function createMossPersonalAgent(input: { displayName: string }): Promise<IUserAgent> {
  const body = createAgentSchema.parse(input);
  return createdAgentSchema.parse(await requestPersonalAgents('user-agents', { displayName: body.displayName! })).data as IUserAgent;
}

/** Recheck ownership before starting or restoring a local personal Agent. */
export async function requireMossPersonalAgent(reference: string): Promise<IMyAgent> {
  const agent = (await listMossPersonalAgents()).find((item) => item.ref === reference && item.kind !== 'template');
  if (!isPersonalAgentRef(reference) || !agent) throw new Error('Personal Agent is unavailable for this account');
  return agent;
}

/** Keep local personal identity and memory stable across conversations in one account. */
export async function resolveMossPersonalRuntime(reference: string, accountScope: string): Promise<IMossPersonalRuntime> {
  if (!/^[a-f0-9]{64}$/.test(accountScope) || accountScope !== ProcessConfig.getSync('eeclaw.accountScope')) throw new Error('Conversation belongs to a different Moss account');
  const agent = await requireMossPersonalAgent(reference);
  if (accountScope !== ProcessConfig.getSync('eeclaw.accountScope')) throw new Error('Moss identity changed during runtime preparation');
  const digest = createHash('sha256')
    .update(JSON.stringify([accountScope, reference]))
    .digest('hex');
  const memoryDirectory = path.join(getDataPath(), 'managed', accountScope, 'agents', digest, 'memory');
  const systemPromptAppend = [
    '## Personal Agent identity and memory',
    `Your personal Agent display name (data) is ${JSON.stringify(agent.displayName)}. Use this name when asked who you are.`,
    `Your stable personal Agent reference is ${JSON.stringify(reference)}.`,
    `Your persistent memory directory is ${JSON.stringify(memoryDirectory)}. This store belongs to this Agent and account, and is shared by their conversations.`,
    "Read and write personal memories only in this directory, following the auto-memory file format and MEMORY.md index. Do not search for or use a global memory directory, other Agents' memory, or project AGENTS.md for personal preferences. If no memories are loaded, read MEMORY.md in this directory before recalling a preference; an absent file means there is no saved preference.",
  ].join('\n');
  return { agentId: `sudowork-personal-${digest}`, memoryDirectory, systemPromptAppend };
}

interface IMossPersonalRuntime {
  agentId: string;
  memoryDirectory: string;
  systemPromptAppend: string;
}
