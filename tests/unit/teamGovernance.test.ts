import { describe, it, expect } from 'vitest';
import { buildGovernancePrompt } from '@process/services/team/GovernancePrompt';

describe('buildGovernancePrompt (A3 governance concatenation)', () => {
  it('produces a lead governance prompt with dispatch directives', () => {
    const p = buildGovernancePrompt('lead', 'Alpha', 'Boss');
    expect(p).toContain('[Team Collaboration Governance]');
    expect(p).toContain('LEADER');
    expect(p).toContain('"Boss"');
    expect(p).toContain('team_spawn_agent');
    expect(p).toContain('team_send_message');
  });

  it('produces a teammate governance prompt with execution directives', () => {
    const p = buildGovernancePrompt('teammate', 'Alpha', 'Worker');
    expect(p).toContain('[Team Collaboration Governance]');
    expect(p).toContain('TEAMMATE');
    expect(p).toContain('"Worker"');
    expect(p).toContain('team_send_message');
  });

  it('both roles enforce coordinating only through team_* tools (soft guidance)', () => {
    const lead = buildGovernancePrompt('lead', 'T', 'L');
    const mate = buildGovernancePrompt('teammate', 'T', 'M');
    expect(lead).toContain('team_* tools');
    expect(mate).toContain('team_* tools');
  });
});
