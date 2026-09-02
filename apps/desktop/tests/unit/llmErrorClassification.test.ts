import { describe, expect, it } from 'vitest';
import { classifyLlmError } from '@/process/utils/llmErrorClassification';

describe('classifyLlmError', () => {
  it.each(['[context_window_exceeded] compacted history still exceeds limit', 'context_window_blocked for model: estimated input exceeds context window', 'maximum context length exceeded', 'token limit exceeded', '对话内容过长，超出模型处理限制'])(
    'classifies recoverable context overflow: %s',
    (message) => {
      expect(classifyLlmError(message)).toMatchObject({
        type: 'context_window_exceeded',
        recoverableByNewSession: true,
      });
    }
  );

  it.each(['当前请求内容过大，超出模型处理限制', '图片或文本内容过大，超出了模型的处理限制。', 'single_request_too_large'])('classifies oversized current requests as session-preserving (only this one message is too big, history is fine): %s', (message) => {
    // Regression guard: prior to 2026-06-28 this returned recoverableByNewSession=true,
    // which caused AcpAgent.markRuntimeContextPoisoned to delete the ACP session
    // on every oversized-attach attempt — silently dropping full chat history.
    // single_request errors must NOT trigger session reset: shrink THIS input, keep history.
    expect(classifyLlmError(message)).toMatchObject({
      type: 'single_request_too_large',
      recoverableByNewSession: false,
    });
  });

  it('single_request_too_large userMessage indicates history is preserved (no "新的运行时上下文" wording)', () => {
    const got = classifyLlmError('图片或文本内容过大');
    expect(got.userMessage).toContain('先前对话历史保留');
    expect(got.userMessage).not.toContain('新的运行时上下文');
  });

  it('classifies request body size failures separately', () => {
    expect(classifyLlmError('request body size exceeds provider limit')).toMatchObject({
      type: 'request_body_too_large',
      recoverableByNewSession: false,
    });
  });

  it('prefers structured error data when present', () => {
    expect(
      classifyLlmError({
        data: {
          code: 'context_window_exceeded',
          message: 'history context too large',
        },
      })
    ).toMatchObject({
      type: 'context_window_exceeded',
      recoverableByNewSession: true,
    });
  });
});
