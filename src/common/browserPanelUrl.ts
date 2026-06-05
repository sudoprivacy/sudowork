/**
 * URL utilities for the right-panel browser.
 *
 * Shared by:
 *  - the renderer-side BrowserPanel address bar (normalize what the user types)
 *  - the main-process CDP service (validate `navigate` tool input from MCP/AI)
 */

/**
 * Schemes the right-panel webview is allowed to load directly without rewriting.
 * Anything not matching gets a `https://` prefix.
 */
export const ALLOWED_BROWSER_URL_SCHEME = /^(https?|file|about|chrome|chrome-extension|data):/i;

/**
 * Normalize a URL-bar input string for loading in the right-panel webview.
 * - Trims whitespace.
 * - Passes through any string with a recognized scheme (http/https/file/about/chrome/chrome-extension/data).
 * - Prepends `https://` to anything else (so "example.com" → "https://example.com").
 * - Returns the original (trimmed) string for empty input — caller should treat empty as "do nothing".
 */
export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (ALLOWED_BROWSER_URL_SCHEME.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
