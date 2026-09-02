/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { NEXUS_FILES_MARKER } from './constants';

/**
 * Parse the `[[NEXUS_FILES]]` marker from a message and extract file paths.
 *
 * @param input Message text potentially containing the marker
 * @returns Object with cleanText (without marker and paths), and files array
 */
export function parseNexusFilesMarker(input: string): { cleanText: string; files: string[] } {
  const markerIndex = input.indexOf(NEXUS_FILES_MARKER);
  if (markerIndex === -1) {
    return { cleanText: input, files: [] };
  }

  // Text before the marker is the clean content
  const cleanText = input.slice(0, markerIndex).trimEnd();

  // Extract file paths after the marker
  const afterMarker = input.slice(markerIndex + NEXUS_FILES_MARKER.length).trim();
  const files = afterMarker
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return { cleanText, files };
}

/**
 * Append the `[[NEXUS_FILES]]` marker + file list to a message so the desktop
 * renderer can display files/images inline (see `MessageText.tsx` →
 * `parseFileMarker`), and the agent layer can turn them into `@` references.
 *
 * Mirrors the desktop SendBox behavior (`renderer/utils/messageFiles.ts#buildDisplayMessage`)
 * so messages arriving from Channel plugins (Telegram, Lark, DingTalk, WeCom,
 * WeChat) render the same way as user-uploaded files from the desktop UI.
 *
 * Path normalization rules (match desktop behavior):
 * - Absolute paths (Unix `/...` or Windows `C:\...`) are rewritten to
 *   `${workspacePath}/${fileName}` so the reference lives under the session
 *   workspace that the agent will resolve.
 * - Relative paths are prefixed with `${workspacePath}/`.
 * - When `workspacePath` is empty, paths are used as‑is.
 *
 * @param input         Plain message text (e.g. `[photo message]`).
 * @param files         Raw file paths (absolute or relative). Order preserved.
 * @param workspacePath Session workspace root used to normalize paths.
 */
export function appendNexusFilesMarker(input: string, files: string[], workspacePath: string): string {
  if (!files.length) return input;
  const displayPaths = files.map((filePath) => {
    if (!workspacePath) return filePath;
    const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath);
    if (isAbsolute) {
      const parts = filePath.split(/[\\/]/);
      const fileName = parts[parts.length - 1] || filePath;
      return `${workspacePath}/${fileName}`;
    }
    return `${workspacePath}/${filePath}`;
  });
  return `${input}\n\n${NEXUS_FILES_MARKER}\n${displayPaths.join('\n')}`;
}
