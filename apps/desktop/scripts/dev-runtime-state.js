const fs = require('fs');
const path = require('path');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
// Tracks dev-time runtime assets whose filenames do not fully encode version metadata.
// Nexus is intentionally excluded because its resource filename already includes version.
const DEV_RUNTIME_STATE_PATH = path.join(RESOURCES_DIR, '.dev-runtime-versions.json');

function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, '');
}

function readLocalDevRuntimeVersions() {
  try {
    return JSON.parse(fs.readFileSync(DEV_RUNTIME_STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeLocalDevRuntimeVersions(state) {
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  fs.writeFileSync(DEV_RUNTIME_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

function updateLocalDevRuntimeVersion(name, version) {
  const state = readLocalDevRuntimeVersions();
  state[name] = {
    version: normalizeVersion(version),
    platform: process.platform,
    arch: process.arch,
    updatedAt: new Date().toISOString(),
  };
  writeLocalDevRuntimeVersions(state);
}

function clearLocalDevRuntimeVersion(name) {
  const state = readLocalDevRuntimeVersions();
  if (!(name in state)) return;

  delete state[name];

  if (Object.keys(state).length === 0) {
    try {
      fs.unlinkSync(DEV_RUNTIME_STATE_PATH);
    } catch {}
    return;
  }

  writeLocalDevRuntimeVersions(state);
}

module.exports = {
  normalizeVersion,
  readLocalDevRuntimeVersions,
  updateLocalDevRuntimeVersion,
  clearLocalDevRuntimeVersion,
};
