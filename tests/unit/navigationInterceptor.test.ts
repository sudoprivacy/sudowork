import { describe, expect, it } from 'vitest';
import { NavigationInterceptor } from '@/common/navigation';

describe('NavigationInterceptor — chrome-devtools path (unchanged)', () => {
  it('matches "mcp__chrome-devtools__navigate_page"', () => {
    expect(NavigationInterceptor.isNavigationTool('mcp__chrome-devtools__navigate_page')).toBe(true);
  });

  it('matches structured form with server=chrome-devtools', () => {
    const data = { toolName: 'navigate_page', server: 'chrome-devtools', arguments: { url: 'https://example.com' } };
    expect(NavigationInterceptor.isNavigationTool(data)).toBe(true);
    expect(NavigationInterceptor.extractUrl(data)).toBe('https://example.com');
  });

  it('does not match plain page_goto string (no chrome-devtools marker, no command context)', () => {
    expect(NavigationInterceptor.isNavigationTool('page_goto')).toBe(false);
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

  it('matches `python3 -m ai_dev_browser.tools.tab_new --url <X>`', () => {
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

  it('does not match a non-navigation ai-dev-browser tool', () => {
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
  it('produces a preview_open message for ai-dev-browser navigation', () => {
    const result = NavigationInterceptor.intercept(
      { toolName: 'Bash', rawInput: { command: 'browser page_goto --url https://example.com' } },
      'conv-abc'
    );
    expect(result.intercepted).toBe(true);
    expect(result.url).toBe('https://example.com');
    expect(result.previewMessage?.type).toBe('preview_open');
    expect(result.previewMessage?.conversation_id).toBe('conv-abc');
    expect(result.previewMessage?.data).toMatchObject({ content: 'https://example.com', contentType: 'url' });
  });

  it('produces a preview_open message for chrome-devtools navigation', () => {
    const result = NavigationInterceptor.intercept(
      { toolName: 'navigate_page', server: 'chrome-devtools', arguments: { url: 'https://foo.test' } },
      'conv-xyz'
    );
    expect(result.intercepted).toBe(true);
    expect(result.url).toBe('https://foo.test');
  });

  it('does not intercept non-navigation calls', () => {
    const result = NavigationInterceptor.intercept(
      { toolName: 'Bash', rawInput: { command: 'ls -la' } },
      'conv-abc'
    );
    expect(result.intercepted).toBe(false);
  });
});
