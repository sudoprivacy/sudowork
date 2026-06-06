import { describe, expect, it } from 'vitest';

import { FileIntentClassifier, type FileIntentClassificationInput } from '@/process/task/FileIntentClassifier';

const classifier = new FileIntentClassifier();

const classify = (overrides: Partial<FileIntentClassificationInput> & { filePath: string }) => {
  const input: FileIntentClassificationInput = {
    source: 'write',
    ...overrides,
  };
  return classifier.classify(input);
};

describe('FileIntentClassifier — directory-structure rules', () => {
  // ── Anthropic outputs/<doc>/final.<ext> convention ─────────────────────
  it('marks outputs/<doc>/final.pptx as final (Anthropic convention)', () => {
    const result = classify({ filePath: '/workspace/outputs/q1-report/final.pptx', requestedPath: 'outputs/q1-report/final.pptx', source: 'bash-generated' });
    expect(result.intent).toBe('final');
    expect(result.reason).toMatch(/Anthropic outputs/);
  });

  it('marks outputs/<doc>/final.docx as final regardless of extension', () => {
    const result = classify({ filePath: '/workspace/outputs/q1-report/final.docx', requestedPath: 'outputs/q1-report/final.docx', source: 'write' });
    expect(result.intent).toBe('final');
  });

  it('marks outputs/<doc>/final.html as final', () => {
    const result = classify({ filePath: '/workspace/outputs/landing-page/final.html', requestedPath: 'outputs/landing-page/final.html', source: 'write' });
    expect(result.intent).toBe('final');
  });

  // ── Anthropic outputs/<doc>/ intermediate (everything not named final.X) ──
  it('marks outputs/<doc>/p1.jpg as draft (intermediate inside outputs tree)', () => {
    const result = classify({ filePath: '/workspace/outputs/数牍科技公司介绍/p1.jpg', requestedPath: 'outputs/数牍科技公司介绍/p1.jpg', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
    expect(result.reason).toMatch(/Intermediate.*outputs/);
  });

  it('marks outputs/<doc>/inventory.json as draft even though .json is in BASH_DELIVERABLE_EXTENSIONS', () => {
    const result = classify({ filePath: '/workspace/outputs/q1-report/inventory.json', requestedPath: 'outputs/q1-report/inventory.json', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
  });

  it('marks outputs/<doc>/thumbnails_grid.png as draft', () => {
    const result = classify({ filePath: '/workspace/outputs/q1-report/thumbnails_grid.png', requestedPath: 'outputs/q1-report/thumbnails_grid.png', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
  });

  it('marks outputs/<doc>/working.pptx as draft (only final.<ext> wins)', () => {
    const result = classify({ filePath: '/workspace/outputs/q1-report/working.pptx', requestedPath: 'outputs/q1-report/working.pptx', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
  });

  // ── Legacy intermediate dir blacklist ────────────────────────────────────
  it('marks ppt_outputs/p1.jpg as draft (legacy convention)', () => {
    const result = classify({ filePath: '/workspace/ppt_outputs/p1.jpg', requestedPath: 'ppt_outputs/p1.jpg', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
    expect(result.reason).toMatch(/legacy intermediate directory "ppt_outputs"/);
  });

  it('marks ppt_outputs/final.pptx as draft (legacy dir wins — final.pptx outside outputs/ is not Anthropic-style)', () => {
    const result = classify({ filePath: '/workspace/ppt_outputs/final.pptx', requestedPath: 'ppt_outputs/final.pptx', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
  });

  it('marks _tmp/working.txt as draft', () => {
    const result = classify({ filePath: '/workspace/_tmp/working.txt', requestedPath: '_tmp/working.txt', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
  });

  it('marks intermediate/data.csv as draft', () => {
    const result = classify({ filePath: '/workspace/intermediate/data.csv', requestedPath: 'intermediate/data.csv', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
  });

  // ── BASH_DELIVERABLE_EXTENSIONS no longer auto-finals images at root ────
  it('does NOT auto-mark a bash-written PNG at workspace root as final when user did not request an image', () => {
    const result = classify({ filePath: '/workspace/report.png', requestedPath: 'report.png', source: 'bash-generated', userMessage: '生成一份季度销售报告' });
    expect(result.intent).toBe('draft');
  });

  it('keeps bash-written PPTX at workspace root as final (office extension)', () => {
    const result = classify({ filePath: '/workspace/report.pptx', requestedPath: 'report.pptx', source: 'bash-generated', userMessage: '生成一份季度销售 ppt' });
    expect(result.intent).toBe('final');
  });

  it('marks a bash-written PNG as final when user explicitly asked for an image', () => {
    // Caught by inferRequestedExtensions before our new rules — user said "图片".
    const result = classify({ filePath: '/workspace/avatar.png', requestedPath: 'avatar.png', source: 'bash-generated', userMessage: '给我画一张猫的图片头像' });
    expect(result.intent).toBe('final');
  });

  // ── Files at workspace root (no relevant directory hint) untouched ──────
  it('leaves workspace-root markdown without directory hint untouched', () => {
    const result = classify({ filePath: '/workspace/notes.md', requestedPath: 'notes.md', source: 'write', userMessage: '帮我记一些笔记' });
    // Falls through to final (default) — matches existing behavior
    expect(result.intent).toBe('final');
  });

  // ── User request still wins over directory rule ────────────────────────
  it('still marks a user-requested file as final even if path is inside outputs/<doc>/', () => {
    // User explicitly asks for inventory.json — requestedNames extraction
    // catches it before our directory rules, so it wins.
    const result = classify({ filePath: '/workspace/outputs/q1-report/inventory.json', requestedPath: 'outputs/q1-report/inventory.json', source: 'write', userMessage: '把 inventory.json 给我' });
    expect(result.intent).toBe('final');
  });
});
