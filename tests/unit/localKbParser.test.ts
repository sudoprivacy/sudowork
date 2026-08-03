import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/process/utils/mainLogger', () => ({ mainWarn: vi.fn() }));
vi.mock('@/process/services/poppler/PopplerRuntimeService', () => ({
  popplerRuntimeService: {
    checkManaged: vi.fn().mockResolvedValue({ installed: false }),
    getToolPath: vi.fn(),
    getToolEnv: vi.fn(),
  },
}));

import { inferMimeType, parseLocalKbDocument, sha256File } from '@/process/services/local-kb/documentParser';

describe('local KB document parser', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-parser-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('passes markdown content through unchanged', async () => {
    const filePath = path.join(tempDir, 'guide.md');
    await fs.writeFile(filePath, '# Guide\n\nLocal KB content.\n', 'utf8');

    const parsed = await parseLocalKbDocument(filePath, 'guide.md');

    expect(parsed).toEqual({ markdown: '# Guide\n\nLocal KB content.\n', via: 'passthrough' });
  });

  it('hashes file content with sha256', async () => {
    const filePath = path.join(tempDir, 'hash.txt');
    await fs.writeFile(filePath, 'abc', 'utf8');

    await expect(sha256File(filePath)).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('infers supported document mime types', () => {
    expect(inferMimeType('notes.md')).toBe('text/markdown');
    expect(inferMimeType('paper.pdf')).toBe('application/pdf');
    expect(inferMimeType('report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(inferMimeType('unknown.bin')).toBe('application/octet-stream');
  });
});
