/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { useCtrlK } from './useGlobalShortcut';
import { emitter, addEventListener } from '@/renderer/utils/emitter';

interface UseCommandPaletteReturn {
  /** Whether the palette is visible */
  visible: boolean;
  /** Open the palette */
  open: () => void;
  /** Close the palette */
  close: () => void;
  /** Toggle the palette visibility */
  toggle: () => void;
}

/**
 * Hook for managing CommandPalette state and Ctrl+K shortcut
 */
export function useCommandPalette(): UseCommandPaletteReturn {
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => {
    setVisible(true);
    // Emit event for analytics or other listeners
    emitter.emit('commandPalette.open');
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    emitter.emit('commandPalette.close');
  }, []);

  const toggle = useCallback(() => {
    setVisible((prev) => !prev);
  }, []);

  // Register Ctrl+K global shortcut
  useCtrlK(() => {
    open();
  }, false);

  // Listen for programmatic open requests (e.g., from menu bar)
  useEffect(() => {
    return addEventListener('commandPalette.open', open);
  }, [open]);

  return { visible, open, close, toggle };
}
