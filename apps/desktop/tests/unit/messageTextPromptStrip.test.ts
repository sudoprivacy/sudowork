import { describe, expect, it } from 'vitest';
import { stripInjectedUserPrompt } from '@/renderer/messages/MessagetText';

describe('stripInjectedUserPrompt', () => {
  it('removes injected assistant rules and cron skill blocks from user prompts', () => {
    const input = `[Scheduled Task Skill — you MUST follow this to manage scheduled tasks; output the [CRON_*] commands directly in your reply]

[Assistant Rules - You MUST follow these instructions]

[User Request]
生成一个 go 语言的 knn 算法`;

    expect(stripInjectedUserPrompt(input)).toBe('生成一个 go 语言的 knn 算法');
  });

  it('returns the original content when no user request marker is present', () => {
    expect(stripInjectedUserPrompt('hello world')).toBe('hello world');
  });
});
