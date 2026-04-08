#!/usr/bin/env node
/**
 * Launch or stop Sudowork dev instance.
 *
 * Usage:
 *   node scripts/launch-dev.js start   # start dev server + Electron
 *   node scripts/launch-dev.js stop    # graceful shutdown via CDP
 */

const { execSync, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const runtimeVersions = require('../src/shared/runtime-versions.json');
const { normalizeVersion, readLocalDevRuntimeVersions } = require('./dev-runtime-state');

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

function isStateCurrent(entry, expectedVersion) {
  if (!entry || typeof entry !== 'object') return false;

  return (
    normalizeVersion(entry.version) === normalizeVersion(expectedVersion) &&
    entry.platform === process.platform &&
    entry.arch === process.arch
  );
}

function ensureBundledRuntimeAsset({ name, archivePath, expectedVersion, downloadScript }) {
  const archiveExists = fs.existsSync(archivePath);
  const state = readLocalDevRuntimeVersions();
  const entry = state[name];
  const stateCurrent = isStateCurrent(entry, expectedVersion);

  if (archiveExists && stateCurrent) {
    return;
  }

  const reason = !archiveExists
    ? 'archive missing'
    : entry
      ? `version/platform mismatch (expected ${process.platform}-${process.arch}@${expectedVersion})`
      : 'local version state missing';

  console.log(`[dev-runtime] Refreshing ${name}: ${reason}`);

  const result = spawnSync('node', [downloadScript, '--force'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Failed to refresh ${name} resource`);
  }
}

function ensureDevRuntimeResources() {
  const resourcesDir = path.join(__dirname, '..', 'resources');

  ensureBundledRuntimeAsset({
    name: 'openclaw',
    archivePath: path.join(resourcesDir, 'openclaw.tgz'),
    expectedVersion: runtimeVersions.sudoclaw,
    downloadScript: path.join('scripts', 'download-openclaw.js'),
  });

  const nexusdFilename = process.platform === 'win32' ? 'nexusd.exe' : 'nexusd';
  ensureBundledRuntimeAsset({
    name: 'nexus',
    archivePath: path.join(resourcesDir, nexusdFilename),
    expectedVersion: runtimeVersions.nexus,
    downloadScript: path.join('scripts', 'download-nexus.js'),
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

// ── start ──

function start() {
  const passthroughArgs = process.argv.slice(3);
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  ensureDevRuntimeResources();

  // Auto-detect Vite renderer port
  const preferredVite = 5173;
  let vitePort;
  try {
    vitePort = findAvailablePort(preferredVite, 30);
  } catch {
    vitePort = findAvailablePort(5500, 20);
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
