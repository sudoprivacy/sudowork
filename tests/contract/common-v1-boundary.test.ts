import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ParseResult = { ok: boolean; value?: unknown; issues?: Array<{ path: string; message: string }> };

const expectedSudostackSha = '65904eb0a0991366767095b707f5a86835089a1e';
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const sudostack = process.env.SUDOSTACK_REPO ?? join(repo, '../sudostack');
const commonArtifact = join(sudostack, 'contracts/common/v1/common.gen.ts');
const fixturesRoot = join(sudostack, 'fixtures');

if (!existsSync(commonArtifact)) {
  throw new Error(`SUDOSTACK_REPO must point at a sudostack checkout with ${relative(sudostack, commonArtifact)}`);
}

assertSudostackSha();

const common = (await import(pathToFileURL(commonArtifact).href)) as {
  safeParseCommon(value: unknown): ParseResult;
};

describe('ADR-005 common/v1 boundary', () => {
  it('accepts shared valid fixtures, including unknown optional fields', () => {
    for (const path of fixtureFiles('valid')) {
      const result = common.safeParseCommon(readJson(path));
      expect(result.ok, label(path, result)).toBe(true);
    }
  });

  it('rejects shared invalid fixtures, including unknown major and inline secrets', () => {
    for (const path of fixtureFiles('invalid')) {
      const result = common.safeParseCommon(readJson(path));
      expect(result.ok, label(path, result)).toBe(false);
      expect(result.issues?.length ?? 0, label(path, result)).toBeGreaterThan(0);
    }
  });

  it('roundtrips shared fixtures without semantic drift', () => {
    for (const path of fixtureFiles('roundtrip')) {
      const value = readJson(path);
      const result = common.safeParseCommon(JSON.parse(JSON.stringify(value)));
      expect(result.ok, label(path, result)).toBe(true);
      expect(JSON.parse(JSON.stringify(result.value))).toEqual(value);
    }
  });
});

function fixtureFiles(kind: string): string[] {
  return walk(join(fixturesRoot, kind, 'common/v1')).filter((path) => path.endsWith('.json')).sort();
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function label(path: string, result: ParseResult): string {
  const issues = result.issues?.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  return `${relative(sudostack, path)}${issues ? ` ${issues}` : ''}`;
}

function assertSudostackSha(): void {
  const actual = execFileSync('git', ['-C', sudostack, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== expectedSudostackSha) {
    throw new Error(`SUDOSTACK_REPO must point at sudostack ${expectedSudostackSha}, got ${actual}`);
  }
}
