/**
 * Integration test — nexus-vfs SHA256 SSOT contract.
 *
 * Background: pre-#918 the same SHA table lived in three places —
 * `scripts/download-nexus-vfs.js` (build-time downloader),
 * `DynamicNexusVfsService.ts` (runtime cluster re-installer), and
 * `VaultPluginInstaller.ts` (runtime vault re-installer). PR #918
 * bumped the script's table to ABI v3 SHAs but left the two runtime
 * tables stuck on the v0.2.2 / v0.1.3 values, so every Mac install
 * blew up with `nexus-vfs SHA256 mismatch for ...` at the runtime
 * verifier even though the script had downloaded the correct bytes.
 *
 * Fix: move the SHA table into `src/shared/runtime-sha256.json` and
 * have all three consumers import from there. This test enforces
 * that contract — no SHA-shaped literal lives in the source files,
 * the JSON is the single hand-edited source.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHA_HEX_64 = /\b[a-f0-9]{64}\b/;

const CONSUMERS = ['scripts/download-nexus-vfs.js', 'src/process/services/nexus-vfs/DynamicNexusVfsService.ts', 'src/process/services/nexus-vfs/VaultPluginInstaller.ts'];

describe('nexus-vfs SHA256 SSOT', () => {
  it('the canonical JSON lives at src/shared/runtime-sha256.json', () => {
    // The file's existence is half the contract; the other half is
    // that every other consumer imports from this path. The next
    // test enforces no inline literals — together that means a SHA
    // bump touches one file, not three.
    const jsonPath = path.join(REPO_ROOT, 'src/shared/runtime-sha256.json');
    expect(fs.existsSync(jsonPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, string>;
    // Spot-check: every key (excluding doc keys) is an artifact filename
    // and every value is a 64-char lowercase hex SHA.
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('_')) continue;
      expect(key).toMatch(/^(nexusd-cluster|nexus-vault|nexus-local-connector|nexus-fuse-plugin)-.+\.(tar\.gz|zip)$/);
      expect(value).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  for (const consumer of CONSUMERS) {
    it(`${consumer} contains no inline 64-char SHA literal — must import from runtime-sha256.json`, () => {
      // Why a regex over the source: the literals were tolerable when
      // there was exactly one of them per artifact and they were
      // co-located with a "keep in sync" comment that nobody enforced.
      // The class of bug PR #918 introduced is "bump one place, forget
      // the other two"; the only test that catches that bug is one
      // that refuses to let SHA literals live in source files at all.
      const src = fs.readFileSync(path.join(REPO_ROOT, consumer), 'utf-8');
      const match = src.match(SHA_HEX_64);
      if (match) {
        // Surface the first offender so the failure message points at
        // the literal to delete, not just "this file is dirty".
        throw new Error(`${consumer} contains inline SHA literal "${match[0]}". Move it to src/shared/runtime-sha256.json and consume via import.`);
      }
      // Sanity check: ensure the file actually imports / requires the
      // canonical JSON (a passing regex check would otherwise be
      // vacuously true on an empty file).
      expect(src).toMatch(/runtime-sha256(\.json)?['"]/);
    });
  }

  it('every artifact the naming SSOT knows how to name has a SHA entry in the JSON', () => {
    const sha = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/shared/runtime-sha256.json'), 'utf-8')) as Record<string, string>;
    // Source of truth for "what archives can this codebase ask to download"
    // is the plugin-naming.js SSOT module. Enumerating from there (rather
    // than regex-ing the download script's source) lets the assertion stay
    // accurate after the script was refactored to compute names via helpers
    // instead of inlining them. The invariant is unchanged: every name the
    // codebase can produce must have a SHA entry, or runtime verification
    // will fail-closed on download.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const naming = require(path.join(REPO_ROOT, 'scripts/plugin-naming.js')) as {
      allKnownArchives: () => string[];
    };
    const archives = naming.allKnownArchives();
    expect(archives.length).toBeGreaterThan(0);
    const missing = Array.from(new Set(archives)).filter((a) => !(a in sha));
    expect(missing, `Missing SHA entries for ${missing.join(', ')}`).toEqual([]);
  });

  it('the naming SSOT module itself contains no inline SHA literal', () => {
    // Symmetric to the CONSUMERS check — plugin-naming.js is a naming SSOT
    // and must not creep into being a SHA SSOT too. Verifies the boundary
    // stays clean: names live here, hashes live in runtime-sha256.json.
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/plugin-naming.js'), 'utf-8');
    const match = src.match(SHA_HEX_64);
    if (match) {
      throw new Error(`scripts/plugin-naming.js contains inline SHA literal "${match[0]}". Hashes belong in runtime-sha256.json.`);
    }
  });
});
