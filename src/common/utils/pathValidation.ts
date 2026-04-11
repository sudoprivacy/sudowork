/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Directory name validation utilities
 * 目录名合法性验证工具函数
 */

const INVALID_CHARS_WINDOWS = /[<>:"/\\|?*\x00-\x1f]/;
const INVALID_CHARS_UNIX = /[/\x00]/;
const RESERVED_NAMES_WINDOWS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Check if a directory name is valid for the current platform
 * 检查目录名在当前平台上是否合法
 */
export function isValidDirectoryName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  if (name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  if (RESERVED_NAMES_WINDOWS.test(name)) return false;

  const isWindows = process.platform === 'win32';
  const invalidChars = isWindows ? INVALID_CHARS_WINDOWS : INVALID_CHARS_UNIX;
  return !invalidChars.test(name);
}
