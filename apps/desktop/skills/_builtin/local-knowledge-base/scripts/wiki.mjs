#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DISCOVERY_PATH = path.join(os.homedir(), '.nexus', 'sudowork', 'local-kb', 'skill-server.json');
const REQUEST_TIMEOUT_MS = 5000;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'list') {
    const data = await request('/v1/wiki/list');
    printList(data.spaces || []);
    return;
  }

  if (command === 'search') {
    const { spaceId, query } = parseSearchArgs(args);
    if (!query) die('Usage: node scripts/wiki.mjs search "<query>" OR node scripts/wiki.mjs search <spaceId> "<query>"');
    const scope = spaceId ? `spaceId=${encodeURIComponent(spaceId)}&` : '';
    const data = await request(`/v1/wiki/search?${scope}query=${encodeURIComponent(query)}`);
    printSearch(data);
    return;
  }

  if (command === 'read') {
    const parsed = parseReadArgs(args);
    if (parsed.fileFlag && !parsed.file) die('Usage: node scripts/wiki.mjs read --file <file> <spaceId>');
    if (parsed.docFlag && !parsed.docId) die('Usage: node scripts/wiki.mjs read --doc <docId> <spaceId>');
    if (!parsed.spaceId) die('Usage: node scripts/wiki.mjs read [--list] [--file <file>] <spaceId>');
    if (parsed.list) {
      const data = await request(`/v1/wiki/read?spaceId=${encodeURIComponent(parsed.spaceId)}&list=1`);
      console.log((data.files || []).join('\n'));
      return;
    }
    const suffix = parsed.docId ? `&docId=${encodeURIComponent(parsed.docId)}` : parsed.file ? `&file=${encodeURIComponent(parsed.file)}` : '';
    const data = await request(`/v1/wiki/read?spaceId=${encodeURIComponent(parsed.spaceId)}${suffix}`);
    console.log(data.content || '');
    return;
  }

  if (command === 'metadata') {
    const [spaceId] = args;
    if (!spaceId) die('Usage: node scripts/wiki.mjs metadata <spaceId>');
    const data = await request(`/v1/wiki/metadata?spaceId=${encodeURIComponent(spaceId)}`);
    printMetadata(data);
    return;
  }

  die(`Unknown command: ${command}`);
}

async function request(pathname) {
  const discovery = await readDiscovery();
  const url = `http://${discovery.host}:${discovery.port}${pathname}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${discovery.token}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Invalid response from local KB service (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data.error || `Local KB service returned ${res.status}`);
  }
  return data;
}

async function readDiscovery() {
  try {
    const discovery = JSON.parse(await fs.readFile(DISCOVERY_PATH, 'utf8'));
    if (!isValidDiscovery(discovery)) {
      throw new Error('invalid discovery file');
    }
    return discovery;
  } catch {
    throw new Error(`Sudowork local knowledge base service is not running or not ready: ${DISCOVERY_PATH}`);
  }
}

function parseReadArgs(args) {
  const parsed = { list: false, fileFlag: false, file: '', docFlag: false, docId: '', spaceId: '' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--list') {
      parsed.list = true;
      continue;
    }
    if (arg === '--file') {
      parsed.fileFlag = true;
      parsed.file = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--doc') {
      parsed.docFlag = true;
      parsed.docId = args[i + 1] || '';
      i += 1;
      continue;
    }
    parsed.spaceId = arg;
  }
  return parsed;
}

function isValidDiscovery(value) {
  if (!value || typeof value !== 'object') return false;
  if (!['127.0.0.1', 'localhost', '::1'].includes(value.host)) return false;
  if (!Number.isInteger(value.port) || value.port <= 0 || value.port > 65535) return false;
  return typeof value.token === 'string' && value.token.length >= 16;
}

function parseSearchArgs(args) {
  if (args.length === 0) return { spaceId: '', query: '' };
  if (args[0] === '--all') return { spaceId: '', query: args.slice(1).join(' ').trim() };
  if (args.length === 1) return { spaceId: '', query: args[0].trim() };
  return { spaceId: args[0], query: args.slice(1).join(' ').trim() };
}

function printList(spaces) {
  if (spaces.length === 0) {
    console.log('No available local knowledge bases.');
    return;
  }
  console.log(['spaceId\tname\tretrievalMode\tdescription'].join('\n'));
  for (const space of spaces) {
    console.log([space.id, space.name, space.retrievalMode, space.description || ''].join('\t'));
  }
}

function printSearch(result) {
  const hits = result.hits || [];
  if (hits.length === 0) {
    console.log('No matching local knowledge base content found.');
    return;
  }
  console.log(`mode: ${result.mode || 'grep-only'}`);
  for (const hit of hits.slice(0, 20)) {
    console.log(`\n${hit.file}:${hit.lineNo} [${hit.source}] ${hit.title}`);
    console.log(hit.text);
    if (hit.docId) {
      console.log(`docId: ${hit.docId}`);
      console.log(`source: local-kb://${encodeURIComponent(hit.spaceId)}/doc/${encodeURIComponent(hit.docId)}:${hit.lineNo}`);
    } else {
      console.log(`source: local-kb://${encodeURIComponent(hit.spaceId)}/${encodeURIComponent(hit.file)}:${hit.lineNo}`);
    }
  }
}

function printMetadata(data) {
  const space = data.space || {};
  console.log(`id: ${space.id || ''}`);
  console.log(`name: ${space.name || ''}`);
  console.log(`status: ${space.buildStatus || ''}`);
  console.log(`retrievalMode: ${space.retrievalMode || ''}`);
  console.log(`fileCount: ${data.fileCount ?? 0}`);
  console.log(`totalBytes: ${data.totalBytes ?? 0}`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/wiki.mjs list
  node scripts/wiki.mjs search "<query>"
  node scripts/wiki.mjs search <spaceId> "<query>"
  node scripts/wiki.mjs read [--list] [--file <file>] [--doc <docId>] <spaceId>
  node scripts/wiki.mjs metadata <spaceId>`);
}

function die(message) {
  console.error(message);
  process.exit(1);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
