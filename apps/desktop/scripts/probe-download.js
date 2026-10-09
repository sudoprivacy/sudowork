#!/usr/bin/env node
/**
 * Probe a download URL with the same code path as `assistantHubBridge.ts:downloadFile`,
 * plus a phase-by-phase timing breakdown so we can tell where it actually stalls.
 *
 * Usage:
 *   node scripts/probe-download.js <url>
 *   node scripts/probe-download.js https://example.com/foo.zip
 *
 * Compare with curl for an apples-to-apples cross-check (different TLS stack):
 *   curl -v -o nul --max-time 180 -w "\ndns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n" "<url>"
 *
 * The script reports:
 *   - DNS resolve time + resolved IPs
 *   - TCP connect time
 *   - TLS handshake time
 *   - HTTP response received time
 *   - First-byte time
 *   - Bytes per second + total bytes
 *   - All redirects followed (incl. 307/308 which the production code currently mishandles)
 */

const https = require('node:https');
const http = require('node:http');
const dns = require('node:dns').promises;
const { performance } = require('node:perf_hooks');

const TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 10;

function nowMs() {
  return performance.now();
}

function ms(value) {
  return `${value.toFixed(0)}ms`;
}

async function resolveDns(host) {
  const t0 = nowMs();
  try {
    const records = await dns.lookup(host, { all: true });
    return { ok: true, durationMs: nowMs() - t0, records };
  } catch (err) {
    return { ok: false, durationMs: nowMs() - t0, error: err };
  }
}

function probeOnce(url, hopIndex) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const t = {
      start: nowMs(),
      socket: null,
      lookup: null,
      connect: null,
      secureConnect: null,
      response: null,
      firstByte: null,
      end: null,
    };

    let bytes = 0;
    let aborted = false;

    const req = client.get(
      url,
      {
        headers: { 'User-Agent': 'Sudowork-AssistantHub/1.0' },
      },
      (res) => {
        t.response = nowMs();

        const status = res.statusCode || 0;
        const location = res.headers.location || null;

        // Drain & ignore body on redirect (matches what the production code SHOULD do)
        if (status >= 300 && status < 400 && location) {
          res.resume(); // drain
          res.on('end', () => {
            resolve({
              hop: hopIndex,
              url,
              status,
              location,
              timings: t,
              headers: res.headers,
              bytes: 0,
              redirected: true,
            });
          });
          return;
        }

        res.on('data', (chunk) => {
          if (t.firstByte === null) t.firstByte = nowMs();
          bytes += chunk.length;
        });
        res.on('end', () => {
          t.end = nowMs();
          resolve({
            hop: hopIndex,
            url,
            status,
            location: null,
            timings: t,
            headers: res.headers,
            bytes,
            redirected: false,
          });
        });
        res.on('error', (err) => {
          t.end = nowMs();
          resolve({
            hop: hopIndex,
            url,
            status,
            error: err,
            timings: t,
            bytes,
          });
        });
      },
    );

    req.on('socket', (socket) => {
      t.socket = nowMs();
      socket.on('lookup', () => {
        t.lookup = nowMs();
      });
      socket.on('connect', () => {
        t.connect = nowMs();
      });
      socket.on('secureConnect', () => {
        t.secureConnect = nowMs();
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      aborted = true;
      req.destroy(new Error(`Download timeout (${TIMEOUT_MS}ms idle)`));
    });

    req.on('error', (err) => {
      if (!t.end) t.end = nowMs();
      resolve({
        hop: hopIndex,
        url,
        error: err,
        aborted,
        timings: t,
        bytes,
      });
    });
  });
}

function printTimings(label, t) {
  const start = t.start;
  const rel = (x) => (x == null ? '   -   ' : ms(x - start).padStart(7));
  console.log(`[${label}] socket=${rel(t.socket)}  lookup=${rel(t.lookup)}  tcp=${rel(t.connect)}  tls=${rel(t.secureConnect)}  resp=${rel(t.response)}  1stByte=${rel(t.firstByte)}  end=${rel(t.end)}`);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/probe-download.js <url>');
    process.exit(2);
  }

  const parsed = new URL(url);
  console.log(`\n=== Probing ${url} ===`);
  console.log(`host=${parsed.host}  protocol=${parsed.protocol}\n`);

  console.log('--- DNS ---');
  const dnsResult = await resolveDns(parsed.hostname);
  if (dnsResult.ok) {
    console.log(`OK in ${ms(dnsResult.durationMs)}`);
    for (const r of dnsResult.records) console.log(`  ${r.family === 6 ? 'AAAA' : 'A'}  ${r.address}`);
  } else {
    console.log(`FAIL in ${ms(dnsResult.durationMs)}: ${dnsResult.error.code} ${dnsResult.error.message}`);
    process.exit(1);
  }

  console.log('\n--- HTTP (follows up to 10 redirects, including 307/308) ---');
  let currentUrl = url;
  const allHops = [];
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const r = await probeOnce(currentUrl, hop);
    allHops.push(r);

    if (r.error) {
      console.log(`\n[hop ${hop}] ${r.url}`);
      printTimings(`hop${hop}`, r.timings);
      console.log(`  ERROR: ${r.error.code || ''} ${r.error.message}`);
      console.log(`  aborted_by_timeout=${!!r.aborted}  bytes=${r.bytes}`);
      process.exit(1);
    }

    console.log(`\n[hop ${hop}] ${r.url}`);
    console.log(`  status=${r.status}  bytes=${r.bytes}  content-length=${r.headers['content-length'] ?? '-'}  content-type=${r.headers['content-type'] ?? '-'}`);
    printTimings(`hop${hop}`, r.timings);

    if (r.redirected) {
      console.log(`  → redirect to ${r.location}`);
      currentUrl = new URL(r.location, currentUrl).toString();
      continue;
    }
    break;
  }

  const last = allHops[allHops.length - 1];
  const totalMs = last.timings.end - allHops[0].timings.start;
  const mbPerSec = last.bytes / 1024 / 1024 / (totalMs / 1000);
  console.log(`\n=== Summary ===`);
  console.log(`hops=${allHops.length}  final_status=${last.status}  bytes=${last.bytes}  total=${ms(totalMs)}  throughput=${mbPerSec.toFixed(2)} MB/s`);
}

main().catch((err) => {
  console.error('Unexpected:', err);
  process.exit(1);
});
