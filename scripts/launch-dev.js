#!/usr/bin/env node
/**
 * Launch or stop Sudowork dev instance.
 *
 * Usage:
 *   node scripts/launch-dev.js start   # start dev server + Electron
 *   node scripts/launch-dev.js stop    # graceful shutdown via CDP
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// ── CLI ──

const command = process.argv[2];

if (!command || !['start', 'stop'].includes(command)) {
  console.error(`Usage: node scripts/launch-dev.js <command>

Commands:
  start   Start Sudowork in dev mode (auto-detects available ports)
  stop    Gracefully stop running Sudowork instance via CDP`);
  process.exit(1);
}

// ── Shared ──

function findAvailablePort(preferred, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    try {
      execSync(
        `node -e "const s=require('net').createServer();s.listen(${port},'127.0.0.1',()=>{s.close();process.exit(0)});s.on('error',()=>process.exit(1))"`,
        { timeout: 2000, stdio: 'ignore' }
      );
      return port;
    } catch {
      // Port unavailable
    }
  }
  throw new Error(`No available port in range ${preferred}-${preferred + maxAttempts - 1}`);
}

function httpGet(url, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

// ── stop ──

async function stop() {
  const startPort = parseInt(process.env.NEXUS_CDP_PORT || '9230', 10);
  console.log(`Looking for Sudowork CDP starting from port ${startPort}...`);

  let cdpPort = null;
  for (let p = startPort; p < startPort + 20; p++) {
    try {
      const data = await httpGet(`http://127.0.0.1:${p}/json/version`);
      if (data.includes('webSocketDebuggerUrl')) {
        cdpPort = p;
        break;
      }
    } catch { /* not responding */ }
  }

  if (!cdpPort) {
    console.log('No running Sudowork instance found.');
    return;
  }

  console.log(`Found Sudowork on CDP port ${cdpPort}`);

  try {
    const versionData = JSON.parse(await httpGet(`http://127.0.0.1:${cdpPort}/json/version`));
    const wsUrl = versionData.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No WebSocket URL');

    let WebSocket;
    try { WebSocket = require('ws'); } catch {
      console.log('ws module not available. Close the window manually.');
      return;
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        console.log('Sent Browser.close() — shutting down');
        setTimeout(() => { ws.close(); resolve(); }, 1000);
      });
      ws.on('error', () => {
        console.log('WebSocket error. Close the window manually.');
        resolve();
      });
    });
  } catch (e) {
    console.log(`Could not close via CDP: ${e.message}`);
  }
}

// ── prereq validation ──

// `bun install` (autorun on fresh clone) does NOT cover three things that
// `bun run start` silently depends on. Each surfaces as a confusing
// runtime crash deep inside main-process bootstrap if missing. Detect up
// front and print a single copy-pasteable fix instead.
//
//   (a) napi binding (native/nexus-napi/nexus-napi.node) — built by
//       `bun run build:native`, requires Rust toolchain.
//   (b) Electron-ABI-matched native modules (better-sqlite3, node-pty).
//       Rebuilt by `bunx electron-builder install-app-deps`. The crash
//       this prevents is `Could not locate the bindings file ...
//       better_sqlite3.node` after a fresh `bun install` skipped
//       postinstall on a slow link.
//   (c) On Windows, MSVC env (vcvars64.bat sourced). Only required when
//       (a) or (b) need rebuilding; an already-built tree boots fine
//       without it. Skipped via SUDOWORK_SKIP_PREREQ_CHECK=1 for the
//       rare case where you know the local tree is good and the
//       detector is being overcautious.
function validatePrereqs() {
  if (process.env.SUDOWORK_SKIP_PREREQ_CHECK === '1') return;

  const missing = [];

  const napiPath = path.join(REPO_ROOT, 'native', 'nexus-napi', 'nexus-napi.node');
  if (!fs.existsSync(napiPath)) {
    missing.push({
      what: 'napi binding',
      detail: `${path.relative(REPO_ROOT, napiPath)} not found`,
      fix: 'bun run build:native',
    });
  }

  // Electron-ABI native modules: the only reliable existence signal is
  // the rebuilt `.node` file. Don't compare mtimes against electron's
  // package.json — `bun install` refreshes package.json mtimes without
  // touching the rebuild, producing false positives on every clean
  // tree. Existence catches the actual regression we hit (fresh clone
  // crashing with `Could not locate the bindings file ...
  // better_sqlite3.node`); ABI-version skew between an old build and a
  // bumped electron is rare in practice and would surface as a
  // runtime crash with a clear message, which is acceptable.
  const sqliteNode = path.join(REPO_ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(sqliteNode)) {
    missing.push({
      what: 'Electron-ABI native module',
      detail: `${path.relative(REPO_ROOT, sqliteNode)} not found`,
      fix: 'bunx electron-builder install-app-deps',
    });
  }

  // MSVC env only matters on Windows AND only if (a)/(b) actually
  // need rebuilding. If the tree is already built, vcvars64.bat being
  // un-sourced doesn't affect `bun run start`.
  if (process.platform === 'win32' && missing.length > 0) {
    const haveMsvc = Boolean(process.env.VCINSTALLDIR) || /\\vc\\/i.test(process.env.INCLUDE || '');
    if (!haveMsvc) {
      missing.push({
        what: 'MSVC env',
        detail: 'vcvars64.bat not sourced (required to rebuild native modules on Windows)',
        fix: 'open a "Developer Command Prompt for VS" OR `call <path-to>\\vcvars64.bat` before the rebuild commands',
      });
    }
  }

  if (missing.length === 0) return;

  const lines = ['', 'sudowork: missing prereq(s) for `bun run start`:'];
  for (const m of missing) lines.push(`  ✗ ${m.what} (${m.detail})`);
  lines.push('', 'Fix:');
  for (const m of missing) lines.push(`  - ${m.fix}`);
  lines.push('  - bun run start  # re-launch after the steps above');
  lines.push('');
  lines.push('Bypass (only if you know the tree is already built): SUDOWORK_SKIP_PREREQ_CHECK=1 bun run start');
  console.error(lines.join('\n'));
  process.exit(1);
}

// ── start ──

function start() {
  validatePrereqs();
  const passthroughArgs = process.argv.slice(3);
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  // Auto-detect Vite renderer port
  const preferredVite = 5173;
  let vitePort;
  try {
    vitePort = findAvailablePort(preferredVite, 30);
  } catch {
    vitePort = findAvailablePort(5600, 20);
  }
  if (vitePort !== preferredVite) {
    console.log(`Port ${preferredVite} unavailable (Windows port reservation), using ${vitePort}`);
  }
  cleanEnv.VITE_DEV_SERVER_PORT = String(vitePort);

  // Auto-detect CDP port
  const preferredCdp = parseInt(cleanEnv.NEXUS_CDP_PORT || '9230', 10);
  let cdpPort;
  try {
    cdpPort = findAvailablePort(preferredCdp, 20);
  } catch {
    cdpPort = findAvailablePort(9250, 20);
  }
  if (cdpPort !== preferredCdp) {
    console.log(`CDP port ${preferredCdp} unavailable, using ${cdpPort}`);
  }
  cleanEnv.NEXUS_CDP_PORT = String(cdpPort);

  cleanEnv.NODE_OPTIONS = (cleanEnv.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

  console.log(`Launching electron-vite dev (renderer: ${vitePort}, CDP: ${cdpPort})...`);

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const devArgs = ['electron-vite', 'dev'];
  if (passthroughArgs.length > 0) {
    devArgs.push('--', ...passthroughArgs);
  }

  const result = spawnSync(npxCommand, devArgs, {
    stdio: 'inherit',
    env: cleanEnv,
    cwd: path.join(__dirname, '..'),
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

// ── Main ──

if (command === 'stop') {
  stop().catch(console.error);
} else {
  start();
}
