/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill Audit Scanner
 *
 * Scans a skill directory to detect what operations the skill performs:
 * - External API calls (HTTP requests, REST endpoints)
 * - Network connections (sockets, WebSockets, SSH)
 * - Sensitive data collection (env vars, passwords, tokens)
 * - File system access (read/write/delete files)
 * - Executable scripts (command execution, eval, subprocess)
 *
 * Results are presented as operation counts per category, not risk levels.
 */

import fs from 'fs/promises';
import path from 'path';
import type { AuditCategory, AuditCategorySummary, AuditFinding, AuditLanguage, SkillAuditReport } from '@/common/skillAuditTypes';
import { AUDIT_CATEGORY_CONFIG } from '@/common/skillAuditTypes';
import { getRulesForLanguage } from './auditRules';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/** Directories to skip during scanning */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.vscode', '__pycache__', '.env', 'venv', '.venv', '.idea', 'dist', 'build', '.next', '.cache']);

/** Files to skip during scanning */
const EXCLUDED_FILES = new Set(['_sudowork_meta.json', '_sudowork_audit.json', '_sudowork_audit.md', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

/** File extension to language mapping */
const EXTENSION_LANGUAGE_MAP: Record<string, AuditLanguage> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.py': 'python',
  '.pyw': 'python',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
};

/** Maximum file size to scan (1MB) */
const MAX_FILE_SIZE = 1024 * 1024;

let findingIdCounter = 0;

function generateFindingId(): string {
  findingIdCounter += 1;
  return `finding-${Date.now()}-${findingIdCounter}`;
}

/**
 * Check if a line is primarily an output/print/log statement.
 * Matches inside such lines are almost always false positives
 * (e.g. `echo "使用 curl 下载"` is not a real curl invocation).
 */
function isOutputStatement(line: string, language: AuditLanguage): boolean {
  const trimmed = line.trim();
  if (language === 'shell') {
    return /^(echo|printf|log_\w+|print)\s/.test(trimmed);
  }
  if (language === 'python') {
    return /^(print|logging\.\w+|logger\.\w+)\s*\(/.test(trimmed);
  }
  return false;
}

/**
 * Check if a line is a comment in the given language.
 * Simple heuristic — does not handle multi-line comments fully.
 */
function isCommentLine(line: string, language: AuditLanguage): boolean {
  const trimmed = line.trim();
  switch (language) {
    case 'python':
      return trimmed.startsWith('#');
    case 'shell':
      return trimmed.startsWith('#');
    case 'javascript':
    case 'typescript':
      return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    default:
      return false;
  }
}

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): AuditLanguage | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || null;
}

/**
 * Recursively collect files from a directory, excluding certain directories and files.
 */
async function collectFiles(dir: string, baseDir: string): Promise<{ absolutePath: string; relativePath: string }[]> {
  const results: { absolutePath: string; relativePath: string }[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, absolutePath);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        const subResults = await collectFiles(absolutePath, baseDir);
        results.push(...subResults);
      } else if (entry.isFile()) {
        if (EXCLUDED_FILES.has(entry.name)) {
          continue;
        }
        results.push({ absolutePath, relativePath });
      }
    }
  } catch (err) {
    mainWarn('SkillAudit', `Failed to read directory: ${dir}`, err);
  }

  return results;
}

/**
 * Scan a single file for pattern matches.
 */
async function scanFile(filePath: string, relativePath: string, language: AuditLanguage): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      mainWarn('SkillAudit', `Skipping large file: ${relativePath} (${stat.size} bytes)`);
      return findings;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const rules = getRulesForLanguage(language);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      // Skip empty lines
      if (!line.trim()) continue;

      // Skip comment lines (simple heuristic)
      if (isCommentLine(line, language)) continue;

      // Skip output/print/log statements (high false-positive source)
      if (isOutputStatement(line, language)) continue;

      for (const rule of rules) {
        const match = rule.pattern.exec(line);
        if (match) {
          findings.push({
            id: generateFindingId(),
            category: rule.category,
            file: relativePath,
            line: lineIndex + 1,
            column: match.index,
            code: line.trim(),
            pattern: rule.id,
            description: rule.description,
            language,
            detail: extractDetail(line, rule.category),
          });
        }
      }
    }
  } catch (err) {
    mainWarn('SkillAudit', `Failed to scan file: ${relativePath}`, err);
  }

  return findings;
}

/**
 * Try to extract a URL or path from a code line, based on the category.
 */
function extractDetail(line: string, category: AuditCategory): string | undefined {
  if (category === 'external_api' || category === 'network') {
    // Try to extract URL
    const urlMatch = line.match(/['"`](https?:\/\/[^'"`\s]+)['"`]/);
    if (urlMatch) {
      return urlMatch[1];
    }
    // Try to extract domain/IP
    const domainMatch = line.match(/['"`]([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+(?::\d+)?)['"`]/);
    if (domainMatch) {
      return domainMatch[1];
    }
  }

  if (category === 'filesystem') {
    // Try to extract file path
    const pathMatch = line.match(/['"`]((?:\/|\.\/|\.\.\/|~\/)[^'"`\s]+)['"`]/);
    if (pathMatch) {
      return pathMatch[1];
    }
  }

  return undefined;
}

/**
 * Build category summaries from findings.
 */
function buildCategorySummaries(findings: AuditFinding[]): AuditCategorySummary[] {
  const categories: AuditCategory[] = ['external_api', 'network', 'sensitive_data', 'filesystem', 'executable'];

  return categories.map((category) => {
    const config = AUDIT_CATEGORY_CONFIG[category];
    const categoryFindings = findings.filter((f) => f.category === category);
    return {
      category,
      label: config.label,
      count: categoryFindings.length,
      found: categoryFindings.length > 0,
      safeDescription: config.safeDescription,
      foundDescription: config.foundDescription,
    };
  });
}

/**
 * Generate a Markdown audit report.
 */
function generateMarkdownReport(report: Omit<SkillAuditReport, 'markdownReport' | 'reportPath'>): string {
  const lines: string[] = [];

  lines.push('# 安全审计报告');
  lines.push('');
  lines.push('## 基本信息');
  lines.push(`- **Skill**: ${report.skillName}`);
  lines.push(`- **审计时间**: ${report.auditTime}`);
  lines.push(`- **扫描文件数**: ${report.scannedFiles}/${report.totalFiles}`);
  lines.push('');

  // Category summary
  lines.push('## 审计总览');
  lines.push('');
  lines.push('| 检测维度 | 状态 | 详情 |');
  lines.push('|----------|------|------|');

  for (const summary of report.categorySummaries) {
    const status = summary.found ? `\u26A0\uFE0F 检测到 ${summary.count} 处` : '\u2705 未检测到';
    const description = summary.found ? summary.foundDescription : summary.safeDescription;
    lines.push(`| ${summary.label} | ${status} | ${description} |`);
  }

  lines.push('');

  // Detailed findings grouped by category
  if (report.hasFindings) {
    lines.push('## 详细发现');
    lines.push('');

    const categories: AuditCategory[] = ['external_api', 'network', 'sensitive_data', 'filesystem', 'executable'];
    for (const category of categories) {
      const categoryFindings = report.findings.filter((f) => f.category === category);
      if (categoryFindings.length === 0) continue;

      const config = AUDIT_CATEGORY_CONFIG[category];
      lines.push(`### ${config.label} (${categoryFindings.length} 处)`);
      lines.push('');

      for (const finding of categoryFindings) {
        lines.push(`- **${finding.file}:${finding.line}**`);
        lines.push(`  - \`${finding.code}\``);
        lines.push(`  - ${finding.description}`);
        if (finding.detail) {
          lines.push(`  - 目标: \`${finding.detail}\``);
        }
        lines.push('');
      }
    }
  } else {
    lines.push('## 结论');
    lines.push('');
    lines.push('经过审计，该技能未检测到外部API调用、网络连接、敏感数据收集、系统文件操作或命令执行等操作。');
    lines.push('');
  }

  lines.push('---');
  lines.push('> 由 Sudowork 安全审计引擎自动生成');
  lines.push('');

  return lines.join('\n');
}

/**
 * Deduplicate findings: same file + same line + same rule → keep only one.
 */
function deduplicateFindings(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Scan a skill directory and produce an audit report.
 *
 * @param skillDir  Absolute path to the skill installation directory
 * @param skillName Skill name for the report
 * @returns Complete audit report with findings, summaries, and Markdown
 */
export async function scanSkillDirectory(skillDir: string, skillName: string): Promise<SkillAuditReport> {
  mainLog('SkillAudit', `Starting audit for skill "${skillName}" at ${skillDir}`);

  // Collect all files
  const allFiles = await collectFiles(skillDir, skillDir);
  const totalFiles = allFiles.length;

  // Filter to scannable files (known extensions)
  const scannableFiles = allFiles.filter((f) => detectLanguage(f.absolutePath) !== null);
  const scannedFiles = scannableFiles.length;

  // Scan each file
  let allFindings: AuditFinding[] = [];
  for (const file of scannableFiles) {
    const language = detectLanguage(file.absolutePath)!;
    const fileFindings = await scanFile(file.absolutePath, file.relativePath, language);
    allFindings.push(...fileFindings);
  }

  // Deduplicate
  allFindings = deduplicateFindings(allFindings);

  // Build summaries
  const categorySummaries = buildCategorySummaries(allFindings);
  const hasFindings = allFindings.length > 0;

  // Generate Markdown
  const partialReport = {
    skillName,
    auditTime: new Date().toISOString(),
    totalFiles,
    scannedFiles,
    findings: allFindings,
    categorySummaries,
    hasFindings,
  };

  const markdownReport = generateMarkdownReport(partialReport);

  // Save audit results
  const auditJsonPath = path.join(skillDir, '_sudowork_audit.json');
  const auditMdPath = path.join(skillDir, '_sudowork_audit.md');

  const report: SkillAuditReport = {
    ...partialReport,
    markdownReport,
    reportPath: auditMdPath,
  };

  try {
    await fs.writeFile(auditJsonPath, JSON.stringify(report, null, 2), 'utf-8');
    await fs.writeFile(auditMdPath, markdownReport, 'utf-8');
    mainLog('SkillAudit', `Audit report saved to ${auditMdPath}`);
  } catch (err) {
    mainWarn('SkillAudit', 'Failed to save audit report:', err);
  }

  mainLog('SkillAudit', `Audit complete: ${allFindings.length} findings across ${scannedFiles} files`);

  return report;
}

/**
 * Read a previously saved audit report from a skill directory.
 *
 * @param skillDir Absolute path to the skill directory
 * @returns The saved audit report, or null if not found
 */
export async function readAuditReport(skillDir: string): Promise<SkillAuditReport | null> {
  try {
    const auditJsonPath = path.join(skillDir, '_sudowork_audit.json');
    const raw = await fs.readFile(auditJsonPath, 'utf-8');
    return JSON.parse(raw) as SkillAuditReport;
  } catch {
    return null;
  }
}
