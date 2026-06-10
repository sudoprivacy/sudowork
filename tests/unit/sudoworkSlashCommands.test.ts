import { describe, expect, it } from 'vitest';
import { getSudoworkAcpSlashCommands, protectUnsupportedAcpSlashPrompt } from '@/common/slash/sudoworkCommands';

describe('Sudowork ACP slash commands', () => {
  it('exposes the Sudowork-owned ACP commands', () => {
    expect(getSudoworkAcpSlashCommands().map((command) => command.name)).toEqual(['image', 'browser']);
  });

  it('keeps supported slash commands unchanged', () => {
    expect(protectUnsupportedAcpSlashPrompt('/image generate a cat')).toBe('/image generate a cat');
    expect(protectUnsupportedAcpSlashPrompt('/browser open https://example.com')).toBe('/browser open https://example.com');
    expect(protectUnsupportedAcpSlashPrompt('/model')).toBe('/model');
    expect(protectUnsupportedAcpSlashPrompt('/status')).toBe('/status');
    expect(protectUnsupportedAcpSlashPrompt('/custom-command', ['custom-command'])).toBe('/custom-command');
  });

  it('protects unsupported leading slash prompts from ACP command parsing', () => {
    expect(protectUnsupportedAcpSlashPrompt('/nhao 执行')).toBe('\u200C/nhao 执行');
    expect(protectUnsupportedAcpSlashPrompt('  /nhao')).toBe('  \u200C/nhao');
    expect(protectUnsupportedAcpSlashPrompt('/image.extra')).toBe('\u200C/image.extra');
  });

  it('leaves ordinary prompts unchanged', () => {
    expect(protectUnsupportedAcpSlashPrompt('please run /status')).toBe('please run /status');
    expect(protectUnsupportedAcpSlashPrompt('hello')).toBe('hello');
  });
});
