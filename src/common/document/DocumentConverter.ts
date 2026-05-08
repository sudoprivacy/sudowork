/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextRun as ITextRun, FileChild } from 'docx';
/**
 * 文档转换器 - Markdown 中心化
 *
 * 核心理念：所有可编辑文档都转换为 Markdown 进行统一编辑
 * Word/Excel → Markdown → 编辑 → Word/Excel/PDF
 */
export class DocumentConverter {
  /**
   * Word → Markdown
   * 使用 mammoth + turndown
   */
  async wordToMarkdown(arrayBuffer: ArrayBuffer): Promise<string> {
    // 动态导入以减少初始加载
    const mammoth = await import('mammoth');
    const TurndownService = (await import('turndown')).default;
    const { gfm } = await import('turndown-plugin-gfm');

    // 1. Word → HTML
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;

    // 2. HTML → Markdown
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    turndown.use(gfm); // 支持 GitHub Flavored Markdown (表格等)

    const markdown = turndown.turndown(html);

    return markdown;
  }

  /**
   * Markdown → Word
   * 使用 docx 库将 Markdown 转换为 Word 文档
   */
  async markdownToWord(markdown: string): Promise<ArrayBuffer> {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = await import('docx');
    const { unified } = await import('unified');
    const remarkParse = (await import('remark-parse')).default;
    const remarkGfm = (await import('remark-gfm')).default;

    // 1. 解析 Markdown 为 AST
    const processor = unified().use(remarkParse).use(remarkGfm);
    const ast = processor.parse(markdown);

    const children: FileChild[] = [];

    // Monotonically increasing numbering instance counter so each
    // top-level ordered list gets its own continuous sequence.
    let numberingInstance = 0;

    // 辅助函数：处理内联节点 (text, strong, emphasis, inlineCode, link, delete, image)
    const processInlineNodes = (nodes: any[], baseOptions: any = {}): ITextRun[] => {
      const runs: ITextRun[] = [];
      for (const node of nodes) {
        if (node.type === 'text') {
          runs.push(new TextRun({ ...baseOptions, text: node.value }));
        } else if (node.type === 'strong') {
          runs.push(...processInlineNodes(node.children, { ...baseOptions, bold: true }));
        } else if (node.type === 'emphasis') {
          runs.push(...processInlineNodes(node.children, { ...baseOptions, italics: true }));
        } else if (node.type === 'delete') {
          runs.push(...processInlineNodes(node.children, { ...baseOptions, strike: true }));
        } else if (node.type === 'inlineCode') {
          runs.push(
            new TextRun({
              ...baseOptions,
              text: node.value,
              font: 'Consolas',
              shading: { fill: 'F0F0F0' },
            })
          );
        } else if (node.type === 'link') {
          runs.push(
            ...processInlineNodes(node.children, {
              ...baseOptions,
              color: '0563C1',
              underline: {},
            })
          );
        } else if (node.type === 'image') {
          // Render image alt text as placeholder
          const alt = node.alt || node.url || 'image';
          runs.push(new TextRun({ ...baseOptions, text: `[${alt}]`, italics: true }));
        } else if (node.type === 'break') {
          runs.push(new TextRun({ ...baseOptions, text: '', break: 1 }));
        }
      }
      return runs;
    };

    /**
     * Recursively process a list node and all nested list items.
     * @param listNode  - an AST node of type 'list'
     * @param level     - nesting depth (0 = top-level)
     * @param instance  - numbering instance for ordered lists
     */
    const processList = (listNode: any, level: number, instance: number) => {
      for (const listItem of listNode.children) {
        let isFirstChild = true;
        for (const child of listItem.children) {
          if (child.type === 'paragraph') {
            // The first paragraph carries the bullet / number.
            // Continuation paragraphs are indented but not bulleted.
            children.push(
              new Paragraph({
                children: processInlineNodes(child.children),
                bullet: listNode.ordered ? undefined : isFirstChild ? { level } : undefined,
                numbering: listNode.ordered && isFirstChild ? { reference: 'main-numbering', level, instance } : undefined,
                indent: !isFirstChild && !listNode.ordered ? { left: 720 * (level + 1) } : undefined,
                spacing: { before: 60, after: 60 },
              })
            );
            isFirstChild = false;
          } else if (child.type === 'list') {
            // Nested list — recurse with deeper level
            processList(child, level + 1, instance);
          } else {
            // Other block-level content inside list items (code, blockquote, etc.)
            // Delegate to visit() so they get rendered in place
            visit(child);
          }
        }
      }
    };

    // 2. 遍历 AST 节点
    const visit = (node: any) => {
      switch (node.type) {
        case 'heading': {
          const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
          children.push(
            new Paragraph({
              heading: levels[node.depth - 1] || HeadingLevel.HEADING_1,
              children: processInlineNodes(node.children),
              spacing: { before: 240, after: 120 },
            })
          );
          break;
        }
        case 'paragraph': {
          children.push(
            new Paragraph({
              children: processInlineNodes(node.children),
              spacing: { before: 120, after: 120 },
            })
          );
          break;
        }
        case 'list': {
          const instance = numberingInstance++;
          processList(node, 0, instance);
          break;
        }
        case 'code': {
          // Split multi-line code into separate TextRun entries with break:1
          // so that newlines are preserved in Word.
          const lines = (node.value as string).split('\n');
          const codeRuns: ITextRun[] = [];
          lines.forEach((line, i) => {
            if (i > 0) {
              codeRuns.push(new TextRun({ text: '', break: 1 }));
            }
            codeRuns.push(new TextRun({ text: line, font: 'Consolas' }));
          });
          children.push(
            new Paragraph({
              children: codeRuns,
              shading: { fill: 'F5F5F5' },
              border: {
                top: { color: 'E0E0E0', space: 1, style: BorderStyle.SINGLE, size: 6 },
                bottom: { color: 'E0E0E0', space: 1, style: BorderStyle.SINGLE, size: 6 },
                left: { color: 'E0E0E0', space: 1, style: BorderStyle.SINGLE, size: 6 },
                right: { color: 'E0E0E0', space: 1, style: BorderStyle.SINGLE, size: 6 },
              },
              spacing: { before: 120, after: 120 },
            })
          );
          break;
        }
        case 'blockquote': {
          const bqStyle = {
            indent: { left: 720 },
            border: {
              left: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 24 },
            },
            spacing: { before: 120, after: 120 },
          };
          node.children.forEach((child: any) => {
            if (child.type === 'paragraph') {
              children.push(
                new Paragraph({
                  children: processInlineNodes(child.children),
                  ...bqStyle,
                })
              );
            } else if (child.type === 'heading') {
              const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
              children.push(
                new Paragraph({
                  heading: levels[child.depth - 1] || HeadingLevel.HEADING_1,
                  children: processInlineNodes(child.children),
                  ...bqStyle,
                })
              );
            } else {
              // Lists, code blocks, etc. inside blockquotes
              visit(child);
            }
          });
          break;
        }
        case 'table': {
          const rows = node.children.map((row: any) => {
            return new TableRow({
              children: row.children.map((cell: any) => {
                return new TableCell({
                  children: [
                    new Paragraph({
                      children: processInlineNodes(cell.children),
                    }),
                  ],
                  shading: { fill: row === node.children[0] ? 'F2F2F2' : undefined },
                });
              }),
            });
          });
          children.push(
            new Table({
              rows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
          );
          break;
        }
        case 'thematicBreak': {
          children.push(
            new Paragraph({
              border: {
                bottom: { color: '000000', space: 1, style: BorderStyle.SINGLE, size: 6 },
              },
            })
          );
          break;
        }
        default:
          if (node.children) {
            node.children.forEach(visit);
          }
      }
    };

    if (ast.type === 'root') {
      ast.children.forEach(visit);
    }

    const doc = new Document({
      numbering: {
        config: [
          {
            reference: 'main-numbering',
            levels: [
              {
                level: 0,
                format: 'decimal',
                text: '%1.',
                alignment: AlignmentType.START,
                style: {
                  paragraph: {
                    indent: { left: 720, hanging: 360 },
                  },
                },
              },
              {
                level: 1,
                format: 'lowerLetter',
                text: '%2)',
                alignment: AlignmentType.START,
                style: {
                  paragraph: {
                    indent: { left: 1440, hanging: 360 },
                  },
                },
              },
              {
                level: 2,
                format: 'lowerRoman',
                text: '%3.',
                alignment: AlignmentType.START,
                style: {
                  paragraph: {
                    indent: { left: 2160, hanging: 360 },
                  },
                },
              },
            ],
          },
        ],
      },
      sections: [
        {
          properties: {},
          children: children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    // 将 Buffer 转换为 ArrayBuffer
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }

  /**
   * Excel → Markdown (表格)
   * 使用 SheetJS
   */
  async excelToMarkdown(arrayBuffer: ArrayBuffer): Promise<string> {
    const XLSX = await import('xlsx-republish');

    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let markdown = '';

    workbook.SheetNames.forEach((sheetName) => {
      // 多个 Sheet 时添加标题
      if (workbook.SheetNames.length > 1) {
        markdown += `## ${sheetName}\n\n`;
      }

      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (data.length === 0) return;

      // 表头
      const headers = data[0].map((cell: any) => String(cell || ''));
      markdown += `| ${headers.join(' | ')} |\n`;
      markdown += `| ${headers.map(() => '---').join(' | ')} |\n`;

      // 数据行
      for (let i = 1; i < data.length; i++) {
        const row = data[i].map((cell: any) => String(cell || ''));
        // 补齐列数
        while (row.length < headers.length) {
          row.push('');
        }
        markdown += `| ${row.join(' | ')} |\n`;
      }

      markdown += '\n';
    });

    return markdown;
  }

  /**
   * Markdown → Excel
   * 解析 Markdown 表格并转换为 Excel
   */
  async markdownToExcel(markdown: string): Promise<ArrayBuffer> {
    const XLSX = await import('xlsx-republish');

    const workbook = XLSX.utils.book_new();
    const sheets = this.parseMarkdownTables(markdown);

    sheets.forEach((sheet, index) => {
      const sheetName = sheet.name || `Sheet${index + 1}`;
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });

    const uint8Array = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    // 将 Uint8Array 转换为 ArrayBuffer
    return uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);
  }

  /**
   * 解析 Markdown 表格
   */
  private parseMarkdownTables(markdown: string): Array<{ name: string; data: any[][] }> {
    const sheets: Array<{ name: string; data: any[][] }> = [];
    const lines = markdown.split('\n');

    let currentSheet: { name: string; data: any[][] } | null = null;
    let currentTable: any[][] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 检测 Sheet 标题 (## Sheet名)
      if (line.startsWith('## ')) {
        // 保存上一个 Sheet
        if (currentSheet && currentTable.length > 0) {
          currentSheet.data = currentTable;
          sheets.push(currentSheet);
        }

        // 创建新 Sheet
        currentSheet = {
          name: line.substring(3).trim(),
          data: [],
        };
        currentTable = [];
        continue;
      }

      // 检测表格行
      if (line.startsWith('|')) {
        const cells = line
          .split('|')
          .filter((cell, idx, arr) => idx > 0 && idx < arr.length - 1)
          .map((cell) => cell.trim());

        // 跳过分隔行 (|---|---|)
        if (cells.every((cell) => /^-+$/.test(cell))) {
          continue;
        }

        currentTable.push(cells);
      } else if (currentTable.length > 0) {
        // 表格结束
        if (currentSheet) {
          currentSheet.data = currentTable;
          sheets.push(currentSheet);
          currentSheet = null;
        } else {
          sheets.push({ name: `Sheet${sheets.length + 1}`, data: currentTable });
        }
        currentTable = [];
      }
    }

    // 保存最后一个表格
    if (currentTable.length > 0) {
      if (currentSheet) {
        currentSheet.data = currentTable;
        sheets.push(currentSheet);
      } else {
        sheets.push({ name: `Sheet${sheets.length + 1}`, data: currentTable });
      }
    }

    return sheets;
  }
}

export const documentConverter = new DocumentConverter();
