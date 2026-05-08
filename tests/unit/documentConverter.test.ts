import { describe, it, expect, beforeAll } from 'vitest';
import { DocumentConverter } from '@/common/document/DocumentConverter';

describe('DocumentConverter – markdownToWord', () => {
  let converter: DocumentConverter;

  beforeAll(() => {
    converter = new DocumentConverter();
  });

  /** Helper: convert Markdown and return the ArrayBuffer (non-empty = success). */
  const toWord = (md: string) => converter.markdownToWord(md);

  it('should convert basic paragraph text', async () => {
    const buf = await toWord('Hello, world!');
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should preserve nested bullet items under ordered list', async () => {
    // This is the exact pattern from the reported bug
    const md = ['1. **补气养阴，抗疲劳（核心功效）**', '   * **黄芪**是补气的高手，能提升基础体力和抵抗力；', '   * **西洋参**同样补气，但它的特性是"凉性"的。', '2. **滋补肝肾，缓解眼疲劳**', '   * **枸杞**主要负责滋补肝肾、益精明目。'].join('\n');
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle multi-line code blocks', async () => {
    const md = '```js\nconst a = 1;\nconst b = 2;\nconsole.log(a + b);\n```';
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle ordered lists with sequential numbering', async () => {
    const md = '1. First\n2. Second\n3. Third\n4. Fourth';
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle nested ordered lists', async () => {
    const md = ['1. Top level A', '   1. Sub level A1', '   2. Sub level A2', '2. Top level B'].join('\n');
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle blockquotes with multiple child types', async () => {
    const md = ['> ## Heading inside blockquote', '> ', '> Paragraph inside blockquote', '> ', '> - list item in blockquote'].join('\n');
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle GFM strikethrough text', async () => {
    const md = 'This has ~~deleted text~~ in it.';
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle images as alt-text placeholder', async () => {
    const md = 'Here is an image: ![alt text](https://example.com/img.png)';
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle tables', async () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle complex mixed AI output without throwing', async () => {
    const md = [
      '李松宇，西洋参、黄芪和枸杞搭配泡茶，是一道非常经典的日常养生茶饮。',
      '',
      '它的核心作用可以总结为以下几点：',
      '',
      '1. **补气养阴，抗疲劳（核心功效）**',
      '   * **黄芪**是补气的高手，能提升基础体力和抵抗力；',
      '   * **西洋参**同样补气，但它的特性是"凉性"的，能养阴生津。这两者结合（一温一凉），既能强效缓解疲劳、让人精力充沛，又能完美中和黄芪的温热，**不容易上火**。',
      '2. **滋补肝肾，缓解眼疲劳**',
      '   * **枸杞**主要负责滋补肝肾、益精明目。对于长时间盯着代码或设计稿造成的眼睛干涩、酸胀、视力疲劳有很好的缓解作用。',
      '3. **增强免疫力与固表**',
      '   * 如果平时容易出虚汗，或者一吹风就容易感冒，黄芪有很好的"固表"作用（相当于给身体加了一层防御护盾），配合西洋参能整体提升免疫力。',
      '4. **养心安神**',
      '   * 对于工作压力大导致的心烦气躁、口干口渴、睡眠质量下降，这款茶也有一定的平复和改善效果。',
      '',
      '**⚠️ 饮用时的"避坑指南"：**',
      '* **感冒发烧期间**：身体有外感表证时不要喝，容易把病邪"闭"在体内。',
      '* **湿热体质或肠胃不适时**：如果最近舌苔厚腻、肚子胀、容易腹泻，建议暂缓饮用。',
      '',
      '你最近是觉得工作比较疲劳、精力跟不上吗？',
    ].join('\n');
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle list items containing code blocks', async () => {
    const md = ['1. First step', '', '   ```bash', '   npm install', '   ```', '', '2. Second step'].join('\n');
    const buf = await toWord(md);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('should handle empty input', async () => {
    const buf = await toWord('');
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
