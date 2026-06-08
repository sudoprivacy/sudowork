import { describe, expect, test } from 'vitest';
import { SCODE_COMPLETION_REMINDER, shouldSkipAcpWorkspaceTrackingPath } from '@/process/task/acpWorkspaceTracking';

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
    expect(SCODE_COMPLETION_REMINDER).toContain('用户提问的语言');
    expect(SCODE_COMPLETION_REMINDER).toContain('不要只以工具调用结束');
  });
});
