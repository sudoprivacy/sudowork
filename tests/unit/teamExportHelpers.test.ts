import { describe, expect, it } from 'vitest';
import { buildTeamFolderName, buildTeamManifestJson, buildTeamManifestMarkdown, buildTeamMemberConversationFolderName, type ITeamExportWarning } from '@renderer/pages/team/utils/exportHelpers';
import type { TTeam } from '@renderer/pages/team/types';

function makeTeam(): TTeam {
  return {
    id: 'team-1',
    user_id: 'user-1',
    name: 'Alpha Team',
    workspace: '/tmp/team',
    workspace_kind: 'custom',
    leader_member_id: 'leader-slot',
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 100,
    updated_at: 200,
    assistants: [
      {
        slot_id: 'leader-slot',
        conversation_id: 'conv-leader',
        role: 'leader',
        assistant_backend: 'scode',
        assistant_name: 'Leader',
        assistant_id: 'assistant-leader',
        model: 'default',
        status: 'idle',
      },
      {
        slot_id: 'member/slot',
        conversation_id: null,
        role: 'teammate',
        assistant_backend: 'claude',
        assistant_name: 'Member',
        assistant_id: 'assistant-member',
        model: null,
        status: 'pending',
      },
    ],
  };
}

describe('team export helpers', () => {
  it('builds team and member conversation paths', () => {
    const team = makeTeam();
    const teamFolder = buildTeamFolderName(team);

    expect(teamFolder).toBe('Alpha Team__team-1');
    expect(buildTeamMemberConversationFolderName(teamFolder, team.assistants[0], 'conv-leader')).toBe('Alpha Team__team-1/conversations/leader__leader-slot__conv-leader');
    expect(buildTeamMemberConversationFolderName(teamFolder, team.assistants[1], 'conv-member')).toBe('Alpha Team__team-1/conversations/member__member_slot__conv-member');
  });

  it('builds team.json with all members and warnings', () => {
    const warnings: ITeamExportWarning[] = [{ memberSlotId: 'member/slot', reason: 'missing_conversation_id' }];
    const manifest = JSON.parse(buildTeamManifestJson(makeTeam(), warnings));

    expect(manifest.team.id).toBe('team-1');
    expect(manifest.members).toHaveLength(2);
    expect(manifest.members[0]).toMatchObject({ role: 'leader', conversation_id: 'conv-leader' });
    expect(manifest.members[1]).toMatchObject({ role: 'teammate', conversation_id: null });
    expect(manifest.warnings).toEqual(warnings);
  });

  it('builds team.md with member table and warning entries', () => {
    const markdown = buildTeamManifestMarkdown(makeTeam(), [{ memberSlotId: 'member/slot', reason: 'missing_conversation_id' }]);

    expect(markdown).toContain('# Alpha Team');
    expect(markdown).toContain('| leader | Leader | leader-slot | scode | default | conv-leader |');
    expect(markdown).toContain('| teammate | Member | member/slot | claude |  |  |');
    expect(markdown).toContain('## Warnings');
    expect(markdown).toContain('missing_conversation_id (slot: member/slot)');
  });
});
