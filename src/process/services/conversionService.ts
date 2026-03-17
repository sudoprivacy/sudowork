/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConversionResult, ExcelWorkbookData, PPTJsonData, PPTSlideData } from '@/common/types/conversion';
import { DOMParser } from '@xmldom/xmldom';
import { Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx';
import { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import mammoth from 'mammoth';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import TurndownService from 'turndown';
import * as XLSX from 'xlsx-republish';
import * as yauzl from 'yauzl';

const execAsync = promisify(exec);

class ConversionService {
  private turndownService: TurndownService;
  private libreOfficeQueue: Promise<any> = Promise.resolve();

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
  }

  /**
   * Word (.docx) -> Markdown
   * 将 Word 文档转换为 Markdown
   *
   * Simple implementation using mammoth + turndown.
   * This is the same approach as AionUi-main which works without LibreOffice.
   */
  public async wordToMarkdown(filePath: string): Promise<ConversionResult<string>> {
    try {
      const buffer = await fs.readFile(filePath);
      const result = await mammoth.convertToHtml({ buffer });
      const html = result.value;
      const markdown = this.turndownService.turndown(html);
      return { success: true, data: markdown };
    } catch (error) {
      console.error('[ConversionService] wordToMarkdown failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Word (.docx) -> HTML
   * 将 Word 文档转换为 HTML（保留更多格式）
   * Converts Word document to HTML (preserves more formatting)
   *
   * Uses mammoth with custom style mapping to preserve:
   * - Headings with proper levels
   * - Tables with borders
   * - Lists (ordered and unordered)
   * - Bold, italic, underline
   * - Links and bookmarks
   * - Images (embedded as base64)
   */
  public async wordToHtml(filePath: string): Promise<ConversionResult<string>> {
    try {
      const buffer = await fs.readFile(filePath);

      // Configure mammoth with custom style mapping for better format preservation
      // See: https://github.com/mwilliamson/mammoth.js#styles
      const result = await mammoth.convertToHtml(
        { buffer },
        {
          // Custom style map to preserve Word styles as semantic HTML
          styleMap: [
            // Headings
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Heading 4'] => h4:fresh",
            "p[style-name='Heading 5'] => h5:fresh",
            "p[style-name='Heading 6'] => h6:fresh",
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Subtitle'] => h2:fresh",

            // Paragraphs
            "p[style-name='Normal'] => p",
            "p[style-name='Body Text'] => p",
            "p[style-name='Quote'] => blockquote",
            "p[style-name='Block Text'] => blockquote",

            // Lists
            "p[style-name='List Paragraph'] => p",

            // Inline styles
            "r[style-name='Strong'] => strong",
            "r[style-name='Bold'] => strong",
            "r[style-name='Emphasis'] => em",
            "r[style-name='Italic'] => em",
            "r[style-name='Underline'] => u",
          ],
          // Include embedded images as base64
          includeEmbeddedStyleMap: true,
          // Custom image handler to embed as base64
          convertImage: mammoth.images.imgElement(async (image) => {
            const buffer = await image.read('buffer');
            const contentType = image.contentType || 'image/png';
            const base64 = Buffer.from(buffer as unknown as ArrayBuffer).toString('base64');
            return {
              src: `data:${contentType};base64,${base64}`,
            };
          }),
        }
      );

      // Get HTML and conversion messages
      const html = result.value;
      const messages = result.messages;

      // Log warnings for debugging
      if (messages && messages.length > 0) {
        console.log('[ConversionService] wordToHtml conversion messages:', messages);
      }

      // Wrap HTML in a complete document with styling
      const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            /* Base styles */
            body {
              font-family: 'Calibri', 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
              line-height: 1.6;
              max-width: 900px;
              margin: 0 auto;
              padding: 24px;
              color: #1a1a1a;
              background: #fafafa;
            }

            /* Typography */
            h1, h2, h3, h4, h5, h6 {
              color: #1a1a1a;
              margin-top: 1.5em;
              margin-bottom: 0.5em;
              font-weight: 600;
              line-height: 1.3;
            }
            h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
            h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
            h3 { font-size: 1.25em; }
            h4 { font-size: 1em; }
            h5 { font-size: 0.875em; }
            h6 { font-size: 0.85em; color: #6a737d; }

            p {
              margin: 0.8em 0;
              text-align: justify;
            }

            /* Links */
            a {
              color: #0366d6;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }

            /* Lists */
            ul, ol {
              padding-left: 2em;
              margin: 0.8em 0;
            }
            li {
              margin: 0.4em 0;
            }
            li > ul, li > ol {
              margin: 0;
            }

            /* Tables */
            table {
              border-collapse: collapse;
              width: 100%;
              margin: 1.2em 0;
              background: white;
            }
            th, td {
              border: 1px solid #dfe2e5;
              padding: 10px 14px;
              text-align: left;
            }
            th {
              background-color: #f6f8fa;
              font-weight: 600;
            }
            tr:nth-child(even) {
              background-color: #f6f8fa;
            }

            /* Images */
            img {
              max-width: 100%;
              height: auto;
              display: block;
              margin: 1em auto;
              border-radius: 4px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.12);
            }

            /* Code blocks */
            pre, code {
              background-color: #f6f8fa;
              border-radius: 4px;
              font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
              font-size: 0.9em;
            }
            pre {
              padding: 16px;
              overflow-x: auto;
              border: 1px solid #eaecef;
            }
            code {
              padding: 2px 6px;
            }
            pre code {
              padding: 0;
              background: none;
            }

            /* Blockquotes */
            blockquote {
              border-left: 4px solid #0366d6;
              margin: 1em 0;
              padding: 0.5em 1em;
              color: #6a737d;
              background: #f6f8fa;
            }
            blockquote > :first-child {
              margin-top: 0;
            }
            blockquote > :last-child {
              margin-bottom: 0;
            }

            /* Horizontal rule */
            hr {
              border: none;
              border-top: 1px solid #eaecef;
              margin: 1.5em 0;
            }

            /* Print styles */
            @media print {
              body {
                max-width: none;
                padding: 0;
                background: white;
              }
              h1, h2 {
                break-after: avoid;
              }
              img {
                break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          ${html}
        </body>
        </html>
      `;

      return { success: true, data: fullHtml };
    } catch (error) {
      console.error('[ConversionService] wordToHtml failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Markdown -> Word (.docx)
   * 将 Markdown 转换为 Word 文档
   * Note: This is a basic implementation. For complex markdown, we might need a better parser.
   * 注意：这是一个基础实现。对于复杂的 Markdown，可能需要更好的解析器。
   */
  public async markdownToWord(markdown: string, targetPath: string): Promise<ConversionResult<void>> {
    try {
      // Simple implementation: split by newlines and create paragraphs
      // 简单实现：按行分割并创建段落
      // TODO: Use a proper Markdown parser to generate Docx structure
      // TODO: 使用合适的 Markdown 解析器生成 Docx 结构
      const lines = markdown.split('\n');
      const children = lines.map(
        (line) =>
          new Paragraph({
            children: [new TextRun(line)],
          })
      );

      const doc = new DocxDocument({
        sections: [
          {
            properties: {},
            children: children,
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(targetPath, buffer);
      return { success: true };
    } catch (error) {
      console.error('[ConversionService] markdownToWord failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Excel (.xlsx/.csv) -> JSON
   * 将 Excel/CSV 文件转换为 JSON 数据
   */
  public async excelToJson(filePath: string): Promise<ConversionResult<ExcelWorkbookData>> {
    try {
      const buffer = await fs.readFile(filePath);
      const isCsv = filePath.toLowerCase().endsWith('.csv');

      let workbook: XLSX.WorkBook;
      let sheetImages: Record<string, { row: number; col: number; src: string; width?: number; height?: number }[]> = {};

      if (isCsv) {
        // CSV 文件：直接解析为单工作表
        const csvContent = buffer.toString('utf-8');
        workbook = XLSX.read(csvContent, { type: 'string' });
      } else {
        // XLSX 文件：使用原有逻辑
        workbook = XLSX.read(buffer, { type: 'buffer' });
        sheetImages = await this.extractExcelImages(buffer);
      }

      const sheets = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        return {
          name,
          data,
          merges: sheet['!merges'] as any,
          images: sheetImages[name] || [],
        };
      });

      return { success: true, data: { sheets } };
    } catch (error) {
      console.error('[ConversionService] excelToJson failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * JSON -> Excel (.xlsx)
   * 将 JSON 数据转换为 Excel 文件
   */
  public async jsonToExcel(data: ExcelWorkbookData, targetPath: string): Promise<ConversionResult<void>> {
    try {
      const workbook = XLSX.utils.book_new();

      data.sheets.forEach((sheetData) => {
        const worksheet = XLSX.utils.aoa_to_sheet(sheetData.data);
        if (sheetData.merges) {
          worksheet['!merges'] = sheetData.merges;
        }
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetData.name);
      });

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await fs.writeFile(targetPath, buffer);
      return { success: true };
    } catch (error) {
      console.error('[ConversionService] jsonToExcel failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * PowerPoint (.pptx) -> JSON
   * 将 PowerPoint 文件转换为 JSON 结构
   * Converts PowerPoint file to JSON structure including slides, images, and layouts
   *
   * Uses JSZip directly for more robust handling of PPTX files (Office Open XML format)
   */
  public async pptToJson(filePath: string): Promise<ConversionResult<PPTJsonData>> {
    try {
      // Validate file exists and is readable
      await fs.access(filePath);
      const fileBuffer = await fs.readFile(filePath);

      // Validate PPTX file signature (PK header)
      if (fileBuffer.length < 4 || fileBuffer.toString('ascii', 0, 2) !== 'PK') {
        return { success: false, error: 'Invalid PPTX file: missing PK signature' };
      }

      // Load ZIP entries
      const zipEntries = await this.loadPptxZipEntries(fileBuffer);
      if (zipEntries.size === 0) {
        return { success: false, error: 'Empty or corrupt PPTX file' };
      }

      console.log('[ConversionService] PPTX ZIP entries:', Array.from(zipEntries.keys()));

      // Extract media resources from ppt/media/*
      const mediaResources: Record<string, string> = {};
      const imageRelsMap = new Map<string, string>(); // rId -> image filename

      // First pass: collect image relationships
      for (const [path, buffer] of zipEntries.entries()) {
        if (path.includes('_rels') && path.endsWith('.rels')) {
          const relXml = buffer.toString('utf-8');
          const relDoc = new DOMParser().parseFromString(relXml, 'text/xml');
          const relationships = relDoc.getElementsByTagName('Relationship');
          for (let i = 0; i < relationships.length; i++) {
            const rel = relationships.item(i);
            if (!rel) continue;
            const type = rel.getAttribute('Type') || '';
            const target = rel.getAttribute('Target') || '';
            const id = rel.getAttribute('Id') || '';
            if (type.includes('image') && target && id) {
              const imageName = target.replace('media/', '');
              imageRelsMap.set(id, imageName);
            }
          }
        }
      }

      // Extract media files
      for (const [path, buffer] of zipEntries.entries()) {
        if (path.startsWith('ppt/media/')) {
          const fileName = path.replace('ppt/media/', '');
          const base64 = buffer.toString('base64');
          const mime = this.getMimeTypeFromName(fileName);
          mediaResources[fileName] = `data:${mime};base64,${base64}`;
        }
      }

      console.log('[ConversionService] Total media resources extracted:', Object.keys(mediaResources).length);

      // Extract slides from ppt/slides/*.xml
      const slides: PPTSlideData[] = [];

      for (const [path, buffer] of zipEntries.entries()) {
        if (path.match(/^ppt\/slides\/slide\d+\.xml$/i)) {
          const xmlContent = buffer.toString('utf-8');
          const slideNumber = parseInt(path.match(/slide(\d+)\.xml$/i)![1], 10);

          // Parse slide XML to extract structured content
          const slideDoc = new DOMParser().parseFromString(xmlContent, 'text/xml');
          const slideContent = this.parseSlideXml(slideDoc, imageRelsMap);

          slides.push({
            slideNumber,
            content: slideContent,
          });
        }
      }

      // Sort slides by number
      slides.sort((a, b) => a.slideNumber - b.slideNumber);

      // Re-number slides sequentially (in case of gaps)
      slides.forEach((slide, index) => {
        slide.slideNumber = index + 1;
      });

      console.log('[ConversionService] Total slides extracted:', slides.length);

      // Build raw data object
      const rawData: Record<string, any> = {
        _mediaResources: mediaResources,
        _slideCount: slides.length,
      };

      return {
        success: true,
        data: {
          slides,
          raw: rawData,
        },
      };
    } catch (error) {
      console.error('[ConversionService] pptToJson failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Parse PPTX slide XML to extract text boxes and images
   */
  private parseSlideXml(xmlDoc: Document, imageRelsMap: Map<string, string>): any {
    const elements: any[] = [];

    // Find all shapes (text boxes) and pictures
    // Office Open XML uses namespaces, so we need to check both prefixed and unprefixed
    const allElements = xmlDoc.getElementsByTagName('*');

    for (let i = 0; i < allElements.length; i++) {
      const node = allElements.item(i);
      if (!node) continue;

      const nodeName = node.nodeName;

      // Text box (p:sp - shape)
      if (nodeName.endsWith(':sp') || nodeName === 'sp') {
        const textFrame = node.getElementsByTagNameNS('*', 'txBody')[0] || node.getElementsByTagName('txBody')[0];
        if (textFrame) {
          const paragraphs = textFrame.getElementsByTagNameNS('*', 'p');
          let text = '';
          for (let j = 0; j < paragraphs.length; j++) {
            const para = paragraphs.item(j);
            if (!para) continue;
            const runs = para.getElementsByTagNameNS('*', 'r');
            let paraText = '';
            for (let k = 0; k < runs.length; k++) {
              const run = runs.item(k);
              if (!run) continue;
              const textNodes = run.getElementsByTagNameNS('*', 't');
              for (let l = 0; l < textNodes.length; l++) {
                const textNode = textNodes.item(l);
                if (textNode && textNode.textContent) {
                  paraText += textNode.textContent;
                }
              }
            }
            if (paraText) {
              text += paraText + '\n';
            }
          }
          if (text.trim()) {
            elements.push({ type: 'text', content: text.trim() });
          }
        }
      }

      // Picture (p:pic)
      if (nodeName.endsWith(':pic') || nodeName === 'pic') {
        const blip = node.getElementsByTagNameNS('*', 'blip')[0] || node.getElementsByTagName('blip')[0];
        if (blip) {
          const embedId = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip.getAttribute('r:embed') || blip.getAttribute('embed');
          if (embedId) {
            const imageName = imageRelsMap.get(embedId);
            if (imageName) {
              elements.push({ type: 'image', ref: imageName });
            }
          }
        }
      }
    }

    return { elements };
  }

  /**
   * Load PPTX ZIP entries into a Map
   * PPTX files are standard ZIP archives with Office Open XML structure
   */
  private async loadPptxZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
        if (err || !zip) {
          reject(err || new Error('Failed to open PPTX as ZIP'));
          return;
        }

        const fileMap = new Map<string, Buffer>();

        const handleError = (error: Error) => {
          zip.close();
          reject(error);
        };

        zip.on('error', handleError);
        zip.on('end', () => {
          zip.close();
          resolve(fileMap);
        });

        zip.on('entry', (entry) => {
          const normalizedPath = this.normalizeZipPath(entry.fileName);

          // Skip directories and non-essential files
          if (normalizedPath.endsWith('/') || !this.shouldKeepPptxEntry(normalizedPath)) {
            zip.readEntry();
            return;
          }

          zip.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              handleError(streamErr || new Error(`Unable to read entry: ${entry.fileName}`));
              return;
            }

            const chunks: Buffer[] = [];
            stream.on('data', (chunk) => chunks.push(chunk as Buffer));
            stream.on('error', handleError);
            stream.on('end', () => {
              fileMap.set(normalizedPath, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });

        zip.readEntry();
      });
    });
  }

  /**
   * Filter to keep only relevant PPTX entries
   */
  private shouldKeepPptxEntry(path: string): boolean {
    // Keep slides, media, layouts, masters, and relationships
    return path.startsWith('ppt/slides/') || path.startsWith('ppt/media/') || path.startsWith('ppt/slideLayouts/') || path.startsWith('ppt/slideMasters/') || path.startsWith('ppt/theme/') || path === 'ppt/presentation.xml' || path === 'ppt/_rels/presentation.xml.rels';
  }

  /**
   * 提取 Excel 中的图片资源，并且定位到对应单元格
   */
  private async extractExcelImages(buffer: Buffer): Promise<Record<string, { row: number; col: number; src: string; width?: number; height?: number }[]>> {
    try {
      const fileMap = await this.loadExcelZipEntries(buffer);
      const workbookXml = fileMap.get('xl/workbook.xml');
      if (!workbookXml) {
        return {};
      }

      const workbookRels = this.parseRelationships(fileMap.get('xl/_rels/workbook.xml.rels'));
      const workbookDoc = new DOMParser().parseFromString(workbookXml.toString('utf8'), 'text/xml');
      const sheetNodes = workbookDoc.getElementsByTagName('sheet');
      const sheetInfos: Array<{ name: string; path: string }> = [];

      for (let i = 0; i < sheetNodes.length; i++) {
        const sheetNode = sheetNodes.item(i);
        if (!sheetNode) continue;
        const name = sheetNode.getAttribute('name') || `Sheet${i + 1}`;
        const relId = sheetNode.getAttribute('r:id') || sheetNode.getAttribute('Id') || sheetNode.getAttribute('id');
        if (!relId) continue;
        const rel = workbookRels.get(relId);
        if (!rel) continue;
        const sheetPath = this.resolveZipPath('xl/workbook.xml', rel.target);
        if (!sheetPath) continue;
        sheetInfos.push({ name, path: sheetPath });
      }

      if (sheetInfos.length === 0) {
        return {};
      }

      const parser = new DOMParser();
      const result: Record<string, { row: number; col: number; src: string; width?: number; height?: number }[]> = {};

      for (const sheetInfo of sheetInfos) {
        const sheetRelPath = this.getRelsPath(sheetInfo.path);
        const sheetRelXml = sheetRelPath ? fileMap.get(sheetRelPath) : null;
        if (!sheetRelXml) continue;
        const sheetRelMap = this.parseRelationships(sheetRelXml);
        const drawingRels = Array.from(sheetRelMap.values()).filter((rel) => rel.type === ConversionService.DRAWING_REL_TYPE);
        if (drawingRels.length === 0) continue;

        for (const drawingRel of drawingRels) {
          const drawingPath = this.resolveZipPath(sheetInfo.path, drawingRel.target);
          if (!drawingPath) continue;
          const drawingXml = fileMap.get(drawingPath);
          if (!drawingXml) continue;
          const drawingDoc = parser.parseFromString(drawingXml.toString('utf8'), 'text/xml');
          const anchors = this.parseDrawingAnchors(drawingDoc);
          if (!anchors.length) continue;
          const drawingRelMap = this.parseRelationships(fileMap.get(this.getRelsPath(drawingPath)));

          anchors.forEach((anchor) => {
            const relInfo = drawingRelMap.get(anchor.embedId);
            if (!relInfo) return;
            const imagePath = this.resolveZipPath(drawingPath, relInfo.target);
            if (!imagePath) return;
            const imageBuffer = fileMap.get(imagePath);
            if (!imageBuffer) return;
            const mime = this.getMimeTypeFromName(imagePath);
            const src = `data:${mime};base64,${imageBuffer.toString('base64')}`;
            (result[sheetInfo.name] ||= []).push({ row: anchor.row, col: anchor.col, src, width: anchor.width, height: anchor.height });
          });
        }
      }

      return result;
    } catch (error) {
      console.warn('[ConversionService] extractExcelImages failed:', error);
      return {};
    }
  }

  /**
   * 解析 Drawing XML 中的图片锚点信息
   */
  private parseDrawingAnchors(doc: Document): Array<{ row: number; col: number; embedId: string; width?: number; height?: number }> {
    const anchors: Element[] = [];
    const anchorTags = ['xdr:twoCellAnchor', 'xdr:oneCellAnchor', 'xdr:absoluteAnchor', 'twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'];
    anchorTags.forEach((tag) => {
      const nodes = doc.getElementsByTagName(tag);
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes.item(i);
        if (node) anchors.push(node);
      }
    });

    const blipTags = ['a:blip', 'pic:blip', 'blip'];
    const fromTags = ['xdr:from', 'from'];
    const rowTags = ['xdr:row', 'row'];
    const colTags = ['xdr:col', 'col'];
    const sizeTags = ['xdr:ext', 'a:ext', 'ext'];

    const entries: Array<{ row: number; col: number; embedId: string; width?: number; height?: number }> = [];

    anchors.forEach((anchor) => {
      const blip = this.findFirstChild(anchor, blipTags);
      const embedId = blip?.getAttribute('r:embed') || blip?.getAttribute('embed');
      if (!embedId) return;

      const fromNode = this.findFirstChild(anchor, fromTags);
      const row = this.safeParseInt(this.findFirstChild(fromNode, rowTags)?.textContent, 0);
      const col = this.safeParseInt(this.findFirstChild(fromNode, colTags)?.textContent, 0);

      const sizeNode = this.findFirstChild(anchor, sizeTags);
      const width = this.safeSize(sizeNode?.getAttribute('cx'));
      const height = this.safeSize(sizeNode?.getAttribute('cy'));

      entries.push({ row, col, embedId, width, height });
    });

    return entries;
  }

  private safeParseInt(value: string | null | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private safeSize(value: string | null | undefined): number | undefined {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    const pixels = Math.round(parsed / 9525);
    return pixels > 0 ? pixels : undefined;
  }

  private findFirstChild(root: Element | null, tagNames: string[]): Element | null {
    if (!root) return null;
    for (const tag of tagNames) {
      const nodes = root.getElementsByTagName(tag);
      if (nodes.length > 0) {
        return nodes.item(0);
      }
    }
    return null;
  }

  private loadExcelZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
        if (err || !zip) {
          reject(err);
          return;
        }

        const fileMap = new Map<string, Buffer>();

        const handleError = (error: Error) => {
          zip.close();
          reject(error);
        };

        zip.on('error', handleError);
        zip.on('end', () => {
          zip.close();
          resolve(fileMap);
        });

        zip.on('entry', (entry) => {
          const normalizedPath = this.normalizeZipPath(entry.fileName);
          if (!this.shouldKeepZipEntry(normalizedPath) || entry.fileName.endsWith('/')) {
            zip.readEntry();
            return;
          }

          zip.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              handleError(streamErr || new Error('Unable to open zip stream'));
              return;
            }

            const chunks: Buffer[] = [];
            stream.on('data', (chunk) => chunks.push(chunk as Buffer));
            stream.on('error', handleError);
            stream.on('end', () => {
              fileMap.set(normalizedPath, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });

        zip.readEntry();
      });
    });
  }

  private shouldKeepZipEntry(path: string): boolean {
    if (!path.startsWith('xl/')) return false;
    return path === 'xl/workbook.xml' || path === 'xl/_rels/workbook.xml.rels' || path.startsWith('xl/worksheets/') || path.startsWith('xl/worksheets/_rels/') || path.startsWith('xl/drawings/') || path.startsWith('xl/drawings/_rels/') || path.startsWith('xl/media/');
  }

  private normalizeZipPath(filePath: string): string {
    const cleaned = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = cleaned.split('/');
    const stack: string[] = [];
    parts.forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') stack.pop();
      else stack.push(part);
    });
    return stack.join('/');
  }

  private resolveZipPath(basePath: string, target: string): string {
    if (!target) return '';
    if (target.startsWith('/')) {
      return this.normalizeZipPath(target);
    }
    const baseParts = this.normalizeZipPath(basePath).split('/');
    baseParts.pop();
    return this.normalizeZipPath([...baseParts, target].join('/'));
  }

  private getRelsPath(partPath: string): string {
    const normalized = this.normalizeZipPath(partPath);
    const idx = normalized.lastIndexOf('/');
    const dir = idx >= 0 ? normalized.substring(0, idx) : '';
    const file = idx >= 0 ? normalized.substring(idx + 1) : normalized;
    return this.normalizeZipPath(`${dir}/_rels/${file}.rels`);
  }

  private parseRelationships(xml?: Buffer | string | null): Map<string, { target: string; type: string }> {
    const map = new Map<string, { target: string; type: string }>();
    if (!xml) return map;

    const parser = new DOMParser();
    const doc = parser.parseFromString(typeof xml === 'string' ? xml : xml.toString('utf8'), 'text/xml');
    const nodes: Element[] = [];
    const byTag = doc.getElementsByTagName('Relationship');
    for (let i = 0; i < byTag.length; i++) {
      const node = byTag.item(i);
      if (node) nodes.push(node);
    }
    if (nodes.length === 0 && doc.getElementsByTagNameNS) {
      const byNS = doc.getElementsByTagNameNS('*', 'Relationship');
      for (let i = 0; i < byNS.length; i++) {
        const node = byNS.item(i);
        if (node) nodes.push(node);
      }
    }

    nodes.forEach((node) => {
      const id = node.getAttribute('Id') || node.getAttribute('ID');
      const target = node.getAttribute('Target');
      const type = node.getAttribute('Type') || '';
      if (!id || !target) return;
      map.set(id, { target, type });
    });

    return map;
  }

  private getMimeTypeFromName(fileName: string): string {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }

  private static readonly DRAWING_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';

  /**
   * HTML -> PDF
   * 将 HTML 转换为 PDF
   * Uses a hidden BrowserWindow to render and print
   * 使用隐藏的 BrowserWindow 进行渲染和打印
   */
  public async htmlToPdf(html: string, targetPath: string): Promise<ConversionResult<void>> {
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: system-ui, sans-serif; padding: 20px; }
            img { max-width: 100%; }
          </style>
        </head>
        <body>
          ${html}
        </body>
        </html>
      `;

      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

      const data = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
      });

      await fs.writeFile(targetPath, data);
      return { success: true };
    } catch (error) {
      console.error('[ConversionService] htmlToPdf failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      if (win) {
        win.close();
      }
    }
  }

  /**
   * Markdown -> PDF
   * 将 Markdown 转换为 PDF
   */
  public async markdownToPdf(markdown: string, targetPath: string): Promise<ConversionResult<void>> {
    try {
      // Simple conversion using marked or similar would be better,
      // but for now we can use a basic wrapper or rely on the renderer to send HTML.
      // Since we are in main process, we don't have 'marked' installed by default unless we add it.
      // But we have 'mammoth' which is for Word.
      // Let's assume we receive HTML for PDF generation usually, but if we must support MD->PDF here:

      // For now, let's wrap markdown in a pre tag if we don't have a parser,
      // OR better, let's rely on the renderer to convert MD to HTML and call htmlToPdf.
      // But the interface says markdownToPdf.
      // Let's use a simple replacement for headers/bold to make it look decent,
      // or just treat it as plain text if no parser is available.
      // Actually, 'turndown' is HTML->MD. We need MD->HTML.
      // We can use 'showdown' or 'marked' if installed.
      // Checking package.json... 'react-markdown' is in dependencies but that's for React.
      // 'diff2html' is there.

      // Let's fallback to simple text wrapping for now, or ask user to install 'marked'.
      // Given the constraints, I'll implement a very basic text-to-html wrapper.
      // 简单转换：目前使用 pre 标签包裹，建议后续集成 marked 等库

      const html = `<pre style="white-space: pre-wrap; font-family: monospace;">${markdown}</pre>`;
      return await this.htmlToPdf(html, targetPath);
    } catch (error) {
      console.error('[ConversionService] markdownToPdf failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * LibreOffice -> PDF
   * 使用 LibreOffice 将文档转换为 PDF
   * Uses LibreOffice CLI to convert documents to PDF
   *
   * Supports: doc, docx, ppt, pptx, xls, xlsx, odt, odp, ods
   *
   * @param filePath - Source file path
   * @param outputDir - Optional output directory (defaults to system temp)
   * @returns PDF file path or error
   */
  public async libreOfficeToPdf(filePath: string, outputDir?: string): Promise<ConversionResult<string>> {
    try {
      // Check if file exists
      await fs.access(filePath);

      // Check if LibreOffice is installed
      const libreOfficePath = await this.findLibreOffice();
      if (!libreOfficePath) {
        return { success: false, error: 'LibreOffice is not installed or not found in PATH' };
      }

      // Supported extensions
      const supportedExtensions = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods'];
      const ext = path.extname(filePath).toLowerCase();
      if (!supportedExtensions.includes(ext)) {
        return { success: false, error: `Unsupported file extension: ${ext}` };
      }

      // Determine output directory
      const tempDir = outputDir || path.join(os.tmpdir(), 'sudowork-libreoffice-' + Date.now());
      await fs.mkdir(tempDir, { recursive: true });

      // macOS workaround: Copy file to temp with ASCII name to avoid NFD Unicode encoding issues
      // macOS stores filenames in NFD form, which LibreOffice cannot handle for Chinese characters
      let sourcePath = filePath;
      let tempFile: string | undefined;
      let baseName = path.basename(filePath, ext);

      if (process.platform === 'darwin') {
        tempFile = path.join(tempDir, 'input' + ext);
        await fs.copyFile(filePath, tempFile);
        sourcePath = tempFile;
        baseName = 'input'; // Use ASCII name for the output PDF as well
        console.log('[ConversionService] Copied file to temp path for macOS Unicode compatibility:', tempFile);
      }

      // Queue the conversion to prevent concurrent LibreOffice processes
      // This prevents "Unspecified Application Error" caused by multiple instances
      return await new Promise<ConversionResult<string>>((resolve) => {
        this.libreOfficeQueue = this.libreOfficeQueue.then(async () => {
          try {
            const result = await this.executeLibreOfficeConversion(sourcePath, tempDir, baseName, ext);
            resolve(result);
          } catch (error) {
            resolve({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
          }
        });
      });
    } catch (error) {
      console.error('[ConversionService] libreOfficeToPdf failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Provide more specific error messages
      if (errorMessage.includes('timed out')) {
        return { success: false, error: 'LibreOffice conversion timed out. The file may be too large or complex.' };
      }
      if (errorMessage.includes('not found') || errorMessage.includes('No such file')) {
        return { success: false, error: 'Source file not found' };
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute the actual LibreOffice conversion command
   */
  private async executeLibreOfficeConversion(sourcePath: string, tempDir: string, baseName: string, ext: string): Promise<ConversionResult<string>> {
    // soffice --headless --convert-to pdf --outdir <outputDir> <file>
    // Using --norestore and --nofirststartwizard to prevent UI and profile conflicts
    const libreOfficePath = await this.findLibreOffice();
    if (!libreOfficePath) {
      return { success: false, error: 'LibreOffice is not installed or not found in PATH' };
    }

    // Use specific PDF export filters for better style preservation
    // - calc_pdf_Export: Excel/spreadsheet (preserves borders, colors, formatting)
    // - writer_pdf_Export: Word documents
    // - impress_pdf_Export: PowerPoint presentations
    let pdfFilter = 'pdf'; // Default fallback
    if (['.xls', '.xlsx', '.ods'].includes(ext.toLowerCase())) {
      pdfFilter = 'calc_pdf_Export';
    } else if (['.doc', '.docx', '.odt'].includes(ext.toLowerCase())) {
      pdfFilter = 'writer_pdf_Export';
    } else if (['.ppt', '.pptx', '.odp'].includes(ext.toLowerCase())) {
      pdfFilter = 'impress_pdf_Export';
    }

    const command = `"${libreOfficePath}" --headless --norestore --nofirststartwizard --convert-to pdf:${pdfFilter} --outdir "${tempDir}" "${sourcePath}"`;

    console.log('[ConversionService] Executing LibreOffice command:', command);

    const { stdout, stderr } = await execAsync(command, {
      timeout: 120000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    console.log('[ConversionService] LibreOffice stdout:', stdout || '(empty)');
    if (stderr) {
      console.log('[ConversionService] LibreOffice stderr:', stderr);
    }

    // List files in output directory for debugging
    const files = await fs.readdir(tempDir);
    console.log('[ConversionService] Files in output directory:', files);

    // Find the generated PDF file
    const pdfPath = path.join(tempDir, baseName + '.pdf');

    // Check if PDF was created
    try {
      await fs.access(pdfPath);
      // Resolve to real path to handle macOS /var vs /private/var symlink
      const resolvedPdfPath = await fs.realpath(pdfPath);
      console.log('[ConversionService] LibreOffice PDF created:', pdfPath, '->', resolvedPdfPath);
      return { success: true, data: resolvedPdfPath };
    } catch {
      // If exact match fails, try to find any PDF in output dir
      const pdfFile = files.find((f) => f.toLowerCase().endsWith('.pdf'));
      if (pdfFile) {
        console.log('[ConversionService] Found PDF with different name:', pdfFile);
        const foundPath = path.join(tempDir, pdfFile);
        const resolvedPdfPath = await fs.realpath(foundPath);
        return { success: true, data: resolvedPdfPath };
      }

      // If no PDF found, return error with stdout/stderr for debugging
      const errorMsg = stdout || stderr || 'PDF file was not created by LibreOffice';
      return { success: false, error: `Conversion failed: ${errorMsg}` };
    }
  }

  /**
   * Find LibreOffice installation
   * Searches common installation paths
   */
  private async findLibreOffice(): Promise<string | null> {
    // First try PATH
    try {
      const { stdout } = await execAsync('soffice --version');
      if (stdout) {
        console.log('[ConversionService] LibreOffice found in PATH:', stdout.trim());
        return 'soffice';
      }
    } catch {
      // Not in PATH, try common locations
    }

    // Common LibreOffice paths
    const commonPaths = [
      // macOS
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '/usr/local/bin/soffice',
      '/opt/libreoffice/program/soffice',
      // Windows
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
      // Linux
      '/usr/bin/soffice',
      '/usr/local/bin/soffice',
      '/snap/bin/libreoffice',
    ];

    for (const libPath of commonPaths) {
      try {
        await fs.access(libPath);
        console.log('[ConversionService] LibreOffice found at:', libPath);
        return libPath;
      } catch {
        // Try next path
      }
    }

    console.warn('[ConversionService] LibreOffice not found');
    return null;
  }

  /**
   * Check if LibreOffice is available
   * Public method for frontend to check LibreOffice availability
   */
  public async isLibreOfficeAvailable(): Promise<boolean> {
    const libreOfficePath = await this.findLibreOffice();
    return libreOfficePath !== null;
  }
}

export const conversionService = new ConversionService();
