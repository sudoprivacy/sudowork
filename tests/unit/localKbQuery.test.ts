import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILocalKbSearchHit } from '@/common/types/localKnowledgeBase';
import { searchLocalKbVector } from '@/process/services/local-kb/vectorIndex';
import { extractTitle, rrfFuse, searchLocalKbSpaceGrep } from '@/process/services/local-kb/query';

vi.mock('@/process/services/local-kb/paths', () => ({
  LOCAL_KB_SPACE_INDEX_FILE: 'SPACE.md',
}));

vi.mock('@/process/services/local-kb/vectorIndex', () => ({
  searchLocalKbVector: vi.fn().mockResolvedValue([]),
}));

describe('local KB query', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-query-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('extracts titles from frontmatter before markdown headings', () => {
    const title = extractTitle('---\ntitle: "Frontmatter Title"\ntype: chunk\n---\n\n# Heading\n', 'fallback.md');

    expect(title).toBe('Frontmatter Title');
  });

  it('returns grep-only line matches from SPACE and chunk files', async () => {
    await fs.writeFile(path.join(tempDir, 'SPACE.md'), '# Space\n\nalpha overview\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'chunk-001-topic.md'), '---\ntitle: Topic\n---\n\nBeta alpha detail\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'ignored.md'), 'alpha should not be searched\n', 'utf8');

    const result = await searchLocalKbSpaceGrep('space-1', tempDir, 'alpha');

    expect(result.mode).toBe('grep-only');
    expect(result.hits.map((hit) => `${hit.file}:${hit.lineNo}`)).toEqual(['SPACE.md:3', 'chunk-001-topic.md:5']);
  });

  it('fuses grep and vector hits with both source when they refer to the same line', () => {
    const grepHit: ILocalKbSearchHit = {
      spaceId: 'space-1',
      file: 'chunk-001-topic.md',
      title: 'Topic',
      lineNo: 3,
      text: 'grep text',
      score: 1,
      source: 'grep',
    };
    const vectorHit: ILocalKbSearchHit = {
      ...grepHit,
      text: 'vector text',
      source: 'vec',
    };

    const fused = rrfFuse([grepHit], [vectorHit], 60);

    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({ file: 'chunk-001-topic.md', lineNo: 3, source: 'both' });
    expect(fused[0]?.score).toBeGreaterThan(1 / 60);
  });

  it('drops low-score vector-only hits to avoid injecting unrelated local context', async () => {
    vi.mocked(searchLocalKbVector).mockResolvedValueOnce([
      {
        file: 'chunk-001-topic.md',
        startLine: 3,
        endLine: 3,
        title: 'Topic',
        text: 'unrelated vector text',
        score: 0.1,
      },
    ]);

    const result = await searchLocalKbSpaceGrep('space-1', tempDir, 'missing phrase');

    expect(result.mode).toBe('grep-only');
    expect(result.hits).toEqual([]);
  });
});
