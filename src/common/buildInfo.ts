/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build-time metadata injected via Vite `define` in electron.vite.config.ts.
 *
 * Values are populated at build time from git / environment variables:
 *   - __BUILD_VERSION__   : git tag (e.g. "0.1.3") or package.json version
 *   - __BUILD_DATE__      : commit date in ISO-8601 format (e.g. "2026-04-07")
 *   - __BUILD_COMMIT__    : short commit hash (e.g. "abc1234")
 *   - __BUILD_IS_NIGHTLY__: whether this is a nightly (pre-release) build
 *
 * CI workflows can override these via environment variables:
 *   BUILD_VERSION, BUILD_DATE, BUILD_COMMIT, BUILD_IS_NIGHTLY
 */

declare const __BUILD_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_IS_NIGHTLY__: boolean;

/** Application version (from git tag or package.json) */
export const buildVersion: string = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : '0.0.0-dev';

/** Commit date in YYYY-MM-DD format */
export const buildDate: string = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'unknown';

/** Short commit hash */
export const buildCommit: string = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown';

/** Whether this is a nightly (pre-release) build */
export const isNightlyBuild: boolean = typeof __BUILD_IS_NIGHTLY__ !== 'undefined' ? __BUILD_IS_NIGHTLY__ : false;

/**
 * Parse a nightly tag to extract its date.
 * Nightly tags follow the format: nightly-YYYY-MM-DD-SHORTHASH
 * @returns The date string (YYYY-MM-DD) or null if not a valid nightly tag.
 */
export function parseNightlyDate(tag: string): string | null {
  const match = tag.match(/^nightly-(\d{4}-\d{2}-\d{2})-[a-f0-9]+$/);
  return match ? match[1] : null;
}

/**
 * Compare two nightly tags by date.
 * @returns Positive if a is newer, negative if b is newer, 0 if same date.
 */
export function compareNightlyTags(a: string, b: string): number {
  const dateA = parseNightlyDate(a);
  const dateB = parseNightlyDate(b);
  if (!dateA || !dateB) return 0;
  return dateA.localeCompare(dateB);
}

/**
 * Check if a tag is a nightly tag.
 */
export function isNightlyTag(tag: string): boolean {
  return /^nightly-\d{4}-\d{2}-\d{2}-[a-f0-9]+$/.test(tag);
}

/**
 * Get a human-readable build description string.
 */
export function getBuildDescription(): string {
  if (isNightlyBuild) {
    return `nightly (${buildDate}, ${buildCommit})`;
  }
  return `v${buildVersion} (${buildDate})`;
}
