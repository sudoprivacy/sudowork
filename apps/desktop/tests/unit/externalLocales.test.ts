import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

const localesRoot = path.resolve('../../packages/renderer/src/i18n/locales');
const readAgent = (locale: string): Record<string, string> => JSON.parse(readFileSync(path.join(localesRoot, locale, 'agent.json'), 'utf8'));
const english = readAgent('en-US');
const keys = Object.keys(english).filter((key) => key.startsWith('external.'));
const placeholders = (value: string) => [...value.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort();

describe('external agent locale resources', () => {
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'tr-TR']) {
    it(`resolves every external message in ${locale} without language fallback`, async () => {
      const agent = readAgent(locale);
      expect(
        Object.keys(agent)
          .filter((key) => key.startsWith('external.'))
          .sort()
      ).toEqual([...keys].sort());
      const i18n = createInstance();
      await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { translation: { agent } } }, interpolation: { escapeValue: false } });
      for (const key of keys) {
        expect(agent[key].trim()).not.toBe('');
        expect(placeholders(agent[key])).toEqual(placeholders(english[key]));
        const options = Object.fromEntries(placeholders(agent[key]).map((name) => [name, `value-${name}`]));
        const rendered = i18n.t(`agent.${key}`, options);
        expect(rendered).not.toBe(`agent.${key}`);
        expect(rendered).not.toContain('{{');
        for (const value of Object.values(options)) expect(rendered).toContain(value);
      }
    });
  }
});
