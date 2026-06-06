/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { COMMENT_SYNTAX_MAP, DRAFTS_DIR_NAME, DRAFT_EXTENSIONS, DRAFT_FILE_PATTERNS, FILE_INTENT_MARKERS, FINAL_EXTENSIONS, FINAL_FILE_PATTERNS } from '@/common/constants';
import path from 'path';

export type FileIntent = 'final' | 'draft';
export type FileIntentSource = 'write' | 'edit' | 'bash-generated' | 'cleanup';
export type FileOperationIntent = 'restore-from-drafts' | 'move-to-drafts';

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
  operationIntent?: FileOperationIntent;
}

export interface FileIntentClassification {
  intent: FileIntent;
  reason: string;
  marker?: string;
  line?: number;
  matched?: string;
}

export interface BashDraftRestoreDetection {
  explicitPaths: Set<string>;
  explicitBasenames: Set<string>;
  wildcard: boolean;
}

const SCRIPT_EXTENSIONS = new Set(['.py', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.sh', '.bash', '.zsh', '.rb', '.php', '.lua']);
const SCRIPT_SIDE_EFFECT_NAMES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'requirements.txt']);
// Office + text formats that are reasonable defaults to treat as deliverables
// when an agent's bash script writes them. Images were intentionally removed
// (see Anthropic-skills convention rules below): bash-written PNG / JPG /
// SVG are usually intermediate slide frames / thumbnails / chart exports.
// If the user explicitly asks for an image (caught by inferRequestedExtensions
// earlier), the request matches and `final` is returned before this rule.
const BASH_DELIVERABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.json', '.md', '.markdown', '.txt', '.html', '.htm']);

// Anthropic skills convention (mirrors `anthropics/skills/skills/pptx/SKILL.md`):
// all generated files go to `outputs/<document-name>/`. The deliverable is
// named `final.<ext>`; everything else in that directory is intermediate.
// Recognized whenever the workspace-relative path matches one of these shapes.
const ANTHROPIC_FINAL_OUTPUTS_RE = /^outputs\/[^/]+\/final\.[a-z0-9]+$/i;
const ANTHROPIC_INSIDE_OUTPUTS_RE = /^outputs\/[^/]+\/.+/i;

// Legacy sudowork-hub conventions used by skills that have not yet adopted
// the Anthropic `outputs/<doc>/` pattern. A file whose FIRST relative-path
// segment is in this set is treated as intermediate (draft). Lowercase keys.
const INTERMEDIATE_DIR_SEGMENTS = new Set([
  'ppt_outputs',
  'pptx_outputs',
  'docx_outputs',
  'xlsx_outputs',
  'pdf_outputs',
  'slides_output',
  'slide_images',
  'intermediate',
  '_intermediate',
  '_tmp',
  '_temp',
  '_cache',
  '_artifacts',
  '_build',
]);

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

export function detectBashDraftRestoreCommand(command?: string | null): BashDraftRestoreDetection {
  const detection: BashDraftRestoreDetection = {
    explicitPaths: new Set<string>(),
    explicitBasenames: new Set<string>(),
    wildcard: false,
  };

  if (!command?.trim()) {
    return detection;
  }

  for (const segment of splitShellCommandSegments(command)) {
    const words = tokenizeShellWords(segment);
    const mvIndex = words.findIndex((word) => path.basename(word) === 'mv');
    if (mvIndex === -1) {
      continue;
    }

    const operands: string[] = [];
    let optionsEnded = false;
    for (const word of words.slice(mvIndex + 1)) {
      if (!optionsEnded && word === '--') {
        optionsEnded = true;
        continue;
      }
      if (!optionsEnded && operands.length === 0 && /^-[A-Za-z]/.test(word)) {
        continue;
      }
      operands.push(word);
    }

    if (operands.length < 2) {
      continue;
    }

    const destination = operands[operands.length - 1];
    if (isDraftsPath(destination)) {
      continue;
    }

    for (const source of operands.slice(0, -1)) {
      if (!isDraftsPath(source)) {
        continue;
      }

      if (source.includes('*') || source.includes('?') || source.includes('[')) {
        detection.wildcard = true;
        continue;
      }

      addRestoredDestination(detection, source, destination);
    }
  }

  return detection;
}

export class FileIntentClassifier {
  classify(input: FileIntentClassificationInput): FileIntentClassification {
    const fileName = path.basename(input.filePath);
    const ext = path.extname(fileName).toLowerCase();
    const content = input.content ?? undefined;
    const userMessage = input.userMessage?.trim() || '';

    if (input.source !== 'cleanup' && input.operationIntent === 'move-to-drafts' && isDraftsPath(input.filePath, input.requestedPath)) {
      return { intent: 'draft', reason: 'Move to drafts requested' };
    }

    if (input.source !== 'cleanup' && input.operationIntent === 'restore-from-drafts' && isRestoredRootFile(input.filePath, input.requestedPath)) {
      return { intent: 'final', reason: 'Bash moved file from drafts to workspace root' };
    }

    if (input.source !== 'cleanup' && isMoveToDraftsIntent(userMessage) && isDraftsPath(input.filePath, input.requestedPath)) {
      return { intent: 'draft', reason: 'Move to drafts requested' };
    }

    if (input.source !== 'cleanup' && isRestoreFromDraftsIntent(userMessage) && isRestoredRootFile(input.filePath, input.requestedPath) && !matchesExcludedFileName(userMessage, input.filePath, input.requestedPath)) {
      return { intent: 'final', reason: 'Restore from drafts to workspace root' };
    }

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

    const requestedNames = extractRequestedFileNames(userMessage);
    const excludedNames = extractExcludedFileNames(userMessage);
    const requestedPath = input.requestedPath || input.filePath;
    const candidates = new Set([path.basename(fileName).toLowerCase(), normalizePathForMatch(requestedPath), normalizePathForMatch(input.filePath)]);
    for (const requestedName of requestedNames) {
      if (excludedNames.has(requestedName) || excludedNames.has(path.basename(requestedName))) {
        continue;
      }

      if (candidates.has(requestedName) || candidates.has(path.basename(requestedName))) {
        return { intent: 'final', reason: `Matches requested file name "${requestedName}"`, matched: requestedName };
      }
    }

    const requestedExtensions = inferRequestedExtensions(userMessage);
    if (requestedExtensions.has(ext)) {
      return { intent: 'final', reason: `Matches requested target type ${ext}`, matched: ext };
    }

    // Directory-structure rules. Run AFTER the user-driven explicit signals
    // above (so a user request for a specific file by name still wins) and
    // BEFORE generic heuristics (so a file in a known intermediate dir is
    // not accidentally promoted by extension fallbacks).
    const relativeKey = normalizePathForMatch(input.requestedPath || input.filePath);
    if (relativeKey) {
      if (ANTHROPIC_FINAL_OUTPUTS_RE.test(relativeKey)) {
        return { intent: 'final', reason: 'Anthropic outputs/<doc>/final.<ext> convention', matched: relativeKey };
      }
      if (ANTHROPIC_INSIDE_OUTPUTS_RE.test(relativeKey)) {
        return { intent: 'draft', reason: 'Intermediate file inside Anthropic outputs/<doc>/ tree', matched: relativeKey };
      }
      const firstSegment = relativeKey.split('/')[0] || '';
      if (firstSegment && INTERMEDIATE_DIR_SEGMENTS.has(firstSegment)) {
        return { intent: 'draft', reason: `Located in legacy intermediate directory "${firstSegment}"`, matched: firstSegment };
      }
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

function splitShellCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const next = command[i + 1];

    if (char === '\\') {
      current += char;
      if (next) {
        current += next;
        i++;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '\n' || char === ';' || (char === '&' && next === '&') || (char === '|' && next === '|')) {
      if (current.trim()) {
        segments.push(current.trim());
      }
      current = '';
      if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
        i++;
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments;
}

function tokenizeShellWords(segment: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    const next = segment[i + 1];

    if (char === '\\') {
      if (next) {
        current += next;
        i++;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    words.push(current);
  }

  return words;
}

function addRestoredDestination(detection: BashDraftRestoreDetection, source: string, destination: string): void {
  const sourceName = path.basename(normalizePathForMatch(source));
  if (!sourceName) {
    return;
  }

  const normalizedDestination = normalizePathForMatch(destination);
  const destinationIsDirectory = destination === '.' || destination === './' || destination.endsWith('/') || normalizedDestination === '';
  const restoredPath = destinationIsDirectory ? sourceName : normalizedDestination;

  if (!restoredPath || restoredPath.includes('*') || isDraftsPathSegment(restoredPath)) {
    return;
  }

  detection.explicitPaths.add(restoredPath);
  detection.explicitBasenames.add(path.basename(restoredPath).toLowerCase());
}

function extractRequestedFileNames(message: string): Set<string> {
  const names = new Set<string>();
  if (!message) return names;

  const quotedPattern = /[`"'“”‘’]([^`"'“”‘’\n]+\.[A-Za-z0-9]{1,8})[`"'“”‘’]/g;
  const pathPattern = /(?:^|[\s([{，。,:：])([A-Za-z0-9._~@+\-/\\\u4e00-\u9fa5]+?\.[A-Za-z0-9]{1,8})(?=$|[\s)\]}，。,.!?:：；;])/g;
  const actionPathPattern = /(?:将|把|移动|移出|移到|恢复|还原|放到|move|restore)\s*([A-Za-z0-9._~@+\-/\\\u4e00-\u9fa5]+?\.[A-Za-z0-9]{1,8})(?=$|[\s)\]}，。,.!?:：；;]|[\u0080-\uFFFF])/gi;

  for (const pattern of [quotedPattern, pathPattern, actionPathPattern]) {
    for (const match of message.matchAll(pattern)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      names.add(normalizePathForMatch(raw));
      names.add(path.basename(raw).toLowerCase());
    }
  }

  return names;
}

function extractExcludedFileNames(message: string): Set<string> {
  const names = new Set<string>();
  if (!message) return names;

  const fileNamePattern = String.raw`([A-Za-z0-9._~@+\-/\\\u4e00-\u9fa5]+?\.[A-Za-z0-9]{1,8})`;
  const patterns = [new RegExp(`${fileNamePattern}\\s*(?:文件)?\\s*(?:之外|以外|除外)`, 'gi'), new RegExp(`(?:除了|除|排除|不包括|except)\\s*[\\s\`"'“”‘’]*${fileNamePattern}`, 'gi')];

  for (const pattern of patterns) {
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

function isRestoreFromDraftsIntent(message: string): boolean {
  if (!message) {
    return false;
  }

  const mentionsDrafts = /\.drafts\b|草稿箱|草稿目录|\bdrafts?\b/i.test(message);
  const restoreAction = /移动|移出|移到|搬到|放到|恢复|还原|move|restore/i.test(message);
  const workspaceDestination = /工作目录|根目录|workspace|root|项目目录/i.test(message);
  const movesToDrafts = /(?:移动|移到|搬到|放到|move|restore)[^\n。；;]*(?:\.drafts\b|草稿箱|草稿目录|\bdrafts?\b)/i.test(message);
  return mentionsDrafts && restoreAction && workspaceDestination && !movesToDrafts;
}

function isRestoredRootFile(filePath: string, requestedPath?: string): boolean {
  const normalizedPaths = [filePath, requestedPath].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(normalizePathForMatch);
  return normalizedPaths.length > 0 && normalizedPaths.every((value) => !isDraftsPathSegment(value));
}

function matchesExcludedFileName(message: string, filePath: string, requestedPath?: string): boolean {
  const excludedNames = extractExcludedFileNames(message);
  if (excludedNames.size === 0) {
    return false;
  }

  const candidates = [path.basename(filePath).toLowerCase(), normalizePathForMatch(filePath)];
  if (requestedPath) {
    candidates.push(path.basename(requestedPath).toLowerCase(), normalizePathForMatch(requestedPath));
  }

  return candidates.some((candidate) => excludedNames.has(candidate));
}

function isMoveToDraftsIntent(message: string): boolean {
  if (!message) {
    return false;
  }

  return /(?:移动|移到|搬到|放到|move)[^\n。；;]*(?:\.drafts\b|草稿箱|草稿目录|\bdrafts?\b)/i.test(message);
}

function isDraftsPath(filePath: string, requestedPath?: string): boolean {
  return [filePath, requestedPath]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizePathForMatch)
    .some(isDraftsPathSegment);
}

function isDraftsPathSegment(value: string): boolean {
  return value.split('/').includes(DRAFTS_DIR_NAME);
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
