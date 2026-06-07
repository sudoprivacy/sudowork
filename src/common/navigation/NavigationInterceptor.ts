/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IResponseMessage } from '@/common/ipcBridge';
import type { PreviewContentType } from '@/common/types/preview';
import { uuid } from '@/common/utils';

/**
 * Navigation tools that should be intercepted for preview
 * 需要拦截到预览面板的导航工具
 */
export const NAVIGATION_TOOLS = ['navigate_page', 'new_page'] as const;
export type NavigationToolName = (typeof NAVIGATION_TOOLS)[number];

/**
 * Chrome DevTools MCP server identifiers
 * Chrome DevTools MCP 服务器标识符
 */
export const CHROME_DEVTOOLS_IDENTIFIERS = ['chrome-devtools', 'chrome_devtools', 'chromedevtools'] as const;

/**
 * Common MCP prefixes to strip when normalizing tool names
 * 需要去除的常见 MCP 前缀
 */
export const MCP_PREFIXES = ['mcp__chrome-devtools__', 'chrome-devtools__', 'chrome-devtools.'] as const;

/**
 * ai-dev-browser navigation tool names that should auto-open URL in the preview panel.
 * The bundled Python stack exposes one tool per file under
 * `ai_dev_browser/tools/<name>.py`; here we list the ones that take a URL and
 * change what the user sees.
 */
export const AI_DEV_BROWSER_NAV_TOOLS = ['page_goto', 'tab_new'] as const;
export type AiDevBrowserNavToolName = (typeof AI_DEV_BROWSER_NAV_TOOLS)[number];

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
 * Unified Navigation Interceptor for all agents
 * 所有 agent 的统一导航拦截器
 */
export class NavigationInterceptor {
  /**
   * Normalize tool name by stripping MCP prefixes and suffixes
   * 规范化工具名称，去除 MCP 前缀和后缀
   */
  static normalizeToolName(toolName: string): string {
    if (!toolName) return '';

    let normalized = toolName;

    // Remove known prefixes
    for (const prefix of MCP_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length);
        break;
      }
    }

    // Handle double underscore format (e.g., "mcp__server__tool")
    if (normalized.includes('__')) {
      normalized = normalized.split('__').pop() || normalized;
    }

    // Remove trailing parentheses like "(chrome-devtools MCP Server)"
    normalized = normalized.replace(/\s*\([^)]*\)\s*$/, '').trim();

    return normalized.toLowerCase();
  }

  /**
   * Check if a string contains chrome-devtools identifier
   * 检查字符串是否包含 chrome-devtools 标识符
   */
  static isChromeDevToolsIdentifier(str: string): boolean {
    if (!str) return false;
    const lower = str.toLowerCase();
    return CHROME_DEVTOOLS_IDENTIFIERS.some((id) => lower.includes(id));
  }

  /**
   * Check if a tool is a chrome-devtools navigation tool
   * 检查工具是否为 chrome-devtools 导航工具
   *
   * Handles various formats:
   * - "navigate_page"
   * - "mcp__chrome-devtools__navigate_page"
   * - "navigate_page (chrome-devtools MCP Server)"
   * - { server: "chrome-devtools", tool: "navigate_page" }
   * - { rawInput: { command: "browser page_goto --url …" } }  (ai-dev-browser via exec)
   */
  static isNavigationTool(data: NavigationToolData | string): boolean {
    if (typeof data === 'string') {
      // Simple string check — chrome-devtools path only. Shell commands
      // don't survive as a string here, so ai-dev-browser detection needs
      // the structured form.
      const toolName = data;
      const isChromeDevTools = this.isChromeDevToolsIdentifier(toolName);
      const baseName = this.normalizeToolName(toolName);
      const isNavTool = NAVIGATION_TOOLS.includes(baseName as NavigationToolName);
      return isChromeDevTools && isNavTool;
    }

    // Object-based check
    const { toolName = '', server = '' } = data;
    const fullName = toolName || '';

    // Check server field
    const serverIsChromeDevTools = this.isChromeDevToolsIdentifier(server);
    // Check tool name for chrome-devtools reference
    const toolNameIsChromeDevTools = this.isChromeDevToolsIdentifier(fullName);

    const isChromeDevTools = serverIsChromeDevTools || toolNameIsChromeDevTools;

    // Normalize and check if it's a navigation tool
    const baseName = this.normalizeToolName(fullName);
    const isNavTool = NAVIGATION_TOOLS.includes(baseName as NavigationToolName);

    if (isChromeDevTools && isNavTool) return true;

    // ai-dev-browser path: openclaw's exec tool ships the actual invocation
    // as a shell command string inside `arguments.command` / `rawInput.command`.
    // The outer `toolName` is something generic like "exec"/"shell"/"Bash", so
    // we must look at the command text to recognize navigation.
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
   * doesn't carry a URL. Caller must treat absence of URL as "don't intercept"
   * — opening the preview panel without a URL would be a no-op.
   */
  static parseAiDevBrowserNavCommand(command: string): { tool: AiDevBrowserNavToolName; url: string } | null {
    if (!command) return null;

    // Find which navigation tool is being invoked. Three shapes:
    //   <dispatcher> <tool> …       e.g. "browser page_goto …"
    //   python -m ai_dev_browser.tools.<tool> …
    //   python -m ai_dev_browser.tools.<tool>.<verb> … (defensive — current
    //   layout is flat, but the regex is tolerant for any future nesting)
    let tool: AiDevBrowserNavToolName | null = null;

    // Dispatcher form. The token must precede a tool name (avoids false
    // positives on prose like "open the browser first").
    const dispatcherRe = new RegExp(`(?:^|[;\\s&|"'\`])(?:${AI_DEV_BROWSER_DISPATCHERS.join('|')})(?:\\.cmd|\\.bat)?\\s+([a-z_][a-z0-9_]*)`, 'i');
    const dispatcherMatch = command.match(dispatcherRe);
    if (dispatcherMatch) {
      const candidate = dispatcherMatch[1].toLowerCase() as AiDevBrowserNavToolName;
      if ((AI_DEV_BROWSER_NAV_TOOLS as readonly string[]).includes(candidate)) {
        tool = candidate;
      }
    }

    // Python module form.
    if (!tool) {
      const pyRe = /python(?:3|\.exe|3\.exe)?\b.*?\bai_dev_browser[./\\]tools[./\\]([a-z_][a-z0-9_]*)/i;
      const pyMatch = command.match(pyRe);
      if (pyMatch) {
        const candidate = pyMatch[1].toLowerCase() as AiDevBrowserNavToolName;
        if ((AI_DEV_BROWSER_NAV_TOOLS as readonly string[]).includes(candidate)) {
          tool = candidate;
        }
      }
    }

    if (!tool) return null;

    // Now find the URL. Tools take `--url <X>` or `--url=<X>`; the value may be
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

    // 2. Check arguments (common MCP format)
    if (data.arguments) {
      const url = this.extractUrlFromObject(data.arguments);
      if (url) return url;
    }

    // 3. Check rawInput (ACP format)
    if (data.rawInput) {
      const url = this.extractUrlFromObject(data.rawInput);
      if (url) return url;
    }

    // 3.5. ai-dev-browser shell-command form (openclaw exec path).
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
