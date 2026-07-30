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
 * The text inside the tags is accumulated and surfaced as `thinkFull` (the
 * FULL accumulated text so far, for DB replace-merge) and `thinkDelta` (the
 * this-call increment, for IPC append-merge) instead of being dropped, so
 * callers can route it to the dedicated reasoning surface (MessageThought).
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
 *   original chunk unchanged (thinkText=null) — a filter anomaly must never
 *   break the stream.
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
  // Accumulated text inside <think>/<thinking> blocks for this filter (one
  // filter per content msg_id). Persists across feed() calls so multi-chunk and
  // multi-block think content merges into one reasoning block; reset on flush().
  // Returned as thinkFull (complete value, for DB replace) and thinkDelta
  // (this-call increment, for IPC append).
  private accumulatedThink = '';
  // True once any <think> block has been entered; gates the inter-block
  // separator so the FIRST block has no leading separator.
  private hadAnyThink = false;
  // Set when a new <think> block opens after a prior block; flushed as a "\n\n"
  // prefix on the next think-text accumulation so the separator always travels
  // with content (never emitted as a standalone whitespace-only delta).
  private pendingThinkSeparator = false;

  /**
   * Feed one chunk. Returns `{ content, thinkDelta, thinkFull }`:
   * - `content`: the non-think text to display now (may be '').
   * - `thinkDelta`: when new think text accumulated this call, the increment
   *   added this call (for IPC append-style merge); otherwise null.
   * - `thinkFull`: when new think text accumulated this call, the FULL
   *   accumulated think text so far (for DB replace-style merge); otherwise null.
   * Multiple <think> blocks in one filter merge with a `\n\n` separator that
   * always rides along with content (never a standalone whitespace delta).
   */
  feed(chunk: string): { content: string; thinkDelta: string | null; thinkFull: string | null } {
    try {
      let buffer = this.pendingTail + chunk;
      this.pendingTail = '';
      let output = '';
      const prevLen = this.accumulatedThink.length;
      let hadNewThink = false;
      let guard = 0;
      while (buffer.length > 0 && guard++ < 1000) {
        if (this.isInThink) {
          const found = findEarliestTag(buffer, CLOSE_TAGS);
          if (found) {
            // Text before the close tag is think content; accumulate it.
            if (found.idx > 0) {
              this.appendThink(buffer.slice(0, found.idx));
              hadNewThink = true;
            }
            buffer = buffer.slice(found.idx + found.tag.length);
            this.isInThink = false;
          } else {
            const prefixLen = trailingPrefixLen(buffer, CLOSE_TAGS);
            // Everything except a possible split close-tag suffix is think content.
            const thinkPart = buffer.slice(0, buffer.length - prefixLen);
            if (thinkPart) {
              this.appendThink(thinkPart);
              hadNewThink = true;
            }
            this.pendingTail = buffer.slice(buffer.length - prefixLen);
            buffer = '';
          }
        } else {
          const found = findEarliestTag(buffer, OPEN_TAGS);
          if (found) {
            output += buffer.slice(0, found.idx);
            // Entering a new think block: if we already had one, queue a
            // separator to be emitted ahead of this block's first content.
            if (this.hadAnyThink) this.pendingThinkSeparator = true;
            this.hadAnyThink = true;
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
      return {
        content: output,
        thinkDelta: hadNewThink ? this.accumulatedThink.slice(prevLen) : null,
        thinkFull: hadNewThink ? this.accumulatedThink : null,
      };
    } catch {
      // Defensive: never let a filter anomaly break the stream. Reset to a
      // known normal state and pass the original chunk through verbatim.
      this.isInThink = false;
      this.pendingTail = '';
      return { content: chunk, thinkDelta: null, thinkFull: null };
    }
  }

  /**
   * Accumulate think text, prepending the queued inter-block separator (if any)
   * so it always travels with real content rather than emitting a
   * whitespace-only delta.
   */
  private appendThink(text: string): void {
    if (this.pendingThinkSeparator) {
      this.accumulatedThink += '\n\n';
      this.pendingThinkSeparator = false;
    }
    this.accumulatedThink += text;
  }

  /**
   * Flush at stream end. Returns any pending tail that should be displayed:
   * - normal state: the tail is ordinary text (e.g. a trailing `<`), return it.
   * - think state (unclosed `<think>`): the tail is inside think, drop it and reset.
   * Think content accumulated so far was already emitted incrementally via
   * feed() thinkText, so flush only resets accumulatedThink without re-emitting.
   */
  flush(): string {
    try {
      const tail = this.pendingTail;
      this.pendingTail = '';
      this.accumulatedThink = '';
      this.hadAnyThink = false;
      this.pendingThinkSeparator = false;
      if (this.isInThink) {
        this.isInThink = false;
        return '';
      }
      return tail;
    } catch {
      this.isInThink = false;
      this.pendingTail = '';
      this.accumulatedThink = '';
      this.hadAnyThink = false;
      this.pendingThinkSeparator = false;
      return '';
    }
  }
}
