import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { FILE_INTENT_MARKERS, COMMENT_SYNTAX_MAP, getCommentPrefix } from '@/common/constants';
import { detectFileIntent, cleanupIntermediateFiles } from '@/process/task/draftsCleanup';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

describe('File Intent Markers Constants', () => {
  test('FILE_INTENT_MARKERS contains @final and @draft', () => {
    expect(FILE_INTENT_MARKERS.final).toContain('@final');
    expect(FILE_INTENT_MARKERS.draft).toContain('@draft');
  });

  test('COMMENT_SYNTAX_MAP has correct Python prefix', () => {
    expect(COMMENT_SYNTAX_MAP['.py']).toBe('#');
  });

  test('COMMENT_SYNTAX_MAP has correct JavaScript prefix', () => {
    expect(COMMENT_SYNTAX_MAP['.js']).toBe('//');
  });

  test('COMMENT_SYNTAX_MAP has correct HTML format', () => {
    expect(COMMENT_SYNTAX_MAP['.html']).toBe('<!--');
  });

  test('getCommentPrefix returns # for unknown extensions', () => {
    expect(getCommentPrefix('unknown.xyz')).toBe('#');
  });
});

describe('detectFileIntent function', () => {
  test('detects # @final in Python file', () => {
    const content = '# @final\nimport pandas as pd\nprint("result")';
    const result = detectFileIntent('test.py', content);
    expect(result.intent).toBe('final');
    expect(result.marker).toBe('@final');
    expect(result.line).toBe(1);
  });

  test('detects # @draft in Python file', () => {
    const content = '# @draft - helper script\ndef helper():\n  pass';
    const result = detectFileIntent('helper.py', content);
    expect(result.intent).toBe('draft');
    expect(result.marker).toBe('@draft');
    expect(result.line).toBe(1);
  });

  test('detects // @final in JavaScript file', () => {
    const content = '// @final\nconst result = () => {}';
    const result = detectFileIntent('result.js', content);
    expect(result.intent).toBe('final');
    expect(result.marker).toBe('@final');
  });

  test('detects <!-- @draft --> in HTML file', () => {
    const content = '<!-- @draft -->\n<html>...</html>';
    const result = detectFileIntent('helper.html', content);
    expect(result.intent).toBe('draft');
  });

  test('returns unknown for files without markers', () => {
    const content = 'import pandas as pd\nprint("no marker")';
    const result = detectFileIntent('script.py', content);
    expect(result.intent).toBe('unknown');
  });

  test('detects marker in line 5 (within first 10 lines)', () => {
    const content = 'line1\nline2\nline3\nline4\n# @final\nimport pandas';
    const result = detectFileIntent('test.py', content);
    expect(result.intent).toBe('final');
    expect(result.line).toBe(5);
  });

  test('ignores marker after line 10', () => {
    const content = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\n# @draft';
    const result = detectFileIntent('test.py', content);
    expect(result.intent).toBe('unknown');
  });
});

describe('cleanupIntermediateFiles with markers', () => {
  let testWorkspace: string;

  beforeEach(async () => {
    testWorkspace = path.join(os.tmpdir(), `drafts-test-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.mkdir(path.join(testWorkspace, '.drafts'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  test('moves files with @draft marker to .drafts/', async () => {
    const content = '# @draft\nprint("helper")';
    await fs.writeFile(path.join(testWorkspace, 'helper.py'), content);

    await cleanupIntermediateFiles(testWorkspace);

    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'helper.py'))).toBe(true);
    expect(fsSync.existsSync(path.join(testWorkspace, 'helper.py'))).toBe(false);
  });

  test('keeps files with @final marker in root', async () => {
    const content = '# @final\nprint("result")';
    await fs.writeFile(path.join(testWorkspace, 'result.py'), content);

    await cleanupIntermediateFiles(testWorkspace);

    expect(fsSync.existsSync(path.join(testWorkspace, 'result.py'))).toBe(true);
    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'result.py'))).toBe(false);
  });

  test('keeps files without marker in root (default safe)', async () => {
    const content = 'print("no marker")';
    await fs.writeFile(path.join(testWorkspace, 'no_marker.py'), content);

    await cleanupIntermediateFiles(testWorkspace);

    expect(fsSync.existsSync(path.join(testWorkspace, 'no_marker.py'))).toBe(true);
    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'no_marker.py'))).toBe(false);
  });

  test('handles JavaScript files with // @draft', async () => {
    const content = '// @draft\nconst helper = () => {}';
    await fs.writeFile(path.join(testWorkspace, 'helper.js'), content);

    await cleanupIntermediateFiles(testWorkspace);

    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'helper.js'))).toBe(true);
  });

  test('handles HTML files with <!-- @final -->', async () => {
    const content = '<!-- @final -->\n<html>...</html>';
    await fs.writeFile(path.join(testWorkspace, 'report.html'), content);

    await cleanupIntermediateFiles(testWorkspace);

    expect(fsSync.existsSync(path.join(testWorkspace, 'report.html'))).toBe(true);
  });

  test('cleans up script execution side effects (package.json, node_modules) when @draft script exists', async () => {
    // Create @draft script (like generate_report.js)
    const scriptContent = '// @draft\nconst docx = require("docx");';
    await fs.writeFile(path.join(testWorkspace, 'generate_report.js'), scriptContent);

    // Simulate script execution side effects
    await fs.writeFile(path.join(testWorkspace, 'package.json'), '{"name": "temp"}');
    await fs.mkdir(path.join(testWorkspace, 'node_modules'));

    await cleanupIntermediateFiles(testWorkspace);

    // Script should be moved to .drafts/
    expect(fsSync.existsSync(path.join(testWorkspace, 'generate_report.js'))).toBe(false);
    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'generate_report.js'))).toBe(true);

    // Side effects should be cleaned up
    expect(fsSync.existsSync(path.join(testWorkspace, 'package.json'))).toBe(false);
    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'package.json'))).toBe(true);
    expect(fsSync.existsSync(path.join(testWorkspace, 'node_modules'))).toBe(false);
  });

  test('normalizes files copied to drafts alias directory into .drafts/', async () => {
    await fs.mkdir(path.join(testWorkspace, 'drafts'));
    await fs.writeFile(path.join(testWorkspace, 'drafts', 'helper.js'), '// helper');

    await cleanupIntermediateFiles(testWorkspace);

    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'helper.js'))).toBe(true);
    expect(fsSync.existsSync(path.join(testWorkspace, 'drafts'))).toBe(false);
  });

  test('normalizes files copied to Chinese drafts alias directory into .drafts/', async () => {
    await fs.mkdir(path.join(testWorkspace, '草稿箱'));
    await fs.writeFile(path.join(testWorkspace, '草稿箱', 'notes.md'), 'draft notes');

    await cleanupIntermediateFiles(testWorkspace);

    expect(fsSync.existsSync(path.join(testWorkspace, '.drafts', 'notes.md'))).toBe(true);
    expect(fsSync.existsSync(path.join(testWorkspace, '草稿箱'))).toBe(false);
  });

  test('preserves existing .drafts file when normalizing alias directory collisions', async () => {
    await fs.writeFile(path.join(testWorkspace, '.drafts', 'helper.js'), 'existing');
    await fs.mkdir(path.join(testWorkspace, 'drafts'));
    await fs.writeFile(path.join(testWorkspace, 'drafts', 'helper.js'), 'new');

    await cleanupIntermediateFiles(testWorkspace);

    expect(await fs.readFile(path.join(testWorkspace, '.drafts', 'helper.js'), 'utf-8')).toBe('existing');
    const draftsFiles = await fs.readdir(path.join(testWorkspace, '.drafts'));
    expect(draftsFiles.some((name) => /^helper_\d+\.js$/.test(name))).toBe(true);
    expect(fsSync.existsSync(path.join(testWorkspace, 'drafts'))).toBe(false);
  });
});
