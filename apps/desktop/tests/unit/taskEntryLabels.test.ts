import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const LOCALES = ['en-US', 'ja-JP', 'ko-KR', 'tr-TR', 'zh-CN', 'zh-TW'] as const;

describe('task entry labels', () => {
  test.each(LOCALES)('%s exposes task and execution wording', (locale) => {
    const root = resolve(import.meta.dirname, '../../../../packages/renderer/src/i18n/locales', locale);
    const common = JSON.parse(readFileSync(resolve(root, 'common.json'), 'utf8')) as {
      ariaLabel: { newConversation: string };
    };
    const conversation = JSON.parse(readFileSync(resolve(root, 'conversation.json'), 'utf8')) as {
      welcome: {
        newConversation: string;
        execution: { cloud: string; local: string };
      };
      history: { actionNewConversation: string };
    };

    expect(common.ariaLabel.newConversation).toBeTruthy();
    expect(conversation.welcome.newConversation).toBeTruthy();
    expect(conversation.welcome.execution.cloud).toBeTruthy();
    expect(conversation.welcome.execution.local).toBeTruthy();
    expect(conversation.history.actionNewConversation).toBeTruthy();
  });
});
