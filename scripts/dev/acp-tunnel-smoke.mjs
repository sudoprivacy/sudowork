/**
 * Foundational smoke for the ACP nexus tunnel against a live nexusd-cluster.
 *
 * Verifies managed_agent + the fd-stream tunnel end-to-end without sudowork:
 * start_session (spawn `cat`) → write to /proc/{sid}/fd/0 → read the echo from
 * /proc/{sid}/fd/1. Mirrors what GrpcAcpTransport does.
 *
 *   ACP_GRPC_ENDPOINT=127.0.0.1:2130 node scripts/dev/acp-tunnel-smoke.mjs
 */
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { writeFileSync, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';

const ENDPOINT = process.env.ACP_GRPC_ENDPOINT || '127.0.0.1:2130';
const PROTO = `syntax = "proto3";
package nexus.grpc.vfs;
service NexusVFSService {
  rpc Call(CallRequest) returns (CallResponse);
  rpc StreamReadAt(StreamReadAtRequest) returns (StreamReadAtResponse);
  rpc StreamWriteNowait(StreamWriteRequest) returns (StreamWriteResponse);
}
message CallRequest { string method = 1; bytes payload = 2; string auth_token = 3; }
message CallResponse { bytes payload = 1; bool is_error = 2; }
message StreamReadAtRequest { string path = 1; uint64 offset = 2; bool blocking = 3; uint64 timeout_ms = 4; string auth_token = 5; }
message StreamReadAtResponse { bytes data = 1; uint64 next_offset = 2; bool eof = 3; bool is_error = 4; bytes error_payload = 5; }
message StreamWriteRequest { string path = 1; bytes data = 2; string auth_token = 3; }
message StreamWriteResponse { uint64 offset = 1; bool is_error = 2; bytes error_payload = 3; }`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'sm-'));
const pf = path.join(dir, 'v.proto');
writeFileSync(pf, PROTO);
const def = protoLoader.loadSync(pf, { keepCase: true, longs: String, defaults: true });
const pkg = grpc.loadPackageDefinition(def);
const client = new pkg.nexus.grpc.vfs.NexusVFSService(ENDPOINT, grpc.credentials.createInsecure());

const call = (method, params) =>
  new Promise((res, rej) =>
    client.Call({ method, payload: Buffer.from(JSON.stringify(params)), auth_token: '' }, (e, r) => {
      if (e) return rej(e);
      const b = r.payload && r.payload.length ? JSON.parse(Buffer.from(r.payload).toString()) : null;
      if (r.is_error) return rej(new Error(`${method}: ${JSON.stringify(b)}`));
      res(b && typeof b === 'object' && 'result' in b ? b.result : b);
    }),
  );
const readAt = (p, off) =>
  new Promise((res, rej) =>
    client.StreamReadAt({ path: p, offset: off, blocking: false, timeout_ms: 0, auth_token: '' }, (e, r) => {
      if (e) return rej(e);
      if (r.is_error) return rej(new Error(`read is_error: ${r.error_payload ? Buffer.from(r.error_payload).toString() : ''}`));
      res({ data: r.data ? Buffer.from(r.data) : Buffer.alloc(0), next: r.next_offset || off, eof: r.eof });
    }),
  );
const write = (p, d) =>
  new Promise((res, rej) =>
    client.StreamWriteNowait({ path: p, data: d, auth_token: '' }, (e, r) => {
      if (e) return rej(e);
      if (r.is_error) return rej(new Error('write is_error'));
      res();
    }),
  );

(async () => {
  console.log(`[smoke] endpoint=${ENDPOINT}`);
  const s = await call('managed_agent.start_session_v1', {
    agent_id: 'acp-tunnel-smoke',
    spawn_spec: { cmd: 'cat', args: [], env: {}, cwd: '/tmp' },
  });
  console.log('[smoke] start_session →', JSON.stringify(s));
  const sid = s.session_id;
  if (!sid) throw new Error('no session_id in response');

  await write(`/proc/${sid}/fd/0`, Buffer.from('hello tunnel\n'));
  console.log('[smoke] wrote "hello tunnel" to fd/0');

  let off = '0';
  let got = '';
  for (let i = 0; i < 30; i++) {
    const r = await readAt(`/proc/${sid}/fd/1`, off);
    if (r.data.length) {
      got += r.data.toString();
      off = r.next;
      if (got.includes('hello tunnel')) break;
    } else {
      await new Promise((z) => setTimeout(z, 100));
    }
  }
  console.log('[smoke] fd/1 read →', JSON.stringify(got));

  await call('managed_agent.cancel_v1', { session_id: sid, mode: 'session' }).catch(() => {});
  const ok = got.includes('hello tunnel');
  console.log(ok ? '✅ TUNNEL SMOKE PASS' : '❌ TUNNEL SMOKE FAIL (no echo)');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('[smoke] ERROR:', e.message);
  process.exit(1);
});
