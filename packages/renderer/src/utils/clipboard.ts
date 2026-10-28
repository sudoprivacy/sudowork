/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Copy text to clipboard with fallback for non-secure contexts (e.g. WebUI over HTTP).
 * Uses navigator.clipboard when available, otherwise falls back to document.execCommand('copy').
 */
export const copyText = async (text: string): Promise<void> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('copyText requires a browser environment');
  }

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for non-secure contexts (WebUI over HTTP)
  const previousActiveElement = document.activeElement as HTMLElement | null;
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const success = document.execCommand('copy');
    if (!success) {
      throw new Error('execCommand copy returned false');
    }
  } finally {
    document.body.removeChild(textArea);
    if (previousActiveElement && typeof previousActiveElement.focus === 'function' && document.contains(previousActiveElement)) {
      previousActiveElement.focus();
    }
  }
};

/** Begin the clipboard write during the user gesture, before remote text arrives.
 * WebKit requires activation at write(), so defer the ClipboardItem data itself.
 * https://webkit.org/blog/10855/async-clipboard-api/
 */
export function copyTextFromPromise(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write && window.isSecureContext) {
    return navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })) })]);
  }
  return text.then(copyText);
}
