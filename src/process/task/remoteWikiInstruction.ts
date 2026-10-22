/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wiki steering for remote (moss) sessions.
 *
 * Moss advertises the session's `enabled_wikis` to the agent only once, in the
 * first user message. The agent's `wiki` CLI can read any wiki the user may use,
 * so when the user changes the selection mid-chat (or #-mentions a wiki for one
 * message) we tell the agent in a short block prepended to that message.
 */

export interface IWikiRef {
  id: string;
  name: string;
  description?: string | null;
}

export interface IWikiInstructionPlan {
  /** New sticky selection to announce, or null when unchanged. */
  selected: string[] | null;
  /** Wikis mentioned for this message only (not already in the sticky set). */
  mentioned: string[];
}

export function normalizeWikiIds(ids: readonly string[] | null | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))].sort();
}

export function isSameWikiSet(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const left = normalizeWikiIds(a);
  const right = normalizeWikiIds(b);
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

/** Decide which blocks this message needs. Nothing is sent when the selection is unchanged and nothing is mentioned. */
export function planWikiInstruction(input: { enabled?: readonly string[] | null; advertised?: readonly string[] | null; mentioned?: readonly string[] | null }): IWikiInstructionPlan {
  const enabled = normalizeWikiIds(input.enabled);
  const selected = isSameWikiSet(enabled, input.advertised) ? null : enabled;
  const mentioned = normalizeWikiIds(input.mentioned).filter((id) => !enabled.includes(id));
  return { selected, mentioned };
}

function formatRefs(refs: IWikiRef[]): string {
  return refs.map((w) => `- ${w.id}: ${w.name}${w.description ? ` — ${w.description}` : ''}`).join('\n');
}

/** Build the instruction text for a plan; null when there's nothing to say. */
export function buildWikiInstruction(plan: { selected: IWikiRef[] | null; mentioned: IWikiRef[] }): string | null {
  const blocks: string[] = [];
  if (plan.selected) {
    blocks.push(
      plan.selected.length > 0
        ? `[Selected Wikis]\nThe user changed the knowledge bases (wikis) for this conversation. From now on use only these, via the \`wiki\` CLI with their ids, and ignore any wikis listed earlier:\n${formatRefs(plan.selected)}`
        : '[Selected Wikis]\nThe user removed all knowledge bases (wikis) from this conversation. Do not use the `wiki` CLI unless the user asks again.'
    );
  }
  if (plan.mentioned.length > 0) {
    blocks.push(`[Wikis for this request]\nFor this message only, also consult these knowledge bases (wikis) via the \`wiki\` CLI with their ids:\n${formatRefs(plan.mentioned)}`);
  }
  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

/** Prepend the block; the `[User Request]` marker lets the UI show only the user's text. */
export function wrapWithWikiInstruction(content: string, instruction: string | null): string {
  if (!instruction) return content;
  return `${instruction}\n\n[User Request]\n${content}`;
}

/** Resolve ids to names via moss `/api/v1/wikis/usable`; ids the user may no longer use are dropped. */
export async function fetchWikiRefs(serverUrl: string, token: string, ids: readonly string[]): Promise<IWikiRef[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/wikis/usable`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`wikis/usable: HTTP ${res.status}`);
  const data = (await res.json()) as { wikis?: Array<{ id: string; name: string; description?: string | null }> };
  const byId = new Map((data.wikis ?? []).map((w) => [w.id, w]));
  return ids.flatMap((id) => {
    const wiki = byId.get(id);
    return wiki ? [{ id: wiki.id, name: wiki.name, description: wiki.description ?? null }] : [];
  });
}
