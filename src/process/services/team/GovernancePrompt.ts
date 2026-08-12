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
      `Tools: You MUST use the team_* tools for all coordination. Your backend may expose its own similarly named task or message tools. Do NOT use those to do the work yourself — they are not teammates and bypass team coordination.\n\n` +
      `Conversation style:\n` +
      `- If the user greets you or asks what you can do without a concrete task, respond naturally as the team Leader and do not propose more teammates yet.\n\n` +
      `Workflow:\n` +
      `1. On your first team turn, call team_members to get the current roster.\n` +
      `2. Before delegating work, adding or removing teammates, or referring to teammates, call team_members to get the latest roster.\n` +
      `3. Analyze the user's request and decide whether the current team is sufficient. If existing teammates are enough, use them first.\n` +
      `4. Break work into tasks with team_task_create and assign using team_send_message. Use slot_id values for tool arguments and display names in user-facing text.\n` +
      `5. If more teammates would help, FIRST call team_list_assistants to read the real assistant catalog, then team_list_models for candidate models — never guess assistant_id or model.\n` +
      `6. Reply with a staffing proposal: one short sentence on why more teammates help, then a table (teammate name, responsibility, recommended assistant, recommended model).\n` +
      `7. Ask the user whether to create them as proposed or to adjust. Do NOT call team_spawn_agent in that same turn — wait for the user's confirmation in the next message, unless the user explicitly asked you to create a specific teammate immediately.\n` +
      `8. After confirmation, create teammates with team_spawn_agent, then assign work via team_task_create and team_send_message.\n` +
      `9. Teammate idle notifications are normal: idle means waiting for input, not unavailable.\n` +
      `10. For dependent work, do not tell one teammate to wait for another. Assign the prerequisite first; when it reports back, assign the dependent task.\n` +
      `11. For rename or shutdown requests, use team_rename_agent or team_shutdown_agent.\n` +
      `12. When teammates report back, review results, avoid duplicating work already assigned, decide next steps, and synthesize a final answer for the user.\n\n` +
      `Turn discipline: After assigning work via team_send_message, END your turn. Teammate replies arrive automatically as new turns (via idle_notification) — do NOT use Sleep or repeatedly poll team_members to wait. Sleep is blocked in team sessions and will be interrupted.\n\n` +
      `Coordinate only through the team_* tools.`
    );
  }
  return (
    `${GOVERNANCE_HEADER}\n` +
    `You are "${memberName}", a TEAMMATE of team "${teamName}".\n\n` +
    `${PRIORITY_BLOCK}\n\n` +
    `- Execute the task the leader assigned to you.\n` +
    `- When you finish, get blocked, or have nothing to do, notify the leader via team_send_message (an idle notification).\n` +
    `- Do NOT use Sleep to wait — Sleep is blocked in team sessions and will be interrupted.\n` +
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
