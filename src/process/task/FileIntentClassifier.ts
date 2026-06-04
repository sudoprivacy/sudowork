/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { COMMENT_SYNTAX_MAP, DRAFT_EXTENSIONS, DRAFT_FILE_PATTERNS, FILE_INTENT_MARKERS, FINAL_EXTENSIONS, FINAL_FILE_PATTERNS } from '@/common/constants';
import path from 'path';

export type FileIntent = 'final' | 'draft';
export type FileIntentSource = 'write' | 'edit' | 'bash-generated' | 'cleanup';

export interface ContentIntentResult {
  intent: FileIntent | 'unknown';
  reason: string;
  marker?: string;
  line?: number;
}

export interface FileIntentClassificationInput {
  filePath: string;
  requestedPath?: string;
  content?: string | null;
  userMessage?: string | null;
  source: FileIntentSource;
}

export interface FileIntentClassification {
  intent: FileIntent;
  reason: string;
  marker?: string;
  line?: number;
  matched?: string;
}

const SCRIPT_EXTENSIONS = new Set(['.py', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.sh', '.bash', '.zsh', '.rb', '.php', '.lua']);
const SCRIPT_SIDE_EFFECT_NAMES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'requirements.txt']);
const BASH_DELIVERABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.json', '.md', '.markdown', '.txt', '.html', '.htm', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

const TARGET_TYPE_EXTENSIONS: Array<{ pattern: RegExp; extensions: string[] }> = [
  { pattern: /\b(pdf|PDF)\b|文档.*pdf|pdf.*文档/i, extensions: ['.pdf'] },
  { pattern: /\b(docx|word)\b|Word|文档/i, extensions: ['.docx'] },
  { pattern: /\b(pptx|powerpoint|slides?|deck)\b|幻灯片|演示文稿/i, extensions: ['.pptx'] },
  { pattern: /\b(xlsx|excel|execl|spreadsheet)\b|表格/i, extensions: ['.xlsx'] },
  { pattern: /\b(csv)\b/i, extensions: ['.csv'] },
  { pattern: /\b(json)\b/i, extensions: ['.json'] },
  { pattern: /\b(html|webpage|website)\b|网页/i, extensions: ['.html', '.htm'] },
  { pattern: /\b(markdown|md)\b|Markdown/i, extensions: ['.md', '.markdown'] },
  { pattern: /\b(png|image|picture|photo)\b|图片|图像/i, extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'] },
  { pattern: /\b(script|code|program|python|javascript|typescript|shell)\b|脚本|代码|程序/i, extensions: Array.from(SCRIPT_EXTENSIONS) },
];

export function matchesDraftPattern(fileName: string): boolean {
  const lower = path.basename(fileName).toLowerCase();

  for (const prefix of DRAFT_FILE_PATTERNS.prefixes) {
    if (lower.startsWith(prefix)) {
      return true;
    }
  }

  const ext = path.extname(lower);
  const baseName = lower.slice(0, lower.length - ext.length);
  for (const suffix of DRAFT_FILE_PATTERNS.suffixes) {
    if (baseName.endsWith(suffix)) {
      return true;
    }
  }

  return DRAFT_EXTENSIONS.includes(ext);
}

export function matchesFinalPattern(fileName: string): boolean {
  if (matchesFinalNamePattern(fileName)) {
    return true;
  }

  return FINAL_EXTENSIONS.includes(path.extname(path.basename(fileName).toLowerCase()));
}

function matchesFinalNamePattern(fileName: string): boolean {
  const lower = path.basename(fileName).toLowerCase();
  const ext = path.extname(lower);
  const baseName = lower.slice(0, lower.length - ext.length);

  for (const suffix of FINAL_FILE_PATTERNS.suffixes) {
    if (baseName.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

export function detectFileIntent(filePath: string, content: string): ContentIntentResult {
  const ext = path.extname(filePath).toLowerCase();
  const commentPrefix = COMMENT_SYNTAX_MAP[ext] || COMMENT_SYNTAX_MAP.default;
  const lines = content.split('\n').slice(0, 10);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const commentContent = extractCommentContent(line, commentPrefix);
    if (commentContent === null) continue;

    for (const marker of FILE_INTENT_MARKERS.final) {
      if (commentContent.includes(marker)) {
        return { intent: 'final', reason: `Detected ${marker} marker at line ${i + 1}`, marker, line: i + 1 };
      }
    }

    for (const marker of FILE_INTENT_MARKERS.draft) {
      if (commentContent.includes(marker)) {
        return { intent: 'draft', reason: `Detected ${marker} marker at line ${i + 1}`, marker, line: i + 1 };
      }
    }
  }

  return { intent: 'unknown', reason: 'No marker found' };
}

export class FileIntentClassifier {
  classify(input: FileIntentClassificationInput): FileIntentClassification {
    const fileName = path.basename(input.filePath);
    const ext = path.extname(fileName).toLowerCase();
    const content = input.content ?? undefined;

    if (content) {
      const markerResult = detectFileIntent(input.filePath, content);
      if (markerResult.intent === 'final' || markerResult.intent === 'draft') {
        return {
          intent: markerResult.intent,
          reason: markerResult.reason,
          marker: markerResult.marker,
          line: markerResult.line,
        };
      }
    }

    const userMessage = input.userMessage?.trim() || '';
    const requestedNames = extractRequestedFileNames(userMessage);
    const requestedPath = input.requestedPath || input.filePath;
    const candidates = new Set([path.basename(fileName).toLowerCase(), normalizePathForMatch(requestedPath), normalizePathForMatch(input.filePath)]);
    for (const requestedName of requestedNames) {
      if (candidates.has(requestedName) || candidates.has(path.basename(requestedName))) {
        return { intent: 'final', reason: `Matches requested file name "${requestedName}"`, matched: requestedName };
      }
    }

    const requestedExtensions = inferRequestedExtensions(userMessage);
    if (requestedExtensions.has(ext)) {
      return { intent: 'final', reason: `Matches requested target type ${ext}`, matched: ext };
    }

    if (isScriptSideEffect(fileName)) {
      return { intent: 'draft', reason: 'Script execution side-effect file' };
    }

    if (matchesFinalNamePattern(fileName)) {
      return { intent: 'final', reason: 'Matches final file pattern' };
    }

    if (matchesDraftPattern(fileName)) {
      return { intent: 'draft', reason: 'Matches draft file pattern' };
    }

    if (input.source === 'bash-generated' && BASH_DELIVERABLE_EXTENSIONS.has(ext)) {
      return { intent: 'final', reason: `Bash-generated deliverable file type ${ext}`, matched: ext };
    }

    if (input.source === 'bash-generated') {
      return { intent: 'draft', reason: 'Bash-generated file without explicit final signal' };
    }

    if (isIntermediateScript(fileName, userMessage)) {
      return { intent: 'draft', reason: 'Helper script for a non-script deliverable' };
    }

    if (matchesFinalPattern(fileName)) {
      return { intent: 'final', reason: 'Matches final file pattern' };
    }

    return { intent: 'final', reason: 'No draft signal, defaulting to final' };
  }
}

function extractCommentContent(line: string, commentPrefix: string): string | null {
  if (commentPrefix === '<!--') {
    if (!line.startsWith('<!--') || !line.endsWith('-->')) {
      return null;
    }
    return line.slice(4, -3).trim();
  }

  if (!line.startsWith(commentPrefix)) {
    return null;
  }
  return line.slice(commentPrefix.length).trim();
}

function extractRequestedFileNames(message: string): Set<string> {
  const names = new Set<string>();
  if (!message) return names;

  const quotedPattern = /[`"'“”‘’]([^`"'“”‘’\n]+\.[A-Za-z0-9]{1,8})[`"'“”‘’]/g;
  const pathPattern = /(?:^|[\s([{，。,:：])([A-Za-z0-9._~@+\-/\\\u4e00-\u9fa5]+?\.[A-Za-z0-9]{1,8})(?=$|[\s)\]}，。,.!?:：；;])/g;

  for (const pattern of [quotedPattern, pathPattern]) {
    for (const match of message.matchAll(pattern)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      names.add(normalizePathForMatch(raw));
      names.add(path.basename(raw).toLowerCase());
    }
  }

  return names;
}

function inferRequestedExtensions(message: string): Set<string> {
  const extensions = new Set<string>();
  if (!message) return extensions;

  for (const { pattern, extensions: mappedExtensions } of TARGET_TYPE_EXTENSIONS) {
    if (pattern.test(message)) {
      for (const ext of mappedExtensions) {
        extensions.add(ext);
      }
    }
  }

  return extensions;
}

function isScriptSideEffect(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SCRIPT_SIDE_EFFECT_NAMES.has(lower) || lower.endsWith('.lock');
}

function isIntermediateScript(fileName: string, userMessage: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  if (!SCRIPT_EXTENSIONS.has(ext)) {
    return false;
  }

  const lowerName = path.basename(fileName, ext).toLowerCase();
  const helperName = /^(generate|create|convert|build|render|make|prepare|process|tmp|temp|draft)[_-]/.test(lowerName);
  if (!helperName) {
    return false;
  }

  const requestedExtensions = inferRequestedExtensions(userMessage);
  const requestedScript = Array.from(requestedExtensions).some((requestedExt) => SCRIPT_EXTENSIONS.has(requestedExt));
  return !requestedScript;
}

function normalizePathForMatch(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
