/**
 * Sudowork 应用程序共用常量
 */

import type { IBlacklistConfig } from './types/security.js';

/** 临时文件时间戳分隔符 */
export const NEXUS_TIMESTAMP_SEPARATOR = '_nexus_';

/** 用于匹配和清理时间戳后缀的正则表达式 */
export const NEXUS_TIMESTAMP_REGEX = /_nexus_\d{13}(\.\w+)?$/;

/**
 * 去掉文件名（不含扩展名）末尾所有的 `_nexus_<13位时间戳>` 后缀。
 * Strip every trailing `_nexus_<13-digit timestamp>` suffix from a file's
 * base name (extension already removed).
 *
 * 追加时间戳前必须先调用本函数，否则同名文件反复冲突时后缀会不断累积，
 * 变成 `a_nexus_<t1>_nexus_<t2>.xlsx`。循环去除是因为历史文件可能已经
 * 带有多个后缀 —— NEXUS_TIMESTAMP_REGEX 以 `$` 锚定，单次只能去掉一个。
 *
 * Must be called before appending a new timestamp, otherwise repeated
 * collisions accumulate suffixes. Loops because existing files may already
 * carry several: NEXUS_TIMESTAMP_REGEX is `$`-anchored and strips only one
 * per pass.
 */
export function stripNexusTimestampSuffixes(baseName: string): string {
  let out = baseName;
  // 有界循环，避免正则意外不收敛时死循环 / Bounded so a non-converging
  // replace can never spin forever.
  for (let i = 0; i < 16; i++) {
    const next = out.replace(NEXUS_TIMESTAMP_REGEX, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}
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

/** 草稿箱常见误写别名（不应作为普通目录创建）/ Common mistaken aliases for the drafts directory */
export const DRAFTS_DIR_ALIASES = ['drafts', 'Drafts', '草稿箱'] as const;

/** 判断目录名是否指向草稿箱保留目录 / Check whether a directory name is reserved for drafts */
export function isReservedDraftsDirName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === DRAFTS_DIR_NAME || DRAFTS_DIR_ALIASES.some((alias) => alias.toLowerCase() === normalized);
}

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
 * Draft file name patterns (prefixes and suffixes)
 * 草稿文件名模式（前缀和后缀）
 *
 * Files matching these patterns are considered draft files
 */
export const DRAFT_FILE_PATTERNS = {
  // Prefix patterns (file name starts with these)
  prefixes: ['temp_', 'temp-', 'tmp_', 'tmp-', 'temporary_', 'temporary-', 'draft_', 'draft-', 'wip_', 'wip-', 'scratch_', 'scratch-', 'proto_', 'proto-', 'poc_', 'poc-', 'step_', 'step-', 'step1', 'step2', 'step3', 'step4', 'step5', 'phase_', 'phase-', 'phase1', 'phase2', 'phase3'],
  // Suffix patterns (file name ends with these, before extension)
  suffixes: ['_draft', '-draft', '_wip', '-wip', '_temp', '-temp', '_tmp', '-tmp', '_backup', '-backup', '_bak', '-bak', '_old', '-old'],
};

/**
 * Final file name patterns (override draft patterns)
 * 最终文件名模式（覆盖草稿模式）
 */
export const FINAL_FILE_PATTERNS = {
  suffixes: ['_final', '-final', '_result', '-result', '_output', '-output', '_completed', '-completed', '_done', '-done'],
};

/**
 * Draft file extensions
 * 草稿文件扩展名
 */
export const DRAFT_EXTENSIONS = ['.tmp', '.temp', '.bak', '.backup', '.log', '.cache'];

/**
 * Final file extensions (user-requested code/data files)
 * 最终文件扩展名（用户请求的代码/数据文件）
 */
export const FINAL_EXTENSIONS = [
  // Documents
  '.md',
  '.txt',
  '.pdf',
  '.docx',
  '.pptx',
  // Data files
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.xlsx',
  // Code files
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rb',
  '.php',
  '.lua',
  // Config files
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  // Web/images
  '.html',
  '.css',
  '.scss',
  '.png',
  '.jpg',
  '.svg',
];

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
  const ext = fileExtname(filePath).toLowerCase();
  return COMMENT_SYNTAX_MAP[ext] || COMMENT_SYNTAX_MAP.default;
}

/**
 * Browser-safe equivalent of node's path.extname: returns the extension
 * including the leading dot (e.g. ".ts"), or "" when there is none. Avoids
 * importing node:path so this shared module bundles cleanly in the renderer.
 */
function fileExtname(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  // No dot, or a leading dot (dotfile like ".gitignore") → no extension.
  if (dot <= 0) return '';
  return base.slice(dot);
}

// ===== AI Provider 相关常量 =====

// Stable ID for the Google Auth virtual provider.
// Shared between frontend (useModelProviderList) and backend (SystemActions).
export const GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini';

/** 黑名单默认配置（空规则集） */
export const DEFAULT_BLACKLIST_CONFIG: IBlacklistConfig = { rules: [] };
