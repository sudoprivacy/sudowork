import { net } from 'electron';
import { z } from 'zod';
import type { IMyAgent, IUserAgent } from '@sudowork/common/personalAgents';
import { isPersonalAgentRef } from '@sudowork/common/personalAgents';
import { ProcessConfig } from '@process/initStorage';
import { getValidToken } from '@process/bridge/eeclawBridge';

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
