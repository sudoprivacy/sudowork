/** Production SDK session transport against a live Nexus daemon. */
import assert from 'node:assert/strict';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { NexusVfsClient, NexusSessionTransport } from '@nexus-ai-fs/vfs-client';

const endpoint = process.env.ACP_GRPC_ENDPOINT || '127.0.0.1:2130';
const client = new NexusVfsClient(endpoint);
const call = async (method, params) => {
  const value = JSON.parse(await client.call(method, JSON.stringify(params), ''));
  return value && typeof value === 'object' && 'result' in value ? value.result : value;
};
let started;
let transport;
let timer;
try {
  started = await call('managed_agent.start_session_v1', {
    agent_id: `session-smoke-${randomUUID()}`,
    spawn_spec: {cmd: 'cat', args: [], env: {PATH: process.env.PATH || '/usr/bin:/bin'}, cwd: process.env.NEXUS_SMOKE_CWD || (process.platform === 'win32' ? os.tmpdir() : '/tmp')},
  });
  assert.ok(started.session_endpoint, 'daemon must implement acp-mailbox/1');
  const probe = {jsonrpc: '2.0', id: 0, method: 'probe', params: {text: 'mailbox echo'}};
  const response = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Session echo timed out')), 10000);
    transport = new NexusSessionTransport({client, endpoint: started.session_endpoint, authToken: '',
      onMessage: resolve, onClose: error => reject(error || new Error('Session closed before echo'))});
  });
  transport.start();
  await transport.send(probe);
  assert.deepEqual(await response, probe);
  console.log('SESSION MAILBOX SMOKE PASS');
} finally {
  clearTimeout(timer);
  await transport?.close().catch(() => {});
  if (started) await call('managed_agent.cancel_v1', {session_id: started.session_id, mode: 'session'}).catch(() => {});
  client.close();
}
