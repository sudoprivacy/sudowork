import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(__dirname, '../../src');
function sources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(target) : /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

describe('Sudocode capability boundary', () => {
  it('keeps kernel transport and secret storage out of desktop source', () => {
    const violations = sources(sourceRoot).filter((file) => /\bnew\s+(?:NexusVfsClient|NexusSecretClient|NexusGrpcClient)\s*\(/.test(fs.readFileSync(file, 'utf8')));
    expect(violations.map((file) => path.relative(sourceRoot, file))).toEqual([]);
  });

  it('uses one process capability client for Vault, files, and managed sessions', () => {
    for (const name of ['secretsClient', 'filesClient', 'sessionsClient']) {
      const source = fs.readFileSync(path.join(sourceRoot, 'common/scode', `${name}.ts`), 'utf8');
      expect(source).toContain('getScodeServiceClient');
      expect(source).not.toMatch(/\b(?:spawn|fetch|connectTls|withMtls)\s*\(/);
    }
  });
});
