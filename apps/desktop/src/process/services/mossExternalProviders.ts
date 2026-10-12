import { net } from 'electron';
import { createMossExternalProviderPort } from '@sudowork/moss-client/external-providers';
import { ProcessConfig } from '@process/initStorage';
import { getValidToken } from '@process/bridge/eeclawBridge';

export const externalProviderPort = createMossExternalProviderPort(async (request) => {
  const server = ProcessConfig.getSync('eeclaw.serverUrl');
  const scope = ProcessConfig.getSync('eeclaw.accountScope');
  if (!server || !scope) throw new Error('Moss identity is unavailable');
  const assertIdentity = () => {
    if (server !== ProcessConfig.getSync('eeclaw.serverUrl') || scope !== ProcessConfig.getSync('eeclaw.accountScope')) throw new Error('Moss identity changed');
  };
  const token = await getValidToken();
  assertIdentity();
  const response = await net.fetch(`${server.replace(/\/+$/, '')}${request.path}`, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    signal: AbortSignal.timeout(15_000),
  });
  assertIdentity();
  const data: unknown = await response.json();
  if (!response.ok) {
    const code = (data as { error?: { code?: unknown } })?.error?.code;
    throw new Error(typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'EXTERNAL_TASK_REQUEST_FAILED');
  }
  assertIdentity();
  return data;
});
