import { describe, expect, it } from 'vitest';
import { shouldCancelAcpFinishTimeout } from '@renderer/pages/conversation/acp/acpFinishTimeout';

describe('shouldCancelAcpFinishTimeout', () => {
  it('keeps finish cleanup pending for metadata-only messages', () => {
    expect(shouldCancelAcpFinishTimeout('acp_context_usage')).toBe(false);
    expect(shouldCancelAcpFinishTimeout('acp_model_info')).toBe(false);
    expect(shouldCancelAcpFinishTimeout('request_trace')).toBe(false);
    expect(shouldCancelAcpFinishTimeout('finish')).toBe(false);
  });

  it('cancels finish cleanup only for active turn events', () => {
    expect(shouldCancelAcpFinishTimeout('thought')).toBe(true);
    expect(shouldCancelAcpFinishTimeout('start')).toBe(true);
    expect(shouldCancelAcpFinishTimeout('content')).toBe(true);
    expect(shouldCancelAcpFinishTimeout('acp_permission')).toBe(true);
    expect(shouldCancelAcpFinishTimeout('acp_tool_call')).toBe(true);
    expect(shouldCancelAcpFinishTimeout('plan')).toBe(true);
  });
});
