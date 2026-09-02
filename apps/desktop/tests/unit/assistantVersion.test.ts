import { describe, expect, it } from 'vitest';
import { isAssistantVersionNewer } from '@/renderer/pages/agents/utils';

describe('assistant version comparison', () => {
  it('does not treat equal semantic versions as updates', () => {
    expect(isAssistantVersionNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isAssistantVersionNewer('v1.0.0', '1.0')).toBe(false);
  });

  it('requires a known installed version before showing an update', () => {
    expect(isAssistantVersionNewer('1.0.0', '')).toBe(false);
    expect(isAssistantVersionNewer('1.0.0', undefined)).toBe(false);
  });

  it('only returns true when the latest version is strictly newer', () => {
    expect(isAssistantVersionNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isAssistantVersionNewer('1.1.0', '1.0.9')).toBe(true);
    expect(isAssistantVersionNewer('1.0.0', '1.0.1')).toBe(false);
  });
});
