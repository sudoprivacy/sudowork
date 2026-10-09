import {
  appendGeneratedFilesMarker,
  extractExtension,
  mimeForExtension,
  NEXUS_GENERATED_FILES_MARKER,
  parseGeneratedFilesMarker,
  stripGeneratedFilesMarker,
  type GeneratedFileEntry,
} from '@/common/generatedFiles';

const entry = (overrides: Partial<GeneratedFileEntry> = {}): GeneratedFileEntry => ({
  path: '/workspace/hello.html',
  relativePath: 'hello.html',
  kind: 'create',
  ext: 'html',
  mime: 'text/html',
  size: 127,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

describe('appendGeneratedFilesMarker', () => {
  it('returns the original content unchanged when files is empty', () => {
    expect(appendGeneratedFilesMarker('Done.', [])).toBe('Done.');
    expect(appendGeneratedFilesMarker('', [])).toBe('');
  });

  it('appends a marker + JSON payload separated by a blank line', () => {
    const result = appendGeneratedFilesMarker('Done.', [entry()]);
    expect(result.startsWith('Done.\n\n[[NEXUS_GENERATED_FILES]]')).toBe(true);
    const json = result.slice(result.indexOf('{'));
    const parsed = JSON.parse(json);
    expect(parsed.v).toBe(1);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('/workspace/hello.html');
  });

  it('trims trailing whitespace from the prose before joining', () => {
    const result = appendGeneratedFilesMarker('Done.   \n\n', [entry()]);
    expect(result.startsWith('Done.\n\n[[NEXUS_GENERATED_FILES]]')).toBe(true);
  });
});

describe('parseGeneratedFilesMarker', () => {
  it('returns the original text and ok:false when no marker is present', () => {
    const result = parseGeneratedFilesMarker('Done.');
    expect(result.textBefore).toBe('Done.');
    expect(result.files).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it('round-trips through append for the happy path', () => {
    const original = 'Generated 2 files.';
    const files = [entry(), entry({ path: '/workspace/notes.md', ext: 'md', mime: 'text/markdown', size: 42, relativePath: 'notes.md' })];
    const augmented = appendGeneratedFilesMarker(original, files);
    const parsed = parseGeneratedFilesMarker(augmented);
    expect(parsed.textBefore).toBe(original);
    expect(parsed.files).toEqual(files);
    expect(parsed.ok).toBe(true);
  });

  it('drops malformed JSON gracefully but still strips the marker text', () => {
    const broken = `Done.\n\n${NEXUS_GENERATED_FILES_MARKER}{ not json`;
    const parsed = parseGeneratedFilesMarker(broken);
    expect(parsed.textBefore).toBe('Done.');
    expect(parsed.files).toEqual([]);
    expect(parsed.ok).toBe(false);
  });

  it('drops payloads with an unknown schema version', () => {
    const futureVersion = `Done.\n\n${NEXUS_GENERATED_FILES_MARKER}{"v":99,"files":[]}`;
    const parsed = parseGeneratedFilesMarker(futureVersion);
    expect(parsed.textBefore).toBe('Done.');
    expect(parsed.ok).toBe(false);
  });

  it('drops entries that are missing required fields', () => {
    const partial = appendGeneratedFilesMarker('Done.', [
      entry(),
      // typed-cast lets us simulate a malformed neighbour without breaking the type system
      { path: undefined as unknown as string, kind: 'create', ext: 'html', createdAt: 0 } as unknown as GeneratedFileEntry,
    ]);
    const parsed = parseGeneratedFilesMarker(partial);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('/workspace/hello.html');
  });
});

describe('stripGeneratedFilesMarker', () => {
  it('removes the marker tail but leaves prose untouched', () => {
    const augmented = appendGeneratedFilesMarker('Hello world.', [entry()]);
    expect(stripGeneratedFilesMarker(augmented)).toBe('Hello world.');
  });

  it('is a no-op when the marker is absent', () => {
    expect(stripGeneratedFilesMarker('Just prose.')).toBe('Just prose.');
  });
});

describe('extractExtension', () => {
  it('returns the lowercase extension for unix paths', () => {
    expect(extractExtension('/a/b/c.PNG')).toBe('png');
    expect(extractExtension('hello.html')).toBe('html');
    expect(extractExtension('/dir/file.tar.gz')).toBe('gz');
  });

  it('returns empty string for files without an extension', () => {
    expect(extractExtension('/a/b/Makefile')).toBe('');
    expect(extractExtension('README')).toBe('');
  });

  it('handles windows path separators', () => {
    expect(extractExtension('C:\\Users\\me\\foo.docx')).toBe('docx');
  });

  it('does not treat a leading dot as an extension separator', () => {
    expect(extractExtension('/dir/.dotfile')).toBe('');
  });
});

describe('mimeForExtension', () => {
  it('returns expected mime types for the office + image set', () => {
    expect(mimeForExtension('html')).toBe('text/html');
    expect(mimeForExtension('pdf')).toBe('application/pdf');
    expect(mimeForExtension('pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(mimeForExtension('PNG')).toBe('image/png');
  });

  it('returns undefined for unknown extensions', () => {
    expect(mimeForExtension('totallymadeup')).toBeUndefined();
  });
});
