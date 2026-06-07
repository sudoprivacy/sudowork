import { describe, expect, it } from 'vitest';
import { NavigationInterceptor } from '@/common/navigation';

describe('NavigationInterceptor — chrome-devtools removed (breaking change)', () => {
  it('no longer matches `mcp__chrome-devtools__navigate_page`', () => {
    expect(NavigationInterceptor.isNavigationTool('mcp__chrome-devtools__navigate_page')).toBe(false);
    expect(NavigationInterceptor.isNavigationTool('navigate_page (chrome-devtools MCP Server)')).toBe(false);
  });

  it('no longer matches structured form with server=chrome-devtools', () => {
    const data = { toolName: 'navigate_page', arguments: { url: 'https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(false);
  });

  it('does not match old chrome-devtools tool names', () => {
    expect(NavigationInterceptor.isNavigationTool('navigate_page')).toBe(false);
    expect(NavigationInterceptor.isNavigationTool('new_page')).toBe(false);
  });
});

describe('NavigationInterceptor — ai-dev-browser direct tool-name match', () => {
  it('matches page_goto / tab_new bare strings (case-insensitive)', () => {
    expect(NavigationInterceptor.isNavigationTool('page_goto')).toBe(true);
    expect(NavigationInterceptor.isNavigationTool('tab_new')).toBe(true);
    expect(NavigationInterceptor.isNavigationTool('PAGE_GOTO')).toBe(true);
  });

  it('matches structured form when toolName is page_goto', () => {
    const data = { toolName: 'page_goto', arguments: { url: 'https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('strips trailing parenthesized server hint', () => {
    expect(NavigationInterceptor.isNavigationTool('page_goto (ai-dev-browser)')).toBe(true);
  });
});

describe('NavigationInterceptor — ai-dev-browser shell-command parsing', () => {
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

  it('rejects non-http URLs (file://, javascript:)', () => {
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

  it('handles compound commands (extracts first navigation URL)', () => {
    const data = {
      toolName: 'Bash',
      rawInput: { command: 'cd /tmp && browser page_goto --url https://example.com && browser page_discover' },
    };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });
});

describe('NavigationInterceptor — extractUrl URL-field fallback', () => {
  it('reads url from arguments.url directly', () => {
    expect(NavigationInterceptor.extractUrl({ arguments: { url: 'https://example.com' } })).toBe('https://example.com');
  });

  it('reads url from rawInput with alternative field names (uri, href, target)', () => {
    expect(NavigationInterceptor.extractUrl({ rawInput: { uri: 'https://example.com' } })).toBe('https://example.com');
    expect(NavigationInterceptor.extractUrl({ rawInput: { href: 'https://example.com' } })).toBe('https://example.com');
    expect(NavigationInterceptor.extractUrl({ rawInput: { target: 'https://example.com' } })).toBe('https://example.com');
  });

  it('falls back to URL pattern in title', () => {
    expect(NavigationInterceptor.extractUrl({ title: 'Browse https://example.com please' })).toBe('https://example.com');
  });
});
