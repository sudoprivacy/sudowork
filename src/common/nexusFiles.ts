/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { NEXUS_FILES_MARKER } from './constants';

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
