import { describe, expect, test } from 'vitest';
import { buildAcpModelIdentityReminder, SCODE_COMPLETION_REMINDER, shouldInjectLanguageReminder, shouldRunCurrentTurnPostCleanup, shouldSkipAcpWorkspaceTrackingPath } from '@/process/task/acpWorkspaceTracking';

describe('acpWorkspaceTracking', () => {
  test('skips sandbox runtime side effects', () => {
    expect(shouldSkipAcpWorkspaceTrackingPath('.sandbox-home/.rustup/settings.toml')).toBe(true);
    expect(shouldSkipAcpWorkspaceTrackingPath('.sandbox-tmp/node-compile-cache/v24.13.0-arm64/00bf0630')).toBe(true);
    expect(shouldSkipAcpWorkspaceTrackingPath('.sandbox-tmp/pip-unpack-abc/lxml-6.1.1.whl')).toBe(true);
  });

  test('keeps user deliverables trackable', () => {
    expect(shouldSkipAcpWorkspaceTrackingPath('Browser_Tool_Test_Cases.xlsx')).toBe(false);
  });

  test('scode completion reminder asks for the user language', () => {
    expect(SCODE_COMPLETION_REMINDER).toContain('用户最后一条消息的主要语言');
    expect(SCODE_COMPLETION_REMINDER).toContain('不要只以工具调用结束');
  });

  test('scode completion reminder requires Chinese for tool call status', () => {
    expect(SCODE_COMPLETION_REMINDER).toContain('工具调用前后状态说明');
    expect(SCODE_COMPLETION_REMINDER).toContain('中文用户时');
    expect(SCODE_COMPLETION_REMINDER).toContain('不得输出完整英文句子');
  });

  test('scode completion reminder allows exceptions for technical content', () => {
    expect(SCODE_COMPLETION_REMINDER).toContain('代码');
    expect(SCODE_COMPLETION_REMINDER).toContain('命令');
    expect(SCODE_COMPLETION_REMINDER).toContain('路径');
    expect(SCODE_COMPLETION_REMINDER).toContain('专有名词');
  });

  test('runs post-cleanup only when the current turn produced tracked files', () => {
    expect(shouldRunCurrentTurnPostCleanup(true)).toBe(true);
    expect(shouldRunCurrentTurnPostCleanup(false)).toBe(false);
  });

  describe('shouldInjectLanguageReminder', () => {
    test('covers scode and claude backends', () => {
      expect(shouldInjectLanguageReminder('scode')).toBe(true);
      expect(shouldInjectLanguageReminder('claude')).toBe(true);
    });

    test('skips other backends', () => {
      expect(shouldInjectLanguageReminder('gemini')).toBe(false);
      expect(shouldInjectLanguageReminder('codex')).toBe(false);
      expect(shouldInjectLanguageReminder('qwen')).toBe(false);
    });

    test('handles missing backend', () => {
      expect(shouldInjectLanguageReminder(undefined)).toBe(false);
      expect(shouldInjectLanguageReminder('')).toBe(false);
    });
  });

  describe('buildAcpModelIdentityReminder', () => {
    test('scode backend uses Chinese text', () => {
      const notice = buildAcpModelIdentityReminder('scode', 'gpt-4o');
      expect(notice).toContain('当前活动模型');
      expect(notice).toContain('gpt-4o');
      expect(notice).toContain('当用户询问你使用哪个模型时');
      expect(notice).toContain('请回答');
      expect(notice).not.toContain('Active model:');
      expect(notice).not.toContain('You are currently running as');
      expect(notice).not.toContain('When asked which model you are');
    });

    test('claude backend uses English text', () => {
      const notice = buildAcpModelIdentityReminder('claude', 'claude-opus-4-7');
      expect(notice).toContain('Active model');
      expect(notice).toContain('claude-opus-4-7');
      expect(notice).toContain('When asked which model you are');
    });

    test('scode reminder includes model answer instruction in Chinese', () => {
      const notice = buildAcpModelIdentityReminder('scode', 'deepseek-v3');
      expect(notice).toContain('当用户询问');
      expect(notice).toContain('请回答 deepseek-v3');
    });

    test('claude reminder includes stale identity hint', () => {
      const notice = buildAcpModelIdentityReminder('claude', 'claude-sonnet-4-6');
      expect(notice).toContain('ANTHROPIC_MODEL');
      expect(notice).toContain('stale');
    });
  });
});
