/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill Security Audit Types
 *
 * Types for the skill security audit feature that analyzes what operations
 * a custom skill performs (network calls, file access, command execution, etc.)
 */

/** Audit operation categories */
export type AuditCategory = 'external_api' | 'network' | 'sensitive_data' | 'filesystem' | 'executable';

/** Supported languages for audit scanning */
export type AuditLanguage = 'javascript' | 'typescript' | 'python' | 'shell';

/** Single audit finding — a specific operation detected in code */
export interface AuditFinding {
  /** Unique identifier */
  id: string;
  /** Operation category */
  category: AuditCategory;
  /** Source file (relative path) */
  file: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (0-based, optional) */
  column?: number;
  /** Matched code snippet */
  code: string;
  /** Rule pattern name */
  pattern: string;
  /** Human-readable description */
  description: string;
  /** Detected language */
  language: AuditLanguage;
  /** Extra info: e.g. detected URL for network calls, file path for fs ops */
  detail?: string;
}

/** Category summary — how many findings per category */
export interface AuditCategorySummary {
  /** Operation category */
  category: AuditCategory;
  /** Human-readable label */
  label: string;
  /** Number of findings in this category */
  count: number;
  /** Whether any findings exist in this category */
  found: boolean;
  /** Short description when no findings */
  safeDescription: string;
  /** Short description when findings exist */
  foundDescription: string;
}

/** Complete audit report for a skill */
export interface SkillAuditReport {
  /** Skill name */
  skillName: string;
  /** Audit timestamp (ISO 8601) */
  auditTime: string;
  /** Total number of files in the skill directory */
  totalFiles: number;
  /** Number of files actually scanned (code files only) */
  scannedFiles: number;
  /** All findings */
  findings: AuditFinding[];
  /** Summary per category */
  categorySummaries: AuditCategorySummary[];
  /** Whether any findings were detected */
  hasFindings: boolean;
  /** Pre-rendered Markdown report */
  markdownReport: string;
  /** Path to the saved Markdown report file */
  reportPath?: string;
}

/** Audit category display configuration */
export const AUDIT_CATEGORY_CONFIG: Record<AuditCategory, { label: string; labelEn: string; safeDescription: string; safeDescriptionEn: string; foundDescription: string; foundDescriptionEn: string }> = {
  external_api: {
    label: '外部API调用',
    labelEn: 'External API Calls',
    safeDescription: '纯本地处理',
    safeDescriptionEn: 'Pure local processing',
    foundDescription: '检测到外部API调用',
    foundDescriptionEn: 'External API calls detected',
  },
  network: {
    label: '网络连接需求',
    labelEn: 'Network Connections',
    safeDescription: '不连接外部服务',
    safeDescriptionEn: 'No external service connections',
    foundDescription: '存在网络连接操作',
    foundDescriptionEn: 'Network connection operations detected',
  },
  sensitive_data: {
    label: '敏感数据收集',
    labelEn: 'Sensitive Data Collection',
    safeDescription: '仅处理用户提供的文档',
    safeDescriptionEn: 'Only processes user-provided documents',
    foundDescription: '检测到敏感数据访问',
    foundDescriptionEn: 'Sensitive data access detected',
  },
  filesystem: {
    label: '系统文件访问',
    labelEn: 'System File Access',
    safeDescription: '工作范围受限',
    safeDescriptionEn: 'Limited working scope',
    foundDescription: '存在文件系统操作',
    foundDescriptionEn: 'File system operations detected',
  },
  executable: {
    label: '可执行脚本',
    labelEn: 'Executable Scripts',
    safeDescription: '所有文件为纯文档',
    safeDescriptionEn: 'All files are plain documents',
    foundDescription: '检测到命令执行操作',
    foundDescriptionEn: 'Command execution operations detected',
  },
};
