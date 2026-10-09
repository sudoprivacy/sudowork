import { describe, expect, it } from 'vitest';
import { resolveConversationExecutionTarget } from '@sudowork/common/mossExecution';

describe('persisted conversation execution location', () => {
  it('keeps local conversations local independently of ACP permission mode', () => {
    expect(resolveConversationExecutionTarget({ type: 'acp', extra: { backend: 'scode', sessionMode: 'yolo', executionTarget: 'local' } })).toBe('local');
  });
  it('recovers existing cloud conversations without the new metadata', () => {
    expect(resolveConversationExecutionTarget({ type: 'remote-agent' })).toBe('remote');
    expect(resolveConversationExecutionTarget({ type: 'acp', extra: { backend: 'remote-agent' } })).toBe('remote');
  });
  it('does not interpret a local ACP runtime id as a Moss session', () => {
    expect(resolveConversationExecutionTarget({ type: 'acp', extra: { backend: 'scode', acpSessionId: 'local-123' } })).toBe('local');
  });
});
