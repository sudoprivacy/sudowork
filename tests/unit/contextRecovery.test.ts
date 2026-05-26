import { describe, expect, it } from 'vitest';
import { buildContextSummaryFromMessages, isContextOverflowError } from '../../src/common/contextRecovery';

describe('context recovery helpers', () => {
  it('detects common context overflow errors', () => {
    expect(isContextOverflowError('context_length_exceeded: maximum context length reached')).toBe(true);
    expect(isContextOverflowError('Prompt is too long for this model token limit')).toBe(true);
    expect(isContextOverflowError('对话内容过长，超出模型处理限制')).toBe(true);
    expect(isContextOverflowError('图片或文本内容过大，超出了模型的处理限制')).toBe(true);
    expect(isContextOverflowError('authentication failed')).toBe(false);
  });

  it('builds a local summary from recent messages and file paths', () => {
    const messages = [
      {
        type: 'text',
        position: 'right',
        text: '请修改 /tmp/workspace/src/app.ts 并运行 `bun test`',
      },
      {
        type: 'text',
        position: 'left',
        text: '已定位到 /tmp/workspace/src/app.ts，下一步会修复错误。',
      },
    ] as const;

    const summary = buildContextSummaryFromMessages([...messages]);

    expect(summary).toContain('压缩后的上下文摘要');
    expect(summary).toContain('/tmp/workspace/src/app.ts');
    expect(summary).toContain('bun test');
    expect(summary).toContain('请基于以上摘要继续当前会话');
  });
});
