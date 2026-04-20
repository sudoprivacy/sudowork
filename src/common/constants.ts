/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';

/**
 * AionUI应用程序共用常量
 */

// ===== 文件处理相关常量 =====

/** 临时文件时间戳分隔符 */
export const NEXUS_TIMESTAMP_SEPARATOR = '_nexus_';

/** 用于匹配和清理时间戳后缀的正则表达式 */
export const NEXUS_TIMESTAMP_REGEX = /_nexus_\d{13}(\.\w+)?$/;
export const NEXUS_FILES_MARKER = '[[NEXUS_FILES]]';

// ===== 媒体类型相关常量 =====

/** 支持的图片文件扩展名 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'] as const;

/** 文件扩展名到MIME类型的映射 */
export const MIME_TYPE_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

/** MIME类型到文件扩展名的映射 */
export const MIME_TO_EXT_MAP: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  bmp: '.bmp',
  tiff: '.tiff',
  'svg+xml': '.svg',
};

/** 默认图片文件扩展名 */
export const DEFAULT_IMAGE_EXTENSION = '.png';

// ===== 工作空间相关常量 / Workspace Constants =====

/** 草稿箱物理目录名（固定，不随语言变化）/ Drafts directory name (fixed, language-independent) */
export const DRAFTS_DIR_NAME = '.drafts';

/**
 * 文件意图标记系统
 * File Intent Marking System
 *
 * 用于 Agent 显式声明文件用途，替代硬编码扩展名判断
 */
export const FILE_INTENT_MARKERS = {
  final: ['@final', '@output', '@deliverable', '@result'],
  draft: ['@draft', '@intermediate', '@temp', '@scratch'],
};

/**
 * 不同语言的注释语法映射
 * Comment syntax mapping for different languages
 */
export const COMMENT_SYNTAX_MAP: Record<string, string> = {
  // Python family
  '.py': '#',
  '.pyw': '#',
  '.sh': '#',
  '.bash': '#',
  '.zsh': '#',
  '.rb': '#',
  '.pl': '#',
  '.pm': '#',
  '.lua': '#',
  '.r': '#',
  '.rscript': '#',

  // JavaScript family
  '.js': '//',
  '.jsx': '//',
  '.ts': '//',
  '.tsx': '//',
  '.mjs': '//',
  '.cjs': '//',
  '.es6': '//',

  // C/C++ family
  '.c': '//',
  '.cpp': '//',
  '.cc': '//',
  '.cxx': '//',
  '.h': '//',
  '.hpp': '//',
  '.java': '//',
  '.cs': '//',
  '.go': '//',
  '.rs': '//',
  '.swift': '//',
  '.kt': '//',
  '.kts': '//',

  // Data/Config files (use # as default)
  '.yaml': '#',
  '.yml': '#',
  '.toml': '#',
  '.ini': '#',
  '.conf': '#',
  '.cfg': '#',
  '.json': '#', // JSON comments are non-standard but some parsers support them

  // Markup files (use HTML comment style)
  '.html': '<!--',
  '.htm': '<!--',
  '.xml': '<!--',
  '.svg': '<!--',

  // Markdown (often uses # for headings, so use HTML comment)
  '.md': '<!--',
  '.markdown': '<!--',

  // Default fallback
  default: '#',
};

/**
 * 获取文件的注释前缀
 * Get comment prefix for a file extension
 */
export function getCommentPrefix(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return COMMENT_SYNTAX_MAP[ext] || COMMENT_SYNTAX_MAP.default;
}

// ===== AI Provider 相关常量 =====

// Stable ID for the Google Auth virtual provider.
// Shared between frontend (useModelProviderList) and backend (SystemActions).
export const GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini';
