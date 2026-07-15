import { describe, it, expect } from 'vitest';
import { mergeTeamAssistants, type DetectedAgentLike, type InstalledAssistantLike } from '@process/services/team/assistantMerger';

describe('mergeTeamAssistants (附录 A2 merge/dedup/sort)', () => {
  it('merges installed + detected, dedupes by key, drops remote-agent, sorts by priority', () => {
    const installed: InstalledAssistantLike[] = [
      { isBuiltin: true, isHubInstalled: false, name: 'doctor', meta: { id: 'doctor', display_name: 'Doctor', presetAgentType: 'claude', avatar: null } },
      { isBuiltin: false, isHubInstalled: false, name: 'custom1', meta: { id: 'custom1', presetAgentType: 'scode' } },
    ];
    const detected: DetectedAgentLike[] = [
      { backend: 'scode', name: 'Sudo Code', presetAgentType: 'scode' },
      { backend: 'claude', name: 'Claude', presetAgentType: 'claude' },
      { backend: 'remote-agent', name: 'Moss' },
      // Same assistant as the installed 'doctor' — must be deduped (installed wins, resolved backend).
      { backend: 'custom', name: 'doctor', customAgentId: 'builtin-doctor', isPreset: true, presetAgentType: 'claude' },
    ];

    const assistants = mergeTeamAssistants(detected, installed);
    const ids = assistants.map((a) => a.assistant_id);

    expect(ids).toEqual(['custom1', 'scode', 'builtin-doctor', 'claude']);
    expect(ids).not.toContain('remote-agent');
    const doctor = assistants.find((a) => a.assistant_id === 'builtin-doctor')!;
    expect(doctor.backend).toBe('claude'); // resolved, not 'custom'
    // Priority order: scode(0) before claude(2).
    expect(ids.indexOf('scode')).toBeLessThan(ids.indexOf('claude'));
    expect(ids.indexOf('custom1')).toBeLessThan(ids.indexOf('builtin-doctor'));
  });

  it('falls back to detected only when installed is empty', () => {
    const detected: DetectedAgentLike[] = [{ backend: 'scode', name: 'Sudo Code', presetAgentType: 'scode' }];
    const assistants = mergeTeamAssistants(detected, []);
    expect(assistants.map((a) => a.assistant_id)).toEqual(['scode']);
  });

  it('keeps insertion order for same-priority entries (stable sort)', () => {
    const installed: InstalledAssistantLike[] = [
      { isBuiltin: false, isHubInstalled: false, name: 'first', meta: { id: 'first', presetAgentType: 'scode' } },
      { isBuiltin: false, isHubInstalled: false, name: 'second', meta: { id: 'second', presetAgentType: 'scode' } },
    ];
    const assistants = mergeTeamAssistants([], installed);
    expect(assistants.map((a) => a.assistant_id)).toEqual(['first', 'second']);
  });

  it('dedupes detected custom agents by customAgentId', () => {
    const detected: DetectedAgentLike[] = [
      { backend: 'custom', name: 'A', customAgentId: 'agent-x', isPreset: true },
      { backend: 'custom', name: 'A-dup', customAgentId: 'agent-x' },
    ];
    const assistants = mergeTeamAssistants(detected, []);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].assistant_id).toBe('agent-x');
  });
});
