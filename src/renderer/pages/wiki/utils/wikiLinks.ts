/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/** Markdown pages of a built wiki; AGENTS.md holds moss's build instructions, not content. */
export function isWikiContentFile(file: string): boolean {
  return file.endsWith('.md') && file !== 'AGENTS.md';
}

/** Resolve a relative markdown link inside a wiki to a file path; null for external or non-page links. */
export function wikiLinkTarget(href: string, fromFile: string | null): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return null;
  const path = decodeURIComponent(href.split('#')[0].split('?')[0]);
  if (!path.endsWith('.md')) return null;
  const parts = (fromFile && fromFile.includes('/') ? fromFile.split('/').slice(0, -1) : []).concat(path.split('/'));
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part && part !== '.') resolved.push(part);
  }
  return resolved.join('/') || null;
}
