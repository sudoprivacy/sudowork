/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build-time metadata injected via Vite `define`.
 *
 * In production builds these globals are replaced with string literals.
 * During development they fall back to sensible defaults.
 *
 * CI can override via environment variables:
 *   BUILD_VERSION      – version string (e.g. from git tag)
 *   BUILD_DATE         – commit date in YYYY-MM-DD format
 *   BUILD_COMMIT       – short commit hash
 *   BUILD_IS_NIGHTLY   – "true" when building a nightly/pre-release
 */

declare const __BUILD_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_IS_NIGHTLY__: boolean;

/** Application version – from git tag, or date-commit for untagged builds */
export const buildVersion: string = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : '0.0.0-dev';

/** Commit date in YYYY-MM-DD format */
export const buildDate: string = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'unknown';

/** Short commit hash */
export const buildCommit: string = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown';

/** Whether this is a nightly (pre-release) build */
export const isNightlyBuild: boolean = typeof __BUILD_IS_NIGHTLY__ !== 'undefined' ? __BUILD_IS_NIGHTLY__ : false;

/**
 * Parse a nightly tag to extract its date component.
 * Expected formats:
 *   nightly-YYYY-MM-DD
 *   nightly-YYYY-MM-DD-SHORTHASH
 *   vX.Y.Z-nightly.YYYYMMDD
 * Returns the date string (YYYY-MM-DD or YYYYMMDD) or null if not a nightly tag.
 */
export function parseNightlyDate(tag: string): string | null {
  // nightly-2026-04-07 or nightly-2026-04-07-abc1234
  const m1 = tag.match(/^nightly-(\d{4}-\d{2}-\d{2})(?:-[a-f0-9]+)?$/i);
  if (m1) return m1[1];

  // vX.Y.Z-nightly.20260407
  const m2 = tag.match(/-nightly\.(\d{8})$/i);
  if (m2) {
    const d = m2[1];
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }

  return null;
}

/**
 * Check if a tag represents a nightly release.
 */
export function isNightlyTag(tag: string): boolean {
  return /^nightly-/i.test(tag) || /-nightly\./i.test(tag);
}

/**
 * Compare two nightly tags by their embedded date (and optional hash).
 * Returns positive if `a` is newer, negative if `b` is newer, 0 if equal.
 */
export function compareNightlyTags(a: string, b: string): number {
  const dateA = parseNightlyDate(a);
  const dateB = parseNightlyDate(b);
  if (!dateA || !dateB) return 0;
  // Normalize to YYYYMMDD for comparison
  const normA = dateA.replace(/-/g, '');
  const normB = dateB.replace(/-/g, '');
  return normA.localeCompare(normB);
}
