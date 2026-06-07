/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NavigationInterceptor — recognize when an agent tool call is "navigate to a
 * URL" so the calling agent (AcpAgent / CodexToolHandlers) can mirror that URL
 * into the right-panel browser.
 *
 * Sudowork's browser stack is `ai-dev-browser` (bundled Python CLI, driven
 * from openclaw exec children) plus an in-app right-panel webview controlled
 * directly via Electron CDP. The interceptor sits between agent tool-call
 * events and the right-panel `rightPanelBrowser.open` IPC: when the LLM does
 * a navigation via ai-dev-browser, the right-panel webview opens the same URL
 * so the user sees what the agent is looking at.
 *
 * Historical note: this file previously matched chrome-devtools MCP tool
 * names (`navigate_page`/`new_page` from `mcp__chrome-devtools__*`) and
 * emitted into the legacy `preview.open` channel. Both were removed when
 * sudowork consolidated on ai-dev-browser and the new `BrowserPanel` shipped.
 */

/**
 * ai-dev-browser navigation tool names. The bundled Python stack exposes one
 * tool per file under `ai_dev_browser/tools/<name>.py`; this list is the
 * subset that takes a URL and changes what the user sees.
 */
export const NAVIGATION_TOOLS = ['page_goto', 'tab_new'] as const;
export type NavigationToolName = (typeof NAVIGATION_TOOLS)[number];

/** Legacy aliases preserved for any out-of-tree imports. */
export const AI_DEV_BROWSER_NAV_TOOLS = NAVIGATION_TOOLS;
export type AiDevBrowserNavToolName = NavigationToolName;

/**
 * Shell-invocable entry points for ai-dev-browser. `browser` is the canonical
 * sudowork-installed dispatcher (see SudoclawInstallService); `aidb` is its
 * legacy alias.
 */
export const AI_DEV_BROWSER_DISPATCHERS = ['browser', 'aidb'] as const;

/**
 * Navigation tool data that can come from different agent formats. Optional
 * `arguments` (MCP-shaped) and `rawInput` (ACP-shaped) carry the tool args.
 */
export interface NavigationToolData {
  toolName?: string;
  url?: string;
  arguments?: Record<string, unknown>;
  rawInput?: Record<string, unknown>;
  content?: Array<{ type?: string; content?: { type?: string; text?: string }; text?: string }>;
  title?: string;
}

export class NavigationInterceptor {
  /**
   * Normalize a tool name to its bare lowercase form. Strips a trailing
   * parenthesized hint (e.g. `"page_goto (ai-dev-browser)"`) and any leading
   * `mcp__<server>__` prefix.
   */
  static normalizeToolName(toolName: string): string {
    if (!toolName) return '';
    let normalized = toolName;
    if (normalized.includes('__')) {
      normalized = normalized.split('__').pop() || normalized;
    }
    normalized = normalized.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return normalized.toLowerCase();
  }

  /**
   * True if this tool call is an ai-dev-browser navigation.
   *
   * Recognizes:
   *   "page_goto"                                              (direct, string)
   *   { toolName: "tab_new" }                                  (direct, structured)
   *   { rawInput: { command: "browser page_goto --url X" } }   (shell-command form)
   *   { arguments: { command: "aidb tab_new --url=X" } }
   *   { rawInput: { command: "python -m ai_dev_browser.tools.page_goto --url X" } }
   */
  static isNavigationTool(data: NavigationToolData | string): boolean {
    if (typeof data === 'string') {
      const baseName = this.normalizeToolName(data);
      return (NAVIGATION_TOOLS as readonly string[]).includes(baseName);
    }

    // 1. Direct tool-name match.
    const baseName = this.normalizeToolName(data.toolName || '');
    if ((NAVIGATION_TOOLS as readonly string[]).includes(baseName)) {
      return true;
    }

    // 2. Shell-command form (openclaw exec / Bash / Shell tool).
    const command = this.extractCommandString(data);
    if (command && this.parseAiDevBrowserNavCommand(command)) {
      return true;
    }

    return false;
  }

  /**
   * Pull a shell command string from common argument/rawInput shapes.
   * Returns the first non-empty `command`-like field found.
   */
  private static extractCommandString(data: NavigationToolData): string | null {
    const fields = ['command', 'cmd', 'script'];
    const sources: Array<Record<string, unknown> | undefined> = [data.arguments, data.rawInput];
    for (const src of sources) {
      if (!src) continue;
      for (const f of fields) {
        const value = src[f];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value;
        }
      }
    }
    return null;
  }

  /**
   * Recognize an ai-dev-browser navigation invocation in a shell command and
   * pull out the destination URL.
   *
   * Returns null when the command isn't ai-dev-browser navigation or doesn't
   * carry an http(s) URL.
   */
  static parseAiDevBrowserNavCommand(command: string): { tool: NavigationToolName; url: string } | null {
    if (!command) return null;

    let tool: NavigationToolName | null = null;

    // Dispatcher form. The token must precede a tool name (avoids false
    // positives on prose like "open the browser first").
    const dispatcherRe = new RegExp(`(?:^|[;\\s&|"'\`])(?:${AI_DEV_BROWSER_DISPATCHERS.join('|')})(?:\\.cmd|\\.bat)?\\s+([a-z_][a-z0-9_]*)`, 'i');
    const dispatcherMatch = command.match(dispatcherRe);
    if (dispatcherMatch) {
      const candidate = dispatcherMatch[1].toLowerCase() as NavigationToolName;
      if ((NAVIGATION_TOOLS as readonly string[]).includes(candidate)) {
        tool = candidate;
      }
    }

    // Python module form.
    if (!tool) {
      const pyRe = /python(?:3|\.exe|3\.exe)?\b.*?\bai_dev_browser[./\\]tools[./\\]([a-z_][a-z0-9_]*)/i;
      const pyMatch = command.match(pyRe);
      if (pyMatch) {
        const candidate = pyMatch[1].toLowerCase() as NavigationToolName;
        if ((NAVIGATION_TOOLS as readonly string[]).includes(candidate)) {
          tool = candidate;
        }
      }
    }

    if (!tool) return null;

    // Find the URL. Tools take `--url <X>` or `--url=<X>`; the value may be
    // quoted (' or ") or unquoted.
    const urlRe = /--url(?:\s+|=)("([^"]+)"|'([^']+)'|(\S+))/;
    const urlMatch = command.match(urlRe);
    if (!urlMatch) return null;
    const rawUrl = (urlMatch[2] ?? urlMatch[3] ?? urlMatch[4] ?? '').trim();
    if (!rawUrl) return null;
    if (!/^https?:\/\//i.test(rawUrl)) return null;

    return { tool, url: rawUrl };
  }

  /**
   * Extract URL from navigation tool data. Tries direct url field, then
   * arguments/rawInput url-named fields, then ai-dev-browser command parse,
   * then URL pattern in content/title text.
   */
  static extractUrl(data: NavigationToolData): string | null {
    if (data.url && typeof data.url === 'string') {
      return data.url;
    }

    if (data.arguments) {
      const url = this.extractUrlFromObject(data.arguments);
      if (url) return url;
    }

    if (data.rawInput) {
      const url = this.extractUrlFromObject(data.rawInput);
      if (url) return url;
    }

    const command = this.extractCommandString(data);
    if (command) {
      const parsed = this.parseAiDevBrowserNavCommand(command);
      if (parsed) return parsed.url;
    }

    if (data.content && Array.isArray(data.content)) {
      for (const item of data.content) {
        const text = item.text || item.content?.text || '';
        if (text) {
          const urlMatch = text.match(/https?:\/\/[^\s<>"]+/i);
          if (urlMatch) return urlMatch[0];
        }
      }
    }

    if (data.title) {
      const urlMatch = data.title.match(/https?:\/\/[^\s<>"]+/i);
      if (urlMatch) return urlMatch[0];
    }

    return null;
  }

  private static extractUrlFromObject(obj: Record<string, unknown>): string | null {
    const urlFields = ['url', 'URL', 'uri', 'URI', 'href', 'target'];
    for (const field of urlFields) {
      const value = obj[field];
      if (value && typeof value === 'string') {
        if (value.startsWith('http://') || value.startsWith('https://')) {
          return value;
        }
      }
    }
    return null;
  }
}

export { NavigationInterceptor as default };
