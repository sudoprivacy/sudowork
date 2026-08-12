import { describe, expect, it } from 'vitest';
import { NavigationInterceptor } from '@/common/navigation';

describe('NavigationInterceptor — chrome-devtools-mcp removed', () => {
  it('no longer matches chrome-devtools prefix tool names (breaking change)', () => {
    expect(NavigationInterceptor.isNavigationTool('mcp__chrome-devtools__navigate_page')).toBe(false);
    expect(NavigationInterceptor.isNavigationTool('navigate_page (chrome-devtools MCP Server)')).toBe(false);
  });

  it('no longer matches structured form with server=chrome-devtools', () => {
    const data = { toolName: 'navigate_page', server: 'chrome-devtools', arguments: { url: 'https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does not match the old chrome-devtools tool names directly', () => {
    expect(NavigationInterceptor.isNavigationTool('navigate_page')).toBe(false);
    expect(NavigationInterceptor.isNavigationTool('new_page')).toBe(false);
  });
});

describe('NavigationInterceptor — ai-dev-browser direct tool-name match', () => {
  it('matches the page_goto / tab_new tool names as bare strings', () => {
    expect(NavigationInterceptor.isNavigationTool('page_goto')).toBe(true);
    expect(NavigationInterceptor.isNavigationTool('tab_new')).toBe(true);
    expect(NavigationInterceptor.isNavigationTool('PAGE_GOTO')).toBe(true);
  });

  it('matches structured form when toolName is page_goto', () => {
    const data = { toolName: 'page_goto', arguments: { url: 'https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('strips trailing parenthesized server hint, e.g. "page_goto (ai-dev-browser)"', () => {
    expect(NavigationInterceptor.isNavigationTool('page_goto (ai-dev-browser)')).toBe(true);
  });
});

describe('NavigationInterceptor — ai-dev-browser command parsing', () => {
  it('matches `browser page_goto --url <X>`', () => {
    const data = { toolName: 'Bash', rawInput: { command: 'browser page_goto --url https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('matches legacy `aidb tab_new --url=<X>`', () => {
    const data = { toolName: 'exec', rawInput: { command: 'aidb tab_new --url=https://example.com/foo' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com/foo');
  });

  it('matches `python -m ai_dev_browser.tools.page_goto --url "<X>"`', () => {
    const data = {
      toolName: 'shell',
      rawInput: { command: 'python -m ai_dev_browser.tools.page_goto --url "https://example.com/path?q=1"' },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com/path?q=1');
  });

  it('matches `python3 -m ai_dev_browser.tools.tab_new --url <X>` (single-quoted)', () => {
    const data = {
      toolName: 'Bash',
      rawInput: { command: "python3 -m ai_dev_browser.tools.tab_new --url 'https://example.org'" },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.org');
  });

  it('reads command from arguments.command as well as rawInput.command', () => {
    const data = { toolName: 'Bash', arguments: { command: 'browser page_goto --url https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('does not match a non-navigation ai-dev-browser tool (page_screenshot)', () => {
    const data = { toolName: 'Bash', rawInput: { command: 'browser page_screenshot --path foo.png' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does not match prose containing the word "browser"', () => {
    const data = { toolName: 'Bash', rawInput: { command: 'echo "open a browser first then click foo"' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does not match dispatcher without a tool name (e.g. `browser --help`)', () => {
    const data = { toolName: 'Bash', rawInput: { command: 'browser --help' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('rejects non-http URLs (e.g. file://, javascript:)', () => {
    const data = { toolName: 'Bash', rawInput: { command: 'browser page_goto --url file:///etc/passwd' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('parseAiDevBrowserNavCommand returns tool name and url', () => {
    expect(NavigationInterceptor.parseAiDevBrowserNavCommand('browser page_goto --url https://example.com')).toEqual({
      tool: 'page_goto',
      url: 'https://example.com',
    });
    expect(NavigationInterceptor.parseAiDevBrowserNavCommand('aidb tab_new --url=https://example.com')).toEqual({
      tool: 'tab_new',
      url: 'https://example.com',
    });
    expect(NavigationInterceptor.parseAiDevBrowserNavCommand('browser page_screenshot --path foo.png')).toBeNull();
    expect(NavigationInterceptor.parseAiDevBrowserNavCommand('')).toBeNull();
  });

  it('handles compound commands (extracts the first navigation URL)', () => {
    const data = {
      toolName: 'Bash',
      rawInput: { command: 'cd /tmp && browser page_goto --url https://example.com && browser page_discover' },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });
});

describe('NavigationInterceptor — intercept() integration', () => {
  it('produces a preview_open message for ai-dev-browser shell-command navigation', () => {
    const result = NavigationInterceptor.intercept({ toolName: 'Bash', rawInput: { command: 'browser page_goto --url https://example.com' } }, 'conv-abc');
    expect(result.intercepted).toBe(true);
    expect(result.url).toBe('https://example.com');
    expect(result.previewMessage?.type).toBe('preview_open');
    expect(result.previewMessage?.conversation_id).toBe('conv-abc');
    expect(result.previewMessage?.data).toMatchObject({ content: 'https://example.com', contentType: 'url' });
  });

  it('produces a preview_open message for a direct page_goto tool call', () => {
    const result = NavigationInterceptor.intercept({ toolName: 'page_goto', arguments: { url: 'https://foo.test' } }, 'conv-xyz');
    expect(result.intercepted).toBe(true);
    expect(result.url).toBe('https://foo.test');
  });

  it('does not intercept chrome-devtools navigation (removed)', () => {
    const result = NavigationInterceptor.intercept({ toolName: 'navigate_page', server: 'chrome-devtools', arguments: { url: 'https://example.com' } }, 'conv-abc');
    expect(result.intercepted).toBe(false);
  });

  it('does not intercept non-navigation calls', () => {
    const result = NavigationInterceptor.intercept({ toolName: 'Bash', rawInput: { command: 'ls -la' } }, 'conv-abc');
    expect(result.intercepted).toBe(false);
  });
});

describe('NavigationInterceptor — browser-panel MCP tools', () => {
  it('matches direct browser-panel MCP tool names as bare strings', () => {
    expect(NavigationInterceptor.isNavigationTool('panel_open')).toBe(true);
    expect(NavigationInterceptor.isNavigationTool('panel_navigate')).toBe(true);
    expect(NavigationInterceptor.isNavigationTool('PANEL_OPEN')).toBe(true);
  });

  it('matches an mcp-prefixed direct tool name', () => {
    expect(NavigationInterceptor.isNavigationTool('mcp__browser-panel__panel_open')).toBe(true);
  });

  it('does not match non-navigation browser-panel MCP tools', () => {
    expect(NavigationInterceptor.isNavigationTool('browser_take_screenshot')).toBe(false);
    expect(NavigationInterceptor.isNavigationTool('browser_evaluate')).toBe(false);
  });

  it('extracts URL from a direct panel_open call', () => {
    const data = { toolName: 'panel_open', arguments: { url: 'https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });
});

describe('NavigationInterceptor — MCPTool wrapper form (gpt-5.5 / sudorouter)', () => {
  it('matches MCPTool whose rawInput.qualifiedName ends with panel_open (dash-joined)', () => {
    const data = {
      toolName: 'MCPTool',
      rawInput: {
        qualifiedName: 'browser-panel-panel_open',
        arguments: { url: 'https://www.baidu.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://www.baidu.com');
  });

  it('matches dot-joined qualifiedName (browser-panel.panel_navigate)', () => {
    const data = {
      toolName: 'MCPTool',
      rawInput: {
        qualifiedName: 'browser-panel.panel_navigate',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('matches double-underscore-joined qualifiedName (mcp__browser-panel__panel_open)', () => {
    const data = {
      toolName: 'MCPTool',
      rawInput: {
        qualifiedName: 'mcp__browser-panel__panel_open',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('reads qualifiedName from data.arguments when rawInput is absent', () => {
    const data = {
      toolName: 'MCPTool',
      arguments: {
        qualifiedName: 'browser-panel-panel_open',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('does NOT match MCPTool when qualifiedName ends with a non-nav browser-panel tool', () => {
    const data = {
      toolName: 'MCPTool',
      rawInput: {
        qualifiedName: 'browser-panel-browser_take_screenshot',
        arguments: { path: 'foo.png' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does NOT match MCPTool without a qualifiedName', () => {
    const data = {
      toolName: 'MCPTool',
      rawInput: { arguments: { url: 'https://example.com' } },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does NOT match a non-wrapper tool name even with a matching qualifiedName', () => {
    const data = {
      toolName: 'Bash',
      rawInput: {
        qualifiedName: 'browser-panel-panel_open',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('intercept() returns intercepted=true with the wrapped URL', () => {
    const result = NavigationInterceptor.intercept(
      {
        toolName: 'MCPTool',
        rawInput: {
          qualifiedName: 'browser-panel-panel_open',
          arguments: { url: 'https://example.com' },
        },
      },
      'conv-mcp'
    );
    expect(result.intercepted).toBe(true);
    expect(result.url).toBe('https://example.com');
    expect(result.previewMessage?.data).toMatchObject({ content: 'https://example.com', contentType: 'url' });
  });
});

describe('NavigationInterceptor — MCP wrapper, server+tool form (gpt-5.5 alternate shape)', () => {
  it('matches toolName="MCP" with rawInput.server+tool=panel_open + nested arguments.url', () => {
    const data = {
      toolName: 'MCP',
      rawInput: {
        server: 'browser-panel',
        tool: 'panel_open',
        arguments: { url: 'https://www.baidu.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://www.baidu.com');
  });

  it('matches toolName="MCP" with rawInput.server+tool=panel_navigate', () => {
    const data = {
      toolName: 'MCP',
      rawInput: {
        server: 'browser-panel',
        tool: 'panel_navigate',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('reads server/tool from data.arguments when rawInput is absent', () => {
    const data = {
      toolName: 'MCP',
      arguments: {
        server: 'browser-panel',
        tool: 'panel_open',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('intercept() end-to-end for the server/tool form', () => {
    const result = NavigationInterceptor.intercept(
      {
        toolName: 'MCP',
        rawInput: {
          server: 'browser-panel',
          tool: 'panel_open',
          arguments: { url: 'https://example.com' },
        },
      },
      'conv-mcp-st'
    );
    expect(result.intercepted).toBe(true);
    expect(result.url).toBe('https://example.com');
    expect(result.previewMessage?.data).toMatchObject({ content: 'https://example.com', contentType: 'url' });
  });

  it('does NOT match when tool field names a non-nav browser-panel tool', () => {
    const data = {
      toolName: 'MCP',
      rawInput: {
        server: 'browser-panel',
        tool: 'browser_take_screenshot',
        arguments: { path: 'foo.png' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does NOT match when server is not browser-panel (scoping check)', () => {
    const data = {
      toolName: 'MCP',
      rawInput: {
        server: 'some-other-mcp',
        tool: 'panel_open',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does NOT match when the tool field is missing', () => {
    const data = {
      toolName: 'MCP',
      rawInput: {
        server: 'browser-panel',
        arguments: { url: 'https://example.com' },
      },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });
});
