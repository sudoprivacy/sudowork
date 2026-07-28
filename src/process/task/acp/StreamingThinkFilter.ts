/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Streaming think-tag filter state machine.
 *
 * Filters `<think>...</think>` / `<thinking>...</thinking>` blocks out of a
 * stream of text chunks where the tags may be split across chunk boundaries.
 *
 * Design constraints (must not affect models that never emit think tags, e.g.
 * sudorouter):
 * - In normal state, ONLY an opening `<think>`/`<thinking>` triggers content
 *   consumption. A stray closing tag (e.g. MiniMax M2.5 emits only `</think>`
 *   with no opening) is passed through verbatim, so the renderer's whole-text
 *   fallback regex (thinkTagFilter.ts Step 3) can still clean it up.
 * - Matching is strict (no `\s*` tolerance): MiniMax-M3 emits `<think>` with no
 *   spaces, so this is sufficient and avoids swallowing literal `< think>` text
 *   in normal prose / code.
 * - Any exception resets the machine to a known normal state and returns the
 *   original chunk unchanged — a filter anomaly must never break the stream.
 */

const OPEN_TAGS = ['<think>', '<thinking>'];
const CLOSE_TAGS = ['</think>', '</thinking>'];
const MAX_PENDING = 10; // len('</thinking') === 10

function findEarliestTag(buffer: string, tags: string[]): { idx: number; tag: string } | null {
  let best: { idx: number; tag: string } | null = null;
  for (const tag of tags) {
    const idx = buffer.indexOf(tag);
    if (idx >= 0 && (best === null || idx < best.idx)) {
      best = { idx, tag };
    }
  }
  return best;
}

/**
 * Length of the longest suffix of `buffer` that is a STRICT prefix of one of
 * `tags` (shorter than the full tag). The tail is held until the next chunk
 * resolves whether it is a real (possibly split) tag or ordinary text.
 */
function trailingPrefixLen(buffer: string, tags: string[]): number {
  let maxLen = 0;
  for (const tag of tags) {
    const limit = Math.min(buffer.length, tag.length - 1, MAX_PENDING);
    for (let len = limit; len > maxLen; len--) {
      if (buffer.endsWith(tag.slice(0, len))) {
        maxLen = len;
        break;
      }
    }
  }
  return maxLen;
}

export class StreamingThinkFilter {
  private isInThink = false;
  private pendingTail = '';

  /** Feed one chunk; returns the non-think text that should be displayed now (may be ''). */
  feed(chunk: string): string {
    try {
      let buffer = this.pendingTail + chunk;
      this.pendingTail = '';
      let output = '';
      let guard = 0;
      while (buffer.length > 0 && guard++ < 1000) {
        if (this.isInThink) {
          const found = findEarliestTag(buffer, CLOSE_TAGS);
          if (found) {
            buffer = buffer.slice(found.idx + found.tag.length);
            this.isInThink = false;
          } else {
            const prefixLen = trailingPrefixLen(buffer, CLOSE_TAGS);
            this.pendingTail = buffer.slice(buffer.length - prefixLen);
            buffer = '';
          }
        } else {
          const found = findEarliestTag(buffer, OPEN_TAGS);
          if (found) {
            output += buffer.slice(0, found.idx);
            buffer = buffer.slice(found.idx + found.tag.length);
            this.isInThink = true;
          } else {
            const prefixLen = trailingPrefixLen(buffer, OPEN_TAGS);
            output += buffer.slice(0, buffer.length - prefixLen);
            this.pendingTail = buffer.slice(buffer.length - prefixLen);
            buffer = '';
          }
        }
      }
      return output;
    } catch {
      // Defensive: never let a filter anomaly break the stream. Reset to a
      // known normal state and pass the original chunk through verbatim.
      this.isInThink = false;
      this.pendingTail = '';
      return chunk;
    }
  }

  /**
   * Flush at stream end. Returns any pending tail that should be displayed:
   * - normal state: the tail is ordinary text (e.g. a trailing `<`), return it.
   * - think state (unclosed `<think>`): the tail is inside think, drop it and reset.
   */
  flush(): string {
    try {
      const tail = this.pendingTail;
      this.pendingTail = '';
      if (this.isInThink) {
        this.isInThink = false;
        return '';
      }
      return tail;
    } catch {
      this.isInThink = false;
      this.pendingTail = '';
      return '';
    }
  }
}
