/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { pickLocalFilePaths } from '@renderer/utils/webFilePicker';

interface UseOpenFileSelectorOptions {
  onFilesSelected: (files: string[]) => void;
}

interface UseOpenFileSelectorResult {
  openFileSelector: () => void;
  onSlashBuiltinCommand: (name: string) => void;
}

/**
 * Shared open-file selector behavior for send boxes.
 * Unifies '+' button and '/open' builtin command handling.
 *
 * In Electron: opens the native file dialog.
 * In WebUI: opens a browser file input; picked files are staged behind pseudo
 * paths and uploaded by the webui transport when the message is sent.
 */
export function useOpenFileSelector(options: UseOpenFileSelectorOptions): UseOpenFileSelectorResult {
  const { onFilesSelected } = options;

  const openFileSelector = useCallback(() => {
    void pickLocalFilePaths().then((paths) => {
      if (paths && paths.length > 0) {
        onFilesSelected(paths);
      }
    });
  }, [onFilesSelected]);

  const onSlashBuiltinCommand = useCallback(
    (name: string) => {
      if (name === 'open') {
        openFileSelector();
      }
    },
    [openFileSelector]
  );

  return {
    openFileSelector,
    onSlashBuiltinCommand,
  };
}
