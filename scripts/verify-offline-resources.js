#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const yauzl = require('yauzl');
const brand = require('../brand.config.json');
const runtimeVersions = require('../src/shared/runtime-versions.json');
const runtimeSha256 = require('../src/shared/runtime-sha256.json');
const scodePlatforms = require('../src/shared/scode-platforms.json');
const { getClusterArtifact, getClusterBinary } = require('./plugin-naming.js');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const NODE_VERSION = '22.22.2';
const MIN_BYTES = 100 * 1024;

function nodeResourceName(platform, arch) {
  return `node-${platform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
}

function scodeResourceName(platform, arch) {
  const spec = scodePlatforms.platforms[`${platform}-${arch}`];
  if (!spec) throw new Error(`Unsupported Sudocode target: ${platform}-${arch}`);
  return `v${runtimeVersions.scode}-scode-${spec.os}-${spec.arch}${spec.ext}`;
}

function nexusResourceName(platform, arch) {
  const artifact = getClusterArtifact(platform, arch);
  if (!artifact) throw new Error(`Unsupported Nexus target: ${platform}-${arch}`);
  return `v${runtimeVersions['nexus-vfs']}-${artifact}`;
}

function assertResource(name, expectedSha) {
  const filePath = path.join(RESOURCES_DIR, name);
  if (!fs.existsSync(filePath)) throw new Error(`Offline build aborted: ${name} is missing`);
  const size = fs.statSync(filePath).size;
  if (size < MIN_BYTES) throw new Error(`Offline build aborted: ${name} is invalid (${size} bytes)`);
  if (expectedSha) {
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (actualSha !== expectedSha) throw new Error(`Offline build aborted: ${name} SHA256 mismatch`);
  }
  return filePath;
}

function listZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Invalid zip archive'));
      const entries = [];
      zip.readEntry();
      zip.on('entry', (entry) => {
        entries.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
    });
  });
}

async function listArchive(filePath) {
  if (filePath.endsWith('.zip')) return listZip(filePath);
  const entries = [];
  await tar.t({ file: filePath, onentry: (entry) => entries.push(entry.path) });
  return entries;
}

async function assertArchiveContains(filePath, expectedSuffix) {
  const normalizedSuffix = expectedSuffix.replaceAll('\\', '/');
  const entries = await listArchive(filePath);
  if (!entries.some((entry) => entry.replaceAll('\\', '/').endsWith(normalizedSuffix))) {
    throw new Error(`Offline build aborted: ${path.basename(filePath)} does not contain ${expectedSuffix}`);
  }
}

async function verifyTarget(target) {
  const [platform, arch] = target.split('-');
  if (!platform || !arch) throw new Error(`Invalid target: ${target}`);
  const nodeName = nodeResourceName(platform, arch);
  const scodeName = scodeResourceName(platform, arch);
  const nexusName = nexusResourceName(platform, arch);
  const nodePath = assertResource(nodeName);
  const scodePath = assertResource(scodeName);
  const nexusPath = assertResource(nexusName, runtimeSha256[nexusName.replace(/^v[^-]+-/, '')]);

  const nodePlatform = platform === 'win32' ? 'win' : platform;
  const nodeBinary = platform === 'win32' ? `node-v${NODE_VERSION}-${nodePlatform}-${arch}/node.exe` : `node-v${NODE_VERSION}-${nodePlatform}-${arch}/bin/node`;
  const scodeSpec = scodePlatforms.platforms[`${platform}-${arch}`];
  const scodeBinary = `scode-${scodeSpec.os}-${scodeSpec.arch}/${platform === 'win32' ? 'scode.exe' : 'scode'}`;
  await Promise.all([assertArchiveContains(nodePath, nodeBinary), assertArchiveContains(scodePath, scodeBinary), assertArchiveContains(nexusPath, getClusterBinary(platform))]);
  console.log(`✓ Offline resources verified: ${target}`);
}

async function main() {
  if (brand.BUILD_OFFLINE !== true) {
    console.log('Online build: offline resource verification skipped');
    return;
  }
  const targets = process.argv.slice(2);
  if (targets.length === 0) targets.push(`${process.platform}-${process.arch}`);
  for (const target of targets) await verifyTarget(target);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
