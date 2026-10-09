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

describe('FileIntentClassifier — intermediate-directory rule', () => {
  it('marks ppt_outputs/p1.jpg as draft', () => {
    const result = classify({ filePath: '/workspace/ppt_outputs/p1.jpg', requestedPath: 'ppt_outputs/p1.jpg', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
    expect(result.reason).toMatch(/intermediate directory "ppt_outputs"/);
  });

  it('marks ppt_outputs/final.pptx as draft (intermediate-dir rule wins over name)', () => {
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

  it('does NOT mark these as userInitiated (intermediate-dir is AI-auto)', () => {
    const result = classify({ filePath: '/workspace/ppt_outputs/p1.jpg', requestedPath: 'ppt_outputs/p1.jpg', source: 'bash-generated' });
    expect(result.intent).toBe('draft');
    expect(result.userInitiated).toBeUndefined();
  });
});

describe('FileIntentClassifier — BASH_DELIVERABLE_EXTENSIONS no longer auto-finals images', () => {
  it('does NOT auto-mark a bash-written PNG at workspace root as final when user did not request an image', () => {
    const result = classify({ filePath: '/workspace/report.png', requestedPath: 'report.png', source: 'bash-generated', userMessage: '生成一份季度销售报告' });
    expect(result.intent).toBe('draft');
  });

  it('keeps bash-written PPTX at workspace root as final (office extension)', () => {
    const result = classify({ filePath: '/workspace/report.pptx', requestedPath: 'report.pptx', source: 'bash-generated', userMessage: '生成一份季度销售 ppt' });
    expect(result.intent).toBe('final');
  });

  it('marks a bash-written PNG as final when user explicitly asked for an image', () => {
    // Caught by inferRequestedExtensions before directory rules — user said "图片".
    const result = classify({ filePath: '/workspace/avatar.png', requestedPath: 'avatar.png', source: 'bash-generated', userMessage: '给我画一张猫的图片头像' });
    expect(result.intent).toBe('final');
  });
});

describe('FileIntentClassifier — requested log deliverables', () => {
  it('marks a bash-written LOG file as final when the user explicitly requests LOG format', () => {
    const result = classify({
      filePath: '/workspace/20260610_AI智能体协作趋势.log',
      requestedPath: '20260610_AI智能体协作趋势.log',
      source: 'bash-generated',
      userMessage: '根据AI智能体协作的发展趋势生成 9 种格式文件（PDF, WORD, Excel, PPT, txt, MD, Python, JS, LOG），文件名称以20260610_为前缀',
    });
    expect(result.intent).toBe('final');
    expect(result.reason).toContain('target type .log');
  });

  it('keeps an unrequested bash-written LOG file as draft', () => {
    const result = classify({
      filePath: '/workspace/debug.log',
      requestedPath: 'debug.log',
      source: 'bash-generated',
      userMessage: '生成一份季度销售报告',
    });
    expect(result.intent).toBe('draft');
  });
});

describe('FileIntentClassifier — workspace-root deliverables untouched', () => {
  it('leaves workspace-root markdown without directory hint as final', () => {
    const result = classify({ filePath: '/workspace/notes.md', requestedPath: 'notes.md', source: 'write', userMessage: '帮我记一些笔记' });
    expect(result.intent).toBe('final');
  });

  it('still honors a requested file name even if inside an intermediate dir', () => {
    // User explicitly asks for inventory.json — requestedNames extraction
    // catches it before directory rules, so user intent wins.
    const result = classify({ filePath: '/workspace/intermediate/inventory.json', requestedPath: 'intermediate/inventory.json', source: 'write', userMessage: '把 inventory.json 给我' });
    expect(result.intent).toBe('final');
  });
});

describe('FileIntentClassifier — userInitiated flag', () => {
  it('sets userInitiated=true when operationIntent=move-to-drafts', () => {
    const result = classify({ filePath: '/workspace/.drafts/notes.md', requestedPath: '.drafts/notes.md', operationIntent: 'move-to-drafts' });
    expect(result.intent).toBe('draft');
    expect(result.userInitiated).toBe(true);
  });

  it('sets userInitiated=true when user message says "move X to drafts"', () => {
    const result = classify({ filePath: '/workspace/.drafts/notes.md', requestedPath: '.drafts/notes.md', userMessage: '把 notes.md 移到 .drafts/' });
    expect(result.intent).toBe('draft');
    expect(result.userInitiated).toBe(true);
  });
});
