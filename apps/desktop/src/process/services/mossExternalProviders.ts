import { net } from 'electron';
import { createMossHostedTaskPort } from '@sudowork/moss-client/hosted-tasks';
import type { MossAgentFetch } from '@sudowork/moss-client/agents';
import { createMossExternalProviderPort, withExternalRequestDeadline } from '@sudowork/moss-client/external-providers';
import { ProcessConfig } from '@process/initStorage';
import { getValidToken } from '@process/bridge/eeclawBridge';

const requestMossTask: MossAgentFetch = (request) =>
  withExternalRequestDeadline(async (signal) => {
    const server = ProcessConfig.getSync('eeclaw.serverUrl');
    const scope = ProcessConfig.getSync('eeclaw.accountScope');
    if (!server || !scope) throw new Error('Moss identity is unavailable');
    const assertIdentity = () => {
      signal.throwIfAborted();
      if (server !== ProcessConfig.getSync('eeclaw.serverUrl') || scope !== ProcessConfig.getSync('eeclaw.accountScope')) throw new Error('EXTERNAL_IDENTITY_CHANGED');
    };
    let token = await getValidToken();
    assertIdentity();
    const send = () =>
      net.fetch(`${server.replace(/\/+$/, '')}${request.path}`, {
        method: request.method,
        headers: { Authorization: `Bearer ${token}`, ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal,
      });
    let response = await send();
    assertIdentity();
    if (response.status === 401) {
      await response.body?.cancel();
      token = await getValidToken(true);
      assertIdentity();
      response = await send();
      assertIdentity();
    }
    const data: unknown = await response.json();
    if (!response.ok) {
      const code = (data as { error?: { code?: unknown } })?.error?.code;
      throw new Error(typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'EXTERNAL_TASK_REQUEST_FAILED');
    }
    assertIdentity();
    return data;
  });
export const externalProviderPort = createMossExternalProviderPort(requestMossTask);
export const hostedTaskPort = createMossHostedTaskPort(requestMossTask);
