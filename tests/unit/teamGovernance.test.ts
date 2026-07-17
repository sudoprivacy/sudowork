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

  it('requires the leader to inspect roster and prefer existing teammates before spawning', () => {
    const p = buildGovernancePrompt('lead', 'Alpha', 'Boss');
    expect(p).toContain('On your first team turn, call team_members');
    expect(p).toContain('Before delegating work, adding or removing teammates, or referring to teammates, call team_members');
    expect(p).toContain('If existing teammates are enough, use them first');
    expect(p).toContain('Use slot_id values for tool arguments');
    expect(p).toContain('do not propose more teammates yet');
    expect(p).toContain('Do NOT call team_spawn_agent in that same turn');
    expect(p).toContain('unless the user explicitly asked you to create a specific teammate immediately');
    expect(p).toContain('idle means waiting for input, not unavailable');
    expect(p).toContain('do not tell one teammate to wait for another');
    expect(p).toContain('team_rename_agent or team_shutdown_agent');
    expect(p).toContain('avoid duplicating work already assigned');
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
