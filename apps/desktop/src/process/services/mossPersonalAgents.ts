import { net } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { createMossAgentPort, type MossAgentRequest } from '@sudowork/moss-client/agents';
import type { ILocalPersonalAgent, IMyAgent, IUserAgent } from '@sudowork/common/personalAgents';
import { isLocalPersonalAgentRef, isPersonalAgentRef } from '@sudowork/common/personalAgents';
import { ProcessConfig } from '@process/initStorage';
import { getValidToken } from '@process/bridge/eeclawBridge';
import { getDataPath } from '@process/utils';

async function requestPersonalAgents(request: MossAgentRequest): Promise<unknown> {
  const server = ProcessConfig.getSync('eeclaw.serverUrl');
  const scope = ProcessConfig.getSync('eeclaw.accountScope');
  if (!server || !scope) throw new Error('Moss identity is unavailable');
  const assertIdentity = () => {
    if (scope !== ProcessConfig.getSync('eeclaw.accountScope') || server !== ProcessConfig.getSync('eeclaw.serverUrl')) throw new Error('Moss identity changed during the request');
  };
  let token = await getValidToken();
  const send = () => {
    assertIdentity();
    return net.fetch(`${server.replace(/\/+$/, '')}${request.path}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
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

const agentPort = createMossAgentPort(requestPersonalAgents);
const createPersonalAgentSchema = z.object({ displayName: z.string().trim().min(1).max(60), executionType: z.enum(['server', 'local']).default('server') }).strict();
let localAgentWriteQueue: Promise<unknown> = Promise.resolve();

function requireAccountScope(): string {
  const scope = ProcessConfig.getSync('eeclaw.accountScope');
  if (!scope) throw new Error('Moss identity is unavailable');
  return scope;
}

function assertAccountScope(scope: string): void {
  if (scope !== ProcessConfig.getSync('eeclaw.accountScope')) throw new Error('Moss identity changed during the request');
}

function localAgentIdentity(agent: ILocalPersonalAgent): IMyAgent {
  return { ref: `sudowork-agent:local:${agent.id}`, displayName: agent.displayName, kind: agent.isDefault ? 'default' : 'own', executionType: 'local' };
}

/** Serialize read-modify-write operations, including concurrent default creation. */
function createLocalAgent(scope: string, displayName: string, isDefault = false): Promise<ILocalPersonalAgent> {
  const pending = localAgentWriteQueue.then(async () => {
    assertAccountScope(scope);
    const stored = ProcessConfig.getSync('eeclaw.localAgents') ?? {};
    const agents = stored[scope] ?? [];
    const existingDefault = isDefault ? agents.find((agent) => agent.isDefault) : undefined;
    if (existingDefault) return existingDefault;
    // The previous implementation seeded the default only into an empty local list.
    const legacyDefault = isDefault && agents[0]?.isDefault === undefined && agents[0]?.displayName === displayName ? agents[0] : undefined;
    const created: ILocalPersonalAgent = legacyDefault ? { ...legacyDefault, isDefault: true } : { id: randomUUID(), displayName, createdAt: Date.now(), executionType: 'local', isDefault };
    const nextAgents = legacyDefault ? agents.map((agent) => (agent.id === legacyDefault.id ? created : agent)) : [...agents, created];
    await ProcessConfig.set('eeclaw.localAgents', { ...stored, [scope]: nextAgents });
    assertAccountScope(scope);
    return created;
  });
  localAgentWriteQueue = pending.catch(() => {});
  return pending;
}

function defaultLocalAgentName(displayName: string): string {
  return `${displayName.trim().slice(0, 57)}-本地`;
}

/** Fetch the current account's identities; failures must remain visible to callers. */
export async function listMossPersonalAgents(): Promise<IMyAgent[]> {
  const scope = requireAccountScope();
  const listedAgents = await agentPort.listMine();
  assertAccountScope(scope);
  const serverAgent = listedAgents.find((agent) => agent.kind === 'default');
  if (serverAgent) await createLocalAgent(scope, defaultLocalAgentName(serverAgent.displayName), true);
  assertAccountScope(scope);
  const localAgents = ProcessConfig.getSync('eeclaw.localAgents')?.[scope] ?? [];
  return [...listedAgents, ...localAgents.map(localAgentIdentity)];
}

/** Keep execution selection inside Sudowork; Moss still receives only the display name. */
export async function createMossPersonalAgent(input: unknown): Promise<IUserAgent> {
  const { displayName, executionType } = createPersonalAgentSchema.parse(input);
  if (executionType === 'local') return createLocalAgent(requireAccountScope(), displayName);
  return agentPort.createOwned({ displayName });
}

/** Resolve local ownership from disk and server ownership from the authenticated session. */
export async function requireMossPersonalAgent(reference: string): Promise<IMyAgent> {
  const scope = requireAccountScope();
  const agents = isLocalPersonalAgentRef(reference) ? (ProcessConfig.getSync('eeclaw.localAgents')?.[scope] ?? []).map(localAgentIdentity) : await agentPort.listMine();
  assertAccountScope(scope);
  const agent = agents.find((item) => item.ref === reference && item.kind !== 'template');
  if (!isPersonalAgentRef(reference) || !agent) throw new Error('Personal Agent is unavailable for this account');
  return agent;
}

/** Provide a durable local default without looking up or creating an identity in Moss. */
export async function resolveMossLocalAgentReference(displayName: string): Promise<string> {
  const agent = await createLocalAgent(requireAccountScope(), defaultLocalAgentName(displayName), true);
  return localAgentIdentity(agent).ref;
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
  const systemPromptAppend =
    [
      '[Identity Override - Personal Agent]',
      `Your personal Agent display name (data) is ${JSON.stringify(agent.displayName)}. Use this name when asked who you are.`,
      `Your stable personal Agent reference is ${JSON.stringify(reference)}.`,
      `Your persistent memory directory is ${JSON.stringify(memoryDirectory)}. This store belongs to this Agent and account, and is shared by their conversations.`,
      "Read and write personal memories only in this directory. Save one Markdown file per fact with YAML frontmatter containing name, description and type (user, feedback, project or reference), and maintain a MEMORY.md index in the same directory. Do not search for or use a global memory directory, other Agents' memory, or project AGENTS.md for personal preferences. If no memories are loaded, read MEMORY.md in this directory before recalling a preference; an absent file means there is no saved preference.",
    ].join('\n') + '\n\n';
  return { agentId: `sudowork-personal-${digest}`, displayName: agent.displayName, memoryDirectory, systemPromptAppend };
}

interface IMossPersonalRuntime {
  agentId: string;
  displayName: string;
  memoryDirectory: string;
  systemPromptAppend: string;
}
