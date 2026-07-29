import { describe, expect, it } from 'vitest';
import { StreamingThinkFilter } from '@/process/task/acp/StreamingThinkFilter';

function feedAll(filter: StreamingThinkFilter, chunks: string[]): string {
  return chunks.map((c) => filter.feed(c)).join('');
}

describe('StreamingThinkFilter', () => {
  describe('think blocks', () => {
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

    it('drops an unclosed <think> at flush (still inside think)', () => {
      const f = new StreamingThinkFilter();
      expect(f.feed('<think>secret')).toBe('');
      expect(f.flush()).toBe('');
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
      expect(f.feed('a <')).toBe('a ');
      expect(f.flush()).toBe('<');
    });

    it('flush releases a trailing "<thi" prefix as normal text', () => {
      const f = new StreamingThinkFilter();
      expect(f.feed('x<thi')).toBe('x');
      expect(f.flush()).toBe('<thi');
    });
  });
});
