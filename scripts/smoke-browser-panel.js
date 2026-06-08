#!/usr/bin/env node
/**
 * End-to-end smoke test for the browser-panel CDP loop.
 *
 * Drives the HTTP loopback exposed by BrowserPanelHttpServer (the same
 * surface the bundled MCP server uses) so we can verify the full
 * MCP server → main process → CDP → webview chain without launching
 * Claude Code or driving the AI.
 *
 * Pre-flight (manual once, before running this script):
 *   1. sudowork dev is running (`node scripts/launch-dev.js start`).
 *   2. A conversation is open on screen and the right panel's "浏览器"
 *      tab has been clicked at least once so BrowserPanel is mounted.
 *
 * Usage: node scripts/smoke-browser-panel.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execSync, spawn } = require('node:child_process');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ${GREEN}✓${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ${RED}✗${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${CYAN}● ${title}${RESET}`);
}

function discoveryFilePath() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'sudowork', 'sudowork-browser-mcp.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'sudowork', 'sudowork-browser-mcp.json');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'sudowork', 'sudowork-browser-mcp.json');
}

function loadDiscovery() {
  const filePath = discoveryFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function postJson(discovery, routePath, body) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body || {}), 'utf-8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port: discovery.port,
        path: routePath,
        method: 'POST',
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          'content-length': payload.length,
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve({ status: res.statusCode, body: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, body: text });
          }
        });
      },
    );
    req.on('error', (err) => resolve({ error: err.message }));
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
      resolve({ error: 'timeout' });
    });
    req.write(payload);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log(`${CYAN}=== browser-panel CDP smoke test ===${RESET}`);

  // ── 1. Discovery file + loopback ────────────────────────────────────────
  section('1. discovery file + loopback');
  const discovery = loadDiscovery();
  check('discovery file exists', !!discovery, discovery ? discoveryFilePath() : 'not found — sudowork dev not running?');
  if (!discovery) {
    process.exit(1);
  }
  check('discovery has port', typeof discovery.port === 'number', `port=${discovery.port}`);
  check('discovery has token', typeof discovery.token === 'string' && discovery.token.length === 64, `token=${(discovery.token || '').slice(0, 8)}…`);

  // 401 without token
  const unauth = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: discovery.port, path: '/tab/list', method: 'POST' }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
  check('rejects requests without bearer token', unauth === 401, `got ${unauth}`);

  // ── 2. claude mcp registration ──────────────────────────────────────────
  section('2. claude mcp registration');
  try {
    const out = execSync('claude mcp list', { encoding: 'utf-8', timeout: 10_000 });
    const line = out.split('\n').find((l) => l.includes('sudowork-browser')) || '';
    check('sudowork-browser appears in `claude mcp list`', !!line, line.trim());
    check('reports ✓ Connected', /✓\s*Connected/.test(line), line ? line.trim() : '');
  } catch (err) {
    check('claude CLI is callable', false, err.message);
  }

  // ── 3. MCP stdio server: handshake + tool list ──────────────────────────
  section('3. MCP stdio server handshake');
  await new Promise((resolve) => {
    const repoRoot = path.resolve(__dirname, '..');
    const scriptPath = path.join(repoRoot, 'resources', 'sudowork-browser-mcp', 'index.js');
    const child = spawn('node', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let toolListSeen = false;
    const timer = setTimeout(() => {
      child.kill();
      check('stdio handshake responds within 5s', toolListSeen, 'timed out');
      resolve();
    }, 5_000);
    child.stdout.on('data', (data) => {
      buf += data.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result?.serverInfo) {
            check('initialize responds with serverInfo', msg.result.serverInfo.name === 'sudowork-browser', `name=${msg.result.serverInfo.name}`);
          } else if (msg.id === 2 && Array.isArray(msg.result?.tools)) {
            toolListSeen = true;
            const names = msg.result.tools.map((t) => t.name).sort();
            const expected = ['browser_evaluate', 'browser_get_dom_snapshot', 'browser_list_console_messages', 'browser_list_network_requests', 'browser_navigate', 'browser_open', 'browser_take_screenshot'];
            check('tools/list returns the 7 expected tools', JSON.stringify(names) === JSON.stringify(expected), names.join(', '));
            clearTimeout(timer);
            child.kill();
            resolve();
          }
        } catch {
          /* incomplete */
        }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  });

  // ── 4. HTTP routes (require an open BrowserPanel) ──────────────────────
  section('4. CDP-driven HTTP routes');
  const tabsRes = await postJson(discovery, '/tab/list', {});
  if (tabsRes.error) {
    check('/tab/list reachable', false, tabsRes.error);
    process.exit(1);
  }
  check('/tab/list reachable', tabsRes.status === 200);
  check('/tab/list response shape', !!tabsRes.body?.ok && Array.isArray(tabsRes.body.data));
  const tabs = tabsRes.body?.data || [];
  console.log(`    ${DIM}tabs: ${JSON.stringify(tabs)}${RESET}`);
  if (tabs.length === 0) {
    console.log(`    ${YELLOW}⚠  No browser tab open. Skipping CDP-dependent checks.${RESET}`);
    console.log(`    ${YELLOW}   Click into a conversation and open the 浏览器 tab in the right panel.${RESET}`);
  } else {
    const tab = tabs[0];

    // Navigate
    const nav = await postJson(discovery, '/tab/navigate', { url: 'https://example.com/', waitUntil: 'load' });
    check('/tab/navigate ok', nav.body?.ok && nav.body.data?.ok, JSON.stringify(nav.body?.data));
    await sleep(800);

    // Evaluate
    const ev = await postJson(discovery, '/tab/evaluate', { expression: 'JSON.stringify({title:document.title,host:location.host})' });
    check('/tab/evaluate runs JS in the page', ev.body?.ok && ev.body.data?.ok, ev.body?.data?.value);
    const evVal = ev.body?.data?.value;
    const evParsed = typeof evVal === 'string' ? (() => { try { return JSON.parse(evVal); } catch { return null; } })() : null;
    check('evaluate result shows example.com title', evParsed?.host === 'example.com' && /Example/.test(evParsed?.title || ''), JSON.stringify(evParsed));

    // Network
    const net = await postJson(discovery, '/tab/network', { limit: 50 });
    check('/tab/network returns entries', net.body?.ok && Array.isArray(net.body.data) && net.body.data.length > 0, `${net.body?.data?.length || 0} entries`);
    const docEntry = (net.body?.data || []).find((r) => r.url.includes('example.com') && r.type === 'Document');
    check('captured Document response with status code', !!docEntry && typeof docEntry.status === 'number', docEntry ? `${docEntry.status} ${docEntry.url}` : 'no Document entry');

    // Screenshot
    const shot = await postJson(discovery, '/tab/screenshot', { format: 'png' });
    check('/tab/screenshot returns base64 png', shot.body?.ok && typeof shot.body.data?.base64 === 'string' && shot.body.data.base64.length > 1000, `${shot.body?.data?.base64?.length || 0} chars`);

    // DOM snapshot
    const dom = await postJson(discovery, '/tab/dom-snapshot', { selector: 'h1', format: 'innerText' });
    check('/tab/dom-snapshot reads h1 innerText', dom.body?.ok && /Example Domain/.test(dom.body?.data?.snapshot || ''), dom.body?.data?.snapshot);
  }

  // ── 5. Summary ────────────────────────────────────────────────────────
  console.log(`\n${CYAN}=== summary ===${RESET}`);
  console.log(`  ${GREEN}${pass} passed${RESET} / ${fail > 0 ? `${RED}${fail} failed${RESET}` : `${DIM}0 failed${RESET}`}`);
  if (fail > 0) {
    console.log('  failed checks:');
    for (const f of failures) console.log(`    - ${f}`);
    process.exit(1);
  }
})();
