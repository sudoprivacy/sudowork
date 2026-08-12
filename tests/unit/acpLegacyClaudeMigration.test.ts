import { describe, expect, it } from 'vitest';

import { normalizeLegacyAcpConversationState, normalizePresetAgentType } from '@/types/acpTypes';

describe('legacy Claude Code migration', () => {
  it('normalizes legacy assistant metadata to scode', () => {
    expect(normalizePresetAgentType('claude')).toBe('scode');
  });

  it('migrates legacy conversations to scode and clears the incompatible session id', () => {
    expect(normalizeLegacyAcpConversationState('claude', 'legacy-session')).toEqual({ backend: 'scode' });
  });

  it('preserves supported backends and session ids', () => {
    expect(normalizeLegacyAcpConversationState('codebuddy', 'session-1')).toEqual({
      backend: 'codebuddy',
      acpSessionId: 'session-1',
    });
  });
});
