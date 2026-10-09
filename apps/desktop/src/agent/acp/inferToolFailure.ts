/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fallback heuristic: detect tool failure from output content when the backend
 * did not explicitly set `isError`.
 *
 * Convention: a tool whose stdout is a JSON object with a top-level `"error"`
 * key (and no substantive data alongside it) is treated as failed.
 * This matches ai-dev-browser's structured error format and is a common CLI
 * tool convention.
 */
export function inferToolFailure(content?: unknown, meta?: string): boolean {
  // Try structured content array first (ACP content items)
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isErrorContent(item)) return true;
    }
  }

  // Try meta string (fallback text representation)
  if (typeof meta === 'string' && meta.trim()) {
    if (isErrorJson(meta)) return true;
  }

  return false;
}

function isErrorContent(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;

  // ACP content item: { type: 'content', content: { type: 'text', text: '...' } }
  if (rec.type === 'content' && rec.content && typeof rec.content === 'object') {
    const inner = rec.content as Record<string, unknown>;
    if (inner.type === 'text' && typeof inner.text === 'string') {
      return isErrorJson(inner.text);
    }
  }

  return false;
}

function isErrorJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;

    // Must have an "error" key with a truthy value
    if (!parsed.error) return false;

    // If the object has other substantive keys beyond "error", this may be a
    // success response that happens to include an error field as a warning.
    // Only treat as failure when "error" is the dominant signal.
    const keys = Object.keys(parsed).filter((k) => k !== 'error');
    if (keys.length > 1) return false;

    return true;
  } catch {
    return false;
  }
}
