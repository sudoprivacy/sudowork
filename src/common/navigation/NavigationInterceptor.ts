/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IResponseMessage } from '@/common/ipcBridge';
import type { PreviewContentType } from '@/common/types/preview';
import { uuid } from '@/common/utils';

/**
 * ai-dev-browser navigation tool names that should auto-open URL in the
 * right-tab preview panel. The bundled Python stack exposes one tool per file
 * under `ai_dev_browser/tools/<name>.py`; here we list the ones that take a URL
 * and change what the user sees.
 *
 * Historical note: an earlier version of this file also matched chrome-devtools
 * MCP tool names (`navigate_page` / `new_page`) and prefixes like
 * `mcp__chrome-devtools__`. That coupling was removed when sudowork's browser
 * stack consolidated onto ai-dev-browser — see the removal commit's PR body
 * for the full audit + breaking-change rationale.
 */
export const NAVIGATION_TOOLS = ['page_goto', 'tab_new'] as const;
export type NavigationToolName = (typeof NAVIGATION_TOOLS)[number];

/** Alias kept for callers that already imported the ai-dev-browser-specific name. */
export const AI_DEV_BROWSER_NAV_TOOLS = NAVIGATION_TOOLS;
export type AiDevBrowserNavToolName = NavigationToolName;

/**
 * Shell-invocable entry points for ai-dev-browser. `browser` is the canonical
 * sudowork-installed dispatcher; `aidb` is its legacy alias (kept during the
 * rename transition — see SudoclawInstallService).
 */
export const AI_DEV_BROWSER_DISPATCHERS = ['browser', 'aidb'] as const;

/**
 * Preview open event data structure
 * 预览打开事件数据结构
 */
export interface PreviewOpenData {
  content: string;
  contentType: PreviewContentType;
  metadata?: {
    title?: string;
  };
}

/**
 * Navigation tool data that can come from different agent formats
 * 来自不同 agent 格式的导航工具数据
 */
export interface NavigationToolData {
  // Tool identification
  toolName?: string;
  server?: string;
  // URL sources (try in order)
  url?: string;
  arguments?: Record<string, unknown>;
  rawInput?: Record<string, unknown>;
  content?: Array<{ type?: string; content?: { type?: string; text?: string }; text?: string }>;
  title?: string;
}

/**
 * Interception result indicating what action was taken
 * 拦截结果，指示采取了什么行动
 */
export interface InterceptionResult {
  intercepted: boolean;
  url?: string;
  previewMessage?: IResponseMessage;
}

/**
 * Unified navigation interceptor — translates agent tool calls that drive a
 * browser into a `preview_open` signal so the right-tab webview opens the URL.
 *
 * Recognizes two shapes:
 *   1. Tool name is `page_goto` / `tab_new` (a direct ai-dev-browser tool
 *      invocation, e.g. exposed as a custom MCP tool).
 *   2. Tool name is a generic exec/shell wrapper (e.g. "Bash") and the actual
 *      ai-dev-browser invocation lives in `arguments.command` /
 *      `rawInput.command` as a shell string:
 *        browser page_goto --url <X>
 *        aidb tab_new --url=<X>
 *        python -m ai_dev_browser.tools.page_goto --url "<X>"
 */
export class NavigationInterceptor {
  /**
   * Normalize a tool name to its bare lowercase form. Strips trailing
   * parentheses that some agent transcripts append, e.g.
   * "page_goto (ai-dev-browser)" → "page_goto".
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
   * Check if a tool is an ai-dev-browser navigation invocation.
   *
   * Handles:
   *   "page_goto"                                            (direct tool name)
   *   { toolName: "tab_new" }                                (structured, direct)
   *   { toolName: "Bash", rawInput: { command: "browser page_goto --url X" } }
   *   { arguments: { command: "aidb tab_new --url X" } }
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

    // 2. Shell-command form (openclaw exec path).
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
   * Recognize an ai-dev-browser navigation invocation inside a shell command
   * string and pull out the destination URL.
   *
   * Matches the three shapes the LLM actually writes:
   *   browser page_goto --url https://example.com
   *   aidb tab_new --url=https://example.com
   *   python -m ai_dev_browser.tools.page_goto --url "https://example.com"
   *
   * Returns null if the command isn't an ai-dev-browser navigation tool or
   * doesn't carry an http(s) URL — opening the preview panel without a real
   * URL would be a no-op.
   */
  static parseAiDevBrowserNavCommand(command: string): { tool: AiDevBrowserNavToolName; url: string } | null {
    if (!command) return null;

    let tool: AiDevBrowserNavToolName | null = null;

    // Dispatcher form. The token must precede a tool name (avoids false
    // positives on prose like "open the browser first").
    const dispatcherRe = new RegExp(`(?:^|[;\\s&|"'\`])(?:${AI_DEV_BROWSER_DISPATCHERS.join('|')})(?:\\.cmd|\\.bat)?\\s+([a-z_][a-z0-9_]*)`, 'i');
    const dispatcherMatch = command.match(dispatcherRe);
    if (dispatcherMatch) {
      const candidate = dispatcherMatch[1].toLowerCase() as AiDevBrowserNavToolName;
      if ((NAVIGATION_TOOLS as readonly string[]).includes(candidate)) {
        tool = candidate;
      }
    }

    // Python module form.
    if (!tool) {
      const pyRe = /python(?:3|\.exe|3\.exe)?\b.*?\bai_dev_browser[./\\]tools[./\\]([a-z_][a-z0-9_]*)/i;
      const pyMatch = command.match(pyRe);
      if (pyMatch) {
        const candidate = pyMatch[1].toLowerCase() as AiDevBrowserNavToolName;
        if ((NAVIGATION_TOOLS as readonly string[]).includes(candidate)) {
          tool = candidate;
        }
      }
    }

    if (!tool) return null;

    // Find the URL. Tools take `--url <X>` or `--url=<X>`; the value may be
    // quoted with ' or " or unquoted.
    const urlRe = /--url(?:\s+|=)("([^"]+)"|'([^']+)'|(\S+))/;
    const urlMatch = command.match(urlRe);
    if (!urlMatch) return null;
    const rawUrl = (urlMatch[2] ?? urlMatch[3] ?? urlMatch[4] ?? '').trim();
    if (!rawUrl) return null;
    if (!/^https?:\/\//i.test(rawUrl)) return null;

    return { tool, url: rawUrl };
  }

  /**
   * Extract URL from navigation tool data
   * 从导航工具数据中提取 URL
   *
   * Tries multiple sources in order:
   * 1. Direct url field
   * 2. arguments.url / rawInput.url
   * 3. ai-dev-browser command parse (arguments.command / rawInput.command)
   * 4. URL pattern in content text
   * 5. URL pattern in title
   */
  static extractUrl(data: NavigationToolData): string | null {
    // 1. Direct url field
    if (data.url && typeof data.url === 'string') {
      return data.url;
    }

    // 2a. Check arguments (common MCP format)
    if (data.arguments) {
      const url = this.extractUrlFromObject(data.arguments);
      if (url) return url;
    }

    // 2b. Check rawInput (ACP format)
    if (data.rawInput) {
      const url = this.extractUrlFromObject(data.rawInput);
      if (url) return url;
    }

    // 3. ai-dev-browser shell-command form (openclaw exec path).
    const command = this.extractCommandString(data);
    if (command) {
      const parsed = this.parseAiDevBrowserNavCommand(command);
      if (parsed) return parsed.url;
    }

    // 4. Check content array for URL pattern
    if (data.content && Array.isArray(data.content)) {
      for (const item of data.content) {
        const text = item.text || item.content?.text || '';
        if (text) {
          const urlMatch = text.match(/https?:\/\/[^\s<>"]+/i);
          if (urlMatch) {
            return urlMatch[0];
          }
        }
      }
    }

    // 5. Check title for URL pattern
    if (data.title) {
      const urlMatch = data.title.match(/https?:\/\/[^\s<>"]+/i);
      if (urlMatch) {
        return urlMatch[0];
      }
    }

    return null;
  }

  /**
   * Extract URL from an object with common URL field names
   * 从具有常见 URL 字段名的对象中提取 URL
   */
  private static extractUrlFromObject(obj: Record<string, unknown>): string | null {
    const urlFields = ['url', 'URL', 'uri', 'URI', 'href', 'target'];

    for (const field of urlFields) {
      const value = obj[field];
      if (value && typeof value === 'string') {
        // Validate it looks like a URL
        if (value.startsWith('http://') || value.startsWith('https://')) {
          return value;
        }
      }
    }

    return null;
  }

  /**
   * Create a preview_open response message
   * 创建 preview_open 响应消息
   */
  static createPreviewMessage(url: string, conversationId: string, title?: string): IResponseMessage {
    return {
      type: 'preview_open',
      conversation_id: conversationId,
      msg_id: uuid(),
      data: {
        content: url,
        contentType: 'url' as PreviewContentType,
        metadata: {
          title: title || `Browser: ${url}`,
        },
      },
    };
  }

  /**
   * Attempt to intercept navigation tool and create preview message
   * 尝试拦截导航工具并创建预览消息
   *
   * @returns InterceptionResult with intercepted status and optional preview message
   */
  static intercept(data: NavigationToolData, conversationId: string): InterceptionResult {
    if (!this.isNavigationTool(data)) {
      return { intercepted: false };
    }

    const url = this.extractUrl(data);
    if (!url) {
      return { intercepted: false };
    }

    const previewMessage = this.createPreviewMessage(url, conversationId);

    return {
      intercepted: true,
      url,
      previewMessage,
    };
  }
}

// Re-export for convenience
export { NavigationInterceptor as default };
