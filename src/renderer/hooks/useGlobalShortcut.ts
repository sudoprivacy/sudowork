/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useCallback, useRef } from 'react';

export interface ShortcutHandler {
  key: string;
  handler: (event: KeyboardEvent) => void;
  options?: {
    preventDefault?: boolean;
    stopPropagation?: boolean;
    // Allow in input elements
    allowInInput?: boolean;
    // Modifier keys
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  };
}

/**
 * Register a global keyboard shortcut
 *
 * @param shortcut - Shortcut configuration (key, handler, options)
 *
 * @example
 * // Simple usage
 * useGlobalShortcut({
 *   key: 'k',
 *   handler: () => openCommandPalette(),
 *   options: { ctrlKey: true, preventDefault: true }
 * });
 *
 * @example
 * // Multiple shortcuts
 * useGlobalShortcut({
 *   key: 'Escape',
 *   handler: () => closeAllModals()
 * });
 */
export function useGlobalShortcut(shortcut: ShortcutHandler): void {
  const { key, handler, options } = shortcut;
  const handlerRef = useRef(handler);

  // Update handler ref to always use latest version
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Check if the key matches
      if (event.key.toLowerCase() !== key.toLowerCase()) {
        return;
      }

      // Check modifier keys
      if (options?.ctrlKey && !event.ctrlKey && !event.metaKey) {
        return;
      }
      if (options?.shiftKey && !event.shiftKey) {
        return;
      }
      if (options?.altKey && !event.altKey) {
        return;
      }

      // Check if we should allow in input elements
      const target = event.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (!options?.allowInInput && isInput) {
        return;
      }

      // Execute handler
      if (options?.preventDefault !== false) {
        event.preventDefault();
      }
      if (options?.stopPropagation) {
        event.stopPropagation();
      }

      handlerRef.current(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [key, options?.ctrlKey, options?.shiftKey, options?.altKey, options?.preventDefault, options?.stopPropagation, options?.allowInInput]);
}

/**
 * Hook for Ctrl+K (or Cmd+K on Mac) global shortcut
 *
 * @param handler - Callback when shortcut is triggered
 * @param allowInInput - Whether to trigger when focus is in input/textarea
 */
export function useCtrlK(handler: () => void, allowInInput: boolean = false): void {
  useGlobalShortcut({
    key: 'k',
    handler: () => handler(),
    options: {
      ctrlKey: true,
      preventDefault: true,
      allowInInput,
    },
  });
}
