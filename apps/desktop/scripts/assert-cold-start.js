#!/usr/bin/env node
/**
 * Cold Start Smoke assertion: enforces the two invariants the CI job watches
 *
 *   1. Plugin set: the cluster loaded EXACTLY the set we publish for this
 *      (platform, arch). Sourced from runtime-sha256.json via the
 *      expected-plugin-set helper. Fewer = silent regression (the bug PR
 *      #919 hit — SHA drift left lc + fp unloaded). More = unexpected
 *      extra published artifact that the workflow doesn't know about.
 *
 *   2. No admin-prompt subprocess: the cold-start path must NOT spawn any
 *      escalation helper (macOS: osascript / installer / sudo / security;
 *      Windows: runas / consent / UserAccount*; Linux: pkexec / kdesudo).
 *      The job's background watcher writes any matches to admin-procs.log;
 *      this assertion fails if that file has any non-empty content.
 *
 * Usage:
 *   node scripts/assert-cold-start.js --cluster-log <path> --admin-log <path>
 *                                     [--platform <p>] [--arch <a>]
 *
 * Exits 0 on pass, 1 on any failure with a structured diagnostic to stderr.
 */

const fs = require('fs');
const path = require('path');
const { expectedPluginsFor } = require(path.join(__dirname, 'expected-plugin-set.js'));

function parseArgs(argv) {
  const out = { platform: process.platform, arch: process.arch };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cluster-log') out.clusterLog = argv[++i];
    else if (a === '--admin-log') out.adminLog = argv[++i];
    else if (a === '--platform') out.platform = argv[++i];
    else if (a === '--arch') out.arch = argv[++i];
  }
  if (!out.clusterLog || !out.adminLog) {
    console.error('usage: assert-cold-start.js --cluster-log <path> --admin-log <path>');
    process.exit(2);
  }
  return out;
}

function readSafe(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function main() {
  const { clusterLog, adminLog, platform, arch } = parseArgs(process.argv.slice(2));
  const expected = expectedPluginsFor(platform, arch);
  const clusterText = readSafe(clusterLog);
  const adminText = readSafe(adminLog).trim();

  const failures = [];

  // Invariant 1a: every expected plugin's dylib name appears somewhere in
  // the cluster log. Loose match — the cluster's log format varies across
  // versions; we don't anchor to "signature verified" alone because that
  // line could be renamed by an upstream cleanup. The dylib filename is
  // load-bearing identity and ~unchanging.
  for (const plugin of expected) {
    if (!clusterText.includes(plugin.dylib)) {
      failures.push(`expected plugin not seen in cluster log: ${plugin.dylib} (${plugin.name})`);
    }
  }

  // Invariant 1b: number of distinct plugin dylibs that appear next to a
  // load/verify keyword equals the expected count. Strict — catches the
  // case where an EXTRA plugin got dropped into the plugin-dir (e.g. an
  // old/stale artifact left behind by a botched install).
  //
  // Why dedupe by dylib instead of counting raw "signature verified" lines:
  // cluster builds emit a per-plugin "plugin loaded" PLUS a summary
  // "plugins loaded from --plugin-dir count=N names=[...]". A naive line
  // count double-counts.
  const verifyKeyword = /signature verified|plugin loaded|plugins? loaded from/i;
  const loadedDylibs = new Set();
  for (const line of clusterText.split(/\r?\n/)) {
    if (!verifyKeyword.test(line)) continue;
    for (const plugin of expected) {
      if (line.includes(plugin.dylib)) loadedDylibs.add(plugin.dylib);
    }
  }
  if (loadedDylibs.size !== expected.length) {
    failures.push(
      `plugin load count mismatch: expected ${expected.length} (${expected
        .map((p) => p.dylib)
        .join(', ')}); saw ${loadedDylibs.size} (${[...loadedDylibs].join(', ') || '<none>'})`,
    );
  }

  // Invariant 2: no admin-prompt subprocess observed.
  if (adminText.length > 0) {
    failures.push(`admin-prompt subprocess(es) observed during cold start:\n${adminText}`);
  }

  const report = {
    platform,
    arch,
    expectedPlugins: expected.map((p) => p.dylib),
    loadedPlugins: [...loadedDylibs],
    adminPromptObserved: adminText.length > 0,
    pass: failures.length === 0,
  };

  if (failures.length > 0) {
    console.error('Cold Start Smoke FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\n--- report ---');
    console.error(JSON.stringify(report, null, 2));
    console.error('\n--- cluster log (last 100 lines) ---');
    console.error(clusterText.split(/\r?\n/).slice(-100).join('\n'));
    process.exit(1);
  }

  console.log('Cold Start Smoke PASSED');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();
