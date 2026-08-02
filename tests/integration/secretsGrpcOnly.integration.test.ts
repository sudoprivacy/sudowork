/**
 * Static guard: secrets MUST go through gRPC, not HTTP.
 *
 * Context: v0.2.7 (cut 2026-06-06) shipped the old HTTP `SecretStoreClient`
 * → `fetch('http://localhost:12022/api/v2/secrets')`. nexusd-cluster on
 * :12022 is gRPC-only (intentional architecture — see DynamicNexusVfsService
 * docstring + nexus-vfs design); HTTP/1.1 requests get ECONNRESET, surfacing
 * to skill callers as `fetch failed` 500. PR #733 (commits a0c23096 +
 * 77e10f27 + dad79af1 + 97a1eea4 + 013a2c24 + 1187181e + f6c02d91 +
 * 63c4fb56) migrated to `NexusSecretClient` (gRPC via napi NexusGrpcClient).
 *
 * The functional test `tests/integration/secrets-grpc.integration.test.ts`
 * + unit tests under `tests/unit/secrets/` verify gRPC works end-to-end —
 * but they would still pass if someone added a SECOND code path that uses
 * HTTP (e.g., a "fallback" or "the gRPC path doesn't expose X so let me
 * just fetch directly"). This file is the architectural guard that pins
 * the invariant statically, so the regression class is caught at PR review
 * time rather than after a release ships and an external user hits it.
 *
 * Real incident: user 进二 hit this on v0.2.7 (could not save API key →
 * fell back to credits → ran out of credits → reported bug). Fix shipped
 * in v0.2.8.
 *
 * If you need to add a new secrets call path, route it through
 * `getSecretStore()` (see `src/common/nexus/secret-store.ts`). Online builds
 * delegate to NexusSecretClient over gRPC; offline builds use safeStorage.
 * Do NOT introduce a parallel HTTP path. If gRPC is missing a method,
 * extend `password-vault.<method>` dispatch upstream in nexi-lab/nexus
 * + regenerate the protobuf, don't shortcut through HTTP.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Files allowed to mention the dead HTTP secrets surface — this test file
// itself (we explain the regression class in the doc above) + the dead
// `fetch-client.ts` and its doc neighbors (scheduled for cleanup in a
// follow-up PR; still in tree but verified zero callers via grep).
const HTTP_SECRETS_MENTION_ALLOWLIST = new Set([
  // The grep walks src/ which excludes tests by default; explicit allowlist
  // covers source files that legitimately reference the legacy URL (e.g. in
  // docstrings explaining the migration).
]);

/** Recursively yield every .ts/.tsx file under `dir`, skipping node_modules
 *  + generated/ + the tests tree (only source code is gated). */
function* walkSourceFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'generated') continue;
      yield* walkSourceFiles(full);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

describe('Secrets must go through gRPC — static architectural guard', () => {
  it('authProxy secretsApi.ts uses the unified Secret Store for all CRUD handlers', () => {
    const secretsApi = readSrc('src/process/services/authProxy/secretsApi.ts');
    expect(secretsApi).toMatch(/from ['"]@common\/nexus\/secret-store['"]/);

    const secretStore = readSrc('src/common/nexus/secret-store.ts');
    expect(secretStore).toMatch(/new NexusVaultSecretStore\(getNexusSecretClient\(\)\)/);
  });

  it('authProxy secretsApi.ts does NOT call any HTTP /api/v2/secrets endpoint', () => {
    // The exact failure mode v0.2.7 shipped: a `fetch` to the HTTP secrets
    // path. Reject any reintroduction.
    const secretsApi = readSrc('src/process/services/authProxy/secretsApi.ts');
    expect(secretsApi).not.toMatch(/\/api\/v2\/secrets/);
    expect(secretsApi).not.toMatch(/\bfetch\s*\(/);
    expect(secretsApi).not.toMatch(/\bFetchClient\b/);
    expect(secretsApi).not.toMatch(/\bSecretStoreClient\b/);
  });

  it('no source file under src/ defines, imports, or instantiates `SecretStoreClient`', () => {
    // PR #733 deleted the class. Any reappearance as actual code — class
    // definition, import binding, `new` instantiation, or inheritance —
    // is the regression we're guarding against. Walk every .ts/.tsx under
    // src/ rather than grepping a fixed file list, so a sneaky
    // re-introduction in a new location still trips this.
    //
    // Mentions in comments / docstrings are deliberately OK (e.g.
    // `nexus-secret-client.ts` documents what it replaced). The checks
    // below match code constructs only — `class/new/extends Name` or
    // `import {... Name ...}` — not bare name occurrences.
    const offenders: string[] = [];
    for (const file of walkSourceFiles(path.join(REPO_ROOT, 'src'))) {
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (HTTP_SECRETS_MENTION_ALLOWLIST.has(rel)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      const codeRef = /\b(?:class|new|extends)\s+SecretStoreClient\b/.test(content);
      const importRef = /^\s*import\s+[^;]*\bSecretStoreClient\b/m.test(content);
      if (codeRef || importRef) {
        offenders.push(rel);
      }
    }
    expect(offenders, `SecretStoreClient must stay deleted (PR #733). Offending files:\n  ${offenders.join('\n  ')}\nUse NexusSecretClient (gRPC) instead — see src/common/nexus/nexus-secret-client.ts`).toEqual([]);
  });

  it('no source file under src/ calls fetch() against /api/v2/secrets', () => {
    // Catches the case where someone bypasses authProxy entirely by
    // calling the (non-existent) HTTP endpoint directly — perhaps to
    // "test something" or as a "fallback". The gRPC path via
    // NexusSecretClient is the only sanctioned one.
    const offenders: { file: string; match: string }[] = [];
    for (const file of walkSourceFiles(path.join(REPO_ROOT, 'src'))) {
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (HTTP_SECRETS_MENTION_ALLOWLIST.has(rel)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      // Match `fetch(<anything>/api/v2/secrets)` across reasonable
      // whitespace + same-line URL composition. Multiline string-built
      // URLs would slip through — that's an accepted blindspot; the
      // common-case regression is single-line.
      const match = content.match(/fetch\s*\([^)]*\/api\/v2\/secrets/);
      if (match) {
        offenders.push({ file: rel, match: match[0] });
      }
    }
    expect(offenders, `Secrets must go through gRPC NexusSecretClient.callBinary('password-vault.*'), not HTTP /api/v2/secrets. Offending files:\n  ${offenders.map((o) => `${o.file}: ${o.match}`).join('\n  ')}`).toEqual([]);
  });
});
