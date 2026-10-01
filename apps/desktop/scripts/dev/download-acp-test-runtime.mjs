/** Download the pinned, published ACP pair into an isolated temporary directory. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const versions = require('../../src/shared/runtime-versions.json');
const hashes = require('../../src/shared/runtime-sha256.json');
const { getClusterArtifact, getClusterBinary } = require('../plugin-naming.js');
const platforms = require('../../src/shared/scode-platforms.json').platforms;
const platform = platforms[`${process.platform}-${process.arch}`];
if (!platform) throw new Error(`Unsupported scode platform: ${process.platform}-${process.arch}`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-acp-artifacts-'));
const artifacts = [
  { repo: 'nexi-lab/nexus', tag: `nexusd-cluster-v${versions['nexusd-cluster']}`, archive: getClusterArtifact(process.platform, process.arch), binary: getClusterBinary(process.platform), variable: 'NEXUS_CLUSTER_BIN' },
  { repo: 'sudoprivacy/sudocode', tag: `v${versions.scode}`, archive: `scode-${platform.os}-${platform.arch}${platform.ext}`, binary: process.platform === 'win32' ? 'scode.exe' : 'scode', variable: 'SCODE_BIN' },
];

function findBinary(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findBinary(full, name);
      if (found) return found;
    }
  }
}

for (const artifact of artifacts) {
  const dir = path.join(root, artifact.variable);
  fs.mkdirSync(dir);
  execFileSync('gh', ['release', 'download', artifact.tag, '--repo', artifact.repo, '--pattern', artifact.archive, '--pattern', 'SHA256SUMS.txt', '--dir', dir], { stdio: 'inherit', timeout: 180_000, windowsHide: true });
  const archivePath = path.join(dir, artifact.archive);
  const sha = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
  const entry = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').split(/\r?\n/).find((line) => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === artifact.archive);
  if (!entry || entry.split(/\s+/)[0] !== sha) throw new Error(`Release SHA256 mismatch: ${artifact.archive}`);
  if (artifact.variable === 'NEXUS_CLUSTER_BIN' && hashes[artifact.archive] !== sha) throw new Error(`runtime-sha256.json mismatch: ${artifact.archive}`);
  execFileSync('tar', ['-xf', archivePath, '-C', dir], { stdio: 'inherit', timeout: 60_000, windowsHide: true });
  const binary = findBinary(dir, artifact.binary);
  if (!binary) throw new Error(`Missing ${artifact.binary} in published archive`);
  const entryLine = `${artifact.variable}=${binary}`;
  console.log(entryLine);
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `${entryLine}\n`);
}
