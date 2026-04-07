/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Path validation utilities for workspace directory operations
 * 工作空间目录操作的路径验证工具
 */

/** Characters invalid on Windows file systems */
const INVALID_CHARS_WINDOWS = /[<>:"/\\|?*\x00-\x1f]/;

/** Characters invalid on Unix file systems */
const INVALID_CHARS_UNIX = /[/\x00]/;

/** Reserved names on Windows (case-insensitive) */
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Validate if a string is a valid directory name
 * 验证字符串是否为合法的目录名
 *
 * @param name - The directory name to validate
 * @returns true if the name is valid
 */
export function isValidDirectoryName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  if (name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  if (RESERVED_NAMES.test(name)) return false;
  if (name.startsWith(' ') || name.endsWith(' ')) return false;
  if (name.endsWith('.')) return false;

  const isWindows = process.platform === 'win32';
  const invalidChars = isWindows ? INVALID_CHARS_WINDOWS : INVALID_CHARS_UNIX;
  return !invalidChars.test(name);
}
