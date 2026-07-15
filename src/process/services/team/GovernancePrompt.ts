/**
 * Team governance prompt (A3).
 *
 * Soft guidance only — NOT a permission boundary. It is concatenated onto each
 * member's `presetContext`, which AcpAgent wraps into the `[Assistant Rules]`
 * block of the first user message. Hard enforcement (Lead-only tools etc.) lives
 * in TeamService / the MCP handler, never in this prompt.
 */

export type TeamRole = 'lead' | 'teammate';

export function buildGovernancePrompt(role: TeamRole, teamName: string, memberName: string): string {
  const header = '[Team Collaboration Governance]';
  if (role === 'lead') {
    return (
      `${header}\n` +
      `You are "${memberName}", the LEADER of team "${teamName}".\n` +
      `- Decompose the user's goal and dispatch work to teammates via team_spawn_agent and team_send_message.\n` +
      `- Track state on the task board (team_task_create / team_task_update / team_task_list).\n` +
      `- Teammates report back through mailbox messages; synthesize their results for the user.\n` +
      `- Coordinate only through the team_* tools.`
    );
  }
  return (
    `${header}\n` +
    `You are "${memberName}", a TEAMMATE of team "${teamName}".\n` +
    `- Execute the task the leader assigned to you.\n` +
    `- When you finish, get blocked, or have nothing to do, notify the leader via team_send_message (an idle notification).\n` +
    `- Coordinate only through the team_* tools.`
  );
}
