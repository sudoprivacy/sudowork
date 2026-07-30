import { describe, expect, it } from 'vitest';
import { StreamingThinkFilter } from '@/process/task/acp/StreamingThinkFilter';

function feedAll(filter: StreamingThinkFilter, chunks: string[]): string {
  return chunks.map((c) => filter.feed(c).content).join('');
}

describe('StreamingThinkFilter', () => {
  describe('think blocks (content stripping)', () => {
    it('strips a complete <think>...</think> block within one chunk', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['<think>secret</think>visible'])).toBe('visible');
    });

    it('strips a <thinking>...</thinking> block', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['<thinking>secret</thinking>visible'])).toBe('visible');
    });

    it('handles an opening tag split across chunks', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['<thi', 'nk>secret</think>visible'])).toBe('visible');
    });

    it('handles a closing tag split across chunks', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['<think>secret</thi', 'nk>visible'])).toBe('visible');
    });

    it('keeps content empty for an unclosed <think> and does not leak at flush', () => {
      const f = new StreamingThinkFilter();
      expect(f.feed('<think>secret').content).toBe('');
      expect(f.flush()).toBe('');
    });
  });

  describe('think extraction (thinkDelta / thinkFull)', () => {
    it('returns the think content as thinkDelta (increment) and thinkFull (complete)', () => {
      const f = new StreamingThinkFilter();
      const r = f.feed('<think>secret</think>visible');
      expect(r.content).toBe('visible');
      expect(r.thinkDelta).toBe('secret');
      expect(r.thinkFull).toBe('secret');
    });

    it('accumulates think across chunks: delta is the increment, full is complete', () => {
      const f = new StreamingThinkFilter();
      const r1 = f.feed('<think>hel');
      expect(r1.content).toBe('');
      expect(r1.thinkDelta).toBe('hel');
      expect(r1.thinkFull).toBe('hel');
      const r2 = f.feed('lo');
      expect(r2.content).toBe('');
      expect(r2.thinkDelta).toBe('lo');
      expect(r2.thinkFull).toBe('hello');
      const r3 = f.feed('</think>world');
      expect(r3.content).toBe('world');
      expect(r3.thinkDelta).toBeNull();
      expect(r3.thinkFull).toBeNull();
    });

    it('returns thinkDelta/thinkFull=null when no new think text arrived (close-only chunk)', () => {
      const f = new StreamingThinkFilter();
      f.feed('<think>secret');
      const r = f.feed('</think>visible');
      expect(r.content).toBe('visible');
      expect(r.thinkDelta).toBeNull();
      expect(r.thinkFull).toBeNull();
    });

    it('merges multiple think blocks with a \\n\\n separator (delta carries it with content)', () => {
      const f = new StreamingThinkFilter();
      const first = f.feed('<think>a</think>');
      expect(first.thinkDelta).toBe('a');
      expect(first.thinkFull).toBe('a');
      const r = f.feed('x<think>b</think>y');
      expect(r.content).toBe('xy');
      expect(r.thinkDelta).toBe('\n\nb');
      expect(r.thinkFull).toBe('a\n\nb');
    });

    it('emits think incrementally even when unclosed at flush', () => {
      const f = new StreamingThinkFilter();
      const r = f.feed('<think>secret');
      expect(r.thinkDelta).toBe('secret');
      expect(r.thinkFull).toBe('secret');
      expect(f.flush()).toBe('');
    });

    it('does not report think for normal text', () => {
      const f = new StreamingThinkFilter();
      expect(f.feed('hello world').thinkDelta).toBeNull();
      expect(f.feed('hello world').thinkFull).toBeNull();
    });
  });

  describe('normal text (constraint: do not affect sudorouter-style output)', () => {
    it('passes plain text through unchanged', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['hello world'])).toBe('hello world');
    });

    it('does not swallow HTML / code-like angle brackets', () => {
      const f1 = new StreamingThinkFilter();
      expect(feedAll(f1, ['<div>hi</div>'])).toBe('<div>hi</div>');
      const f2 = new StreamingThinkFilter();
      expect(feedAll(f2, ['<table>x</table>'])).toBe('<table>x</table>');
    });

    it('uses strict matching: "< think>" (with space) is not a tag', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['a < think> b'])).toBe('a < think> b');
    });

    it('passes a stray </think> (no opening tag) through for renderer fallback', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['thinking</think>rest'])).toBe('thinking</think>rest');
    });

    it('reunites a lone "<" across chunks without losing it', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['a <', ' b'])).toBe('a < b');
    });

    it('reunites a "<thi" + non-think across chunks without losing text', () => {
      const f = new StreamingThinkFilter();
      expect(feedAll(f, ['<thi', 'ng>'])).toBe('<thing>');
    });
  });

  describe('flush (no trailing char loss)', () => {
    it('flush releases a trailing "<" as normal text', () => {
      const f = new StreamingThinkFilter();
      expect(f.feed('a <').content).toBe('a ');
      expect(f.flush()).toBe('<');
    });

    it('flush releases a trailing "<thi" prefix as normal text', () => {
      const f = new StreamingThinkFilter();
      expect(f.feed('x<thi').content).toBe('x');
      expect(f.flush()).toBe('<thi');
    });
  });

  describe('defensive error recovery (feed catch resets state)', () => {
    it('resets accumulated think state when feed() catches an internal anomaly', () => {
      const f = new StreamingThinkFilter();
      // Precondition: a prior think block leaves accumulatedThink non-empty
      // and hadAnyThink=true.
      f.feed('<think>old</think>');

      // Drive feed() into its defensive catch. A Symbol cannot be implicitly
      // coerced to string, so `pendingTail + chunk` (StreamingThinkFilter.ts:94)
      // throws TypeError inside the try block. This couples only to feed()'s
      // public input contract (it concatenates the chunk) — no private-method
      // name, no vi.spyOn / mock.
      const sym = Symbol('boom');
      const r = f.feed(sym as unknown as string);
      expect(r.content).toBe(sym);
      expect(r.thinkDelta).toBeNull();
      expect(r.thinkFull).toBeNull();

      // After the catch the filter must be clean: a subsequent think block must
      // NOT merge with pre-anomaly 'old' nor prepend a stray '\n\n'.
      // (Pre-fix: thinkFull would be 'old\n\nfresh', thinkDelta '\n\nfresh'.)
      const after = f.feed('<think>fresh</think>');
      expect(after.content).toBe('');
      expect(after.thinkDelta).toBe('fresh');
      expect(after.thinkFull).toBe('fresh');
    });
  });
});
