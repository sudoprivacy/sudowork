/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for turning the current turn's tracked files into the
 * `GeneratedFileEntry[]` payload carried by the `[[NEXUS_GENERATED_FILES]]`
 * marker. Extracted from AcpAgent so the path-resolution logic can be unit
 * tested without standing up the full agent / ACP connection.
 *
 * Key invariant: the marker MUST record the file's FINAL on-disk location,
 * i.e. the path after the turn-end archive step (drafts → root, plus any
 * timestamp-collision rename) has run. Callers pass that mapping via
 * `archivedPaths`; when absent we fall back to the tracked `actualPath`.
 */

import nodePath from 'node:path';
import { DRAFTS_DIR_NAME } from '@/common/constants';
import { extractExtension, mimeForExtension, type GeneratedFileEntry } from '@/common/generatedFiles';
import type { TrackedTurnFile } from './draftsCleanup';

/**
 * Compute the workspace-relative display path for a final file. Prefers the
 * file's actual on-disk relative location (or the archived override, when
 * provided); falls back to the originally requested path, and finally the
 * basename. Never returns a `.drafts/`-prefixed or escaping path.
 */
export function resolveFinalFileDisplayPath(file: TrackedTurnFile, workspaceRoot: string, overrideAbsolutePath?: string): string {
  const resolvedActualPath = nodePath.resolve(overrideAbsolutePath ?? file.actualPath);
  const actualRelativePath = nodePath.relative(workspaceRoot, resolvedActualPath);

  if (actualRelativePath && !actualRelativePath.startsWith('..') && !nodePath.isAbsolute(actualRelativePath) && !actualRelativePath.startsWith(`${DRAFTS_DIR_NAME}${nodePath.sep}`)) {
    return actualRelativePath.replace(/\\/g, '/');
  }

  const requestedPath = file.requestedPath || nodePath.basename(file.actualPath);
  const normalizedRequestedPath = requestedPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalizedRequestedPath || normalizedRequestedPath.startsWith('../') || normalizedRequestedPath.includes('/../') || normalizedRequestedPath.startsWith(`${DRAFTS_DIR_NAME}/`)) {
    return nodePath.basename(file.actualPath);
  }

  return normalizedRequestedPath;
}

export interface BuildGeneratedFileEntriesOptions {
  /** Absolute, resolved workspace root. */
  workspaceRoot: string;
  /** Current turn's tracked files, keyed by tracking key (relative path). */
  trackedFiles: ReadonlyMap<string, TrackedTurnFile>;
  /**
   * Map of `trackingKey → final absolute path` returned by `archiveTurnFiles`.
   * When a key is present, its value is used as the entry's path so the marker
   * reflects the post-archive location instead of the pre-archive `actualPath`.
   */
  archivedPaths?: ReadonlyMap<string, string>;
  /** Best-effort size lookup; returns undefined when the file can't be stat'd. */
  statSize?: (absolutePath: string) => number | undefined;
  /** Marker emit time (ms since epoch). Defaults to Date.now(). */
  now?: number;
}

/**
 * Build the deduplicated, sorted `GeneratedFileEntry[]` for the turn's
 * `intent==='final'` files using their FINAL on-disk paths.
 */
export function buildGeneratedFileEntries(options: BuildGeneratedFileEntriesOptions): GeneratedFileEntry[] {
  const { workspaceRoot, trackedFiles, archivedPaths, statSize, now = Date.now() } = options;
  const seen = new Set<string>();
  const entries: GeneratedFileEntry[] = [];

  for (const [trackingKey, file] of trackedFiles) {
    if (file.intent !== 'final') continue;

    const archivedAbsolute = archivedPaths?.get(trackingKey);
    const absolutePath = nodePath.resolve(archivedAbsolute ?? file.actualPath);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);

    const relativePath = resolveFinalFileDisplayPath(file, workspaceRoot, absolutePath);
    const ext = extractExtension(absolutePath);

    entries.push({
      path: absolutePath,
      relativePath: relativePath !== absolutePath ? relativePath : undefined,
      kind: file.kind === 'edit' ? 'edit' : 'create',
      ext,
      mime: mimeForExtension(ext),
      size: statSize?.(absolutePath),
      createdAt: now,
    });
  }

  // Stable order: by relative (or absolute) path.
  return entries.sort((a, b) => (a.relativePath ?? a.path).localeCompare(b.relativePath ?? b.path));
}
