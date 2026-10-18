import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'tr-TR'];

describe('terminal messages in the shared renderer', () => {
  it.each(locales)('resolves terminal availability and failure messages in %s', async (locale) => {
    const conversation = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../packages/renderer/src/i18n/locales', locale, 'conversation.json'), 'utf-8'));
    const i18n = createInstance();
    await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { translation: { conversation } } } });

    for (const name of ['remoteUnavailable', 'createFailed']) {
      const key = `conversation.rightPanel.terminal.${name}`;
      expect(i18n.exists(key)).toBe(true);
      expect(i18n.t(key)).toBe(conversation.rightPanel.terminal[name]);
      expect(i18n.t(key)).not.toBe(key);
    }
  });
});
