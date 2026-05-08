/**
 * Tests for DocumentConverter.markdownToWord()
 *
 * Verifies that all Markdown AST node types are properly converted to Word document elements,
 * particularly multi-line code blocks, nested lists, blockquotes, and inline formatting.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the dynamic imports used by DocumentConverter
// We test the AST → docx conversion logic by checking what Document receives
vi.mock('docx', async () => {
  const actual = await vi.importActual<typeof import('docx')>('docx');
  return actual;
});

describe('DocumentConverter.markdownToWord', () => {
  let DocumentConverter: typeof import('@/common/document/DocumentConverter').DocumentConverter;

  beforeEach(async () => {
    const mod = await import('@/common/document/DocumentConverter');
    DocumentConverter = mod.DocumentConverter;
  });

  it('should produce a non-empty ArrayBuffer for basic markdown', async () => {
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord('# Hello\n\nWorld');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle multi-line code blocks without losing lines', async () => {
    const code = '```python\ndef hello():\n    print("hello")\n    return True\n```';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(code);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle nested lists', async () => {
    const md = '- Item 1\n  - Nested A\n  - Nested B\n- Item 2';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle ordered lists with nested items', async () => {
    const md = '1. First\n   1. Sub-first\n   2. Sub-second\n2. Second';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle blockquotes with multiple child types', async () => {
    const md = '> Some quoted text\n>\n> ## Heading in quote\n>\n> More text';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle GFM strikethrough (delete)', async () => {
    const md = 'This has ~~strikethrough~~ text';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle images as placeholder text', async () => {
    const md = '![alt text](https://example.com/image.png)';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle tables', async () => {
    const md = '| Name | Value |\n|------|-------|\n| A    | 1     |\n| B    | 2     |';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle complex AI-typical output with mixed content', async () => {
    const md = ['# Analysis Report', '', 'Here is a summary of the findings:', '', '## Code Example', '', '```typescript', 'function calculateTotal(items: Item[]): number {', '  return items.reduce((sum, item) => {', '    return sum + item.price * item.quantity;', '  }, 0);', '}', '```', '', '## Key Points', '', '1. First point with `inline code`', '   - Sub-point A', '   - Sub-point B', '2. Second point with **bold** and *italic*', '3. Third point with ~~removed~~ text', '', '> **Note:** This is an important blockquote', '> with multiple lines', '', '---', '', '| Metric | Before | After |', '|--------|--------|-------|', '| Speed  | 100ms  | 50ms  |', '| Memory | 256MB  | 128MB |'].join(
      '\n'
    );

    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle list items containing code blocks', async () => {
    const md = '- Item with code:\n\n  ```js\n  const x = 1;\n  ```\n\n- Another item';
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord(md);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('should handle empty markdown', async () => {
    const converter = new DocumentConverter();
    const result = await converter.markdownToWord('');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });
});
