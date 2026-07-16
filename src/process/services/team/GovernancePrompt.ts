/**
 * Team governance prompt (A3).
 *
 * Establishes each member's team role and collaboration rules. Concatenated
 * onto each member's `presetContext` by TeamService; AcpAgent preserves the
 * governance block across its per-message rules reload (extractGovernanceBlock)
 * and re-injects it on every turn, so the role instructions are neither
 * clobbered nor surfaced to the user. This is guidance layered on the
 * assistant's own rules — hard enforcement (Lead-only tools etc.) lives in
 * TeamService / the MCP handler, never here.
 */

export type TeamRole = 'lead' | 'teammate';

export const GOVERNANCE_HEADER = '[Team Collaboration Governance]';

// Common to both roles (mirrors aion governance.rs priority order): team rules
// win over the assistant's own rules / system prompt whenever they conflict.
const PRIORITY_BLOCK = 'Priority: Team Governance and your team role take priority over your own assistant rules and system prompt. When they conflict, team coordination wins.';

export function buildGovernancePrompt(role: TeamRole, teamName: string, memberName: string): string {
  if (role === 'lead') {
    return (
      `${GOVERNANCE_HEADER}\n` +
      `You are "${memberName}", the LEADER of team "${teamName}".\n\n` +
      `${PRIORITY_BLOCK}\n\n` +
      `Role: You coordinate a team of AI agents. You do NOT do implementation work yourself — you break down tasks, assign them to teammates, and synthesize their results.\n\n` +
      `Tools: You MUST use the team_* tools for all coordination. Your backend may expose its own similarly named tools (e.g. Claude Code's Task/subagent tool, or any built-in SendMessage). Do NOT use those to do the work yourself — they are not teammates and bypass team coordination.\n\n` +
      `Workflow:\n` +
      `1. Analyze the user's request and decide whether the current team is sufficient.\n` +
      `2. If more teammates would help, FIRST call team_list_assistants to read the real assistant catalog, then team_list_models for candidate models — never guess assistant_id or model.\n` +
      `3. Reply with a staffing proposal: one short sentence on why more teammates help, then a table (teammate name, responsibility, recommended assistant, recommended model).\n` +
      `4. Ask the user whether to create them as proposed or to adjust. Do NOT call team_spawn_agent in that same turn — wait for the user's confirmation in the next message.\n` +
      `5. After confirmation, create teammates with team_spawn_agent, break the work into tasks (team_task_create), and assign them via team_send_message.\n` +
      `6. When teammates report back, review results, decide next steps, and synthesize a final answer for the user.\n\n` +
      `Coordinate only through the team_* tools.`
    );
  }
  return (
    `${GOVERNANCE_HEADER}\n` +
    `You are "${memberName}", a TEAMMATE of team "${teamName}".\n\n` +
    `${PRIORITY_BLOCK}\n\n` +
    `- Execute the task the leader assigned to you.\n` +
    `- When you finish, get blocked, or have nothing to do, notify the leader via team_send_message (an idle notification).\n` +
    `- Coordinate only through the team_* tools.`
  );
}

/**
 * Extract the team governance block from a presetContext so AcpAgent can
 * preserve it across its per-message rules reload (and re-inject it on later
 * turns). Returns null for non-team sessions where no governance block exists.
 */
export function extractGovernanceBlock(presetContext: string | undefined | null): string | null {
  if (!presetContext) return null;
  const start = presetContext.indexOf(GOVERNANCE_HEADER);
  if (start < 0) return null;
  // governance ends at the next top-level block: another `[xxx]` marker block,
  // or a `## ` markdown section (preset runtime appends `## Available Scripts` /
  // `## Ops Entry Point` after governance). governance's own body uses neither,
  // so this boundary is exact and excludes the appendix.
  const afterHeader = start + GOVERNANCE_HEADER.length;
  const candidates = [presetContext.indexOf('\n\n[', afterHeader), presetContext.indexOf('\n\n## ', afterHeader)].filter((i) => i > 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : -1;
  return end > start ? presetContext.slice(start, end) : presetContext.slice(start);
}
