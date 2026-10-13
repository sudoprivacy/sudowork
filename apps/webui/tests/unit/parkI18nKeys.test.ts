import { describe, expect, it } from 'vitest'
import zhCN from '@sudowork/renderer/i18n/locales/zh-CN/park.json'
import enUS from '@sudowork/renderer/i18n/locales/en-US/park.json'
import jaJP from '@sudowork/renderer/i18n/locales/ja-JP/park.json'
import zhTW from '@sudowork/renderer/i18n/locales/zh-TW/park.json'
import koKR from '@sudowork/renderer/i18n/locales/ko-KR/park.json'
import trTR from '@sudowork/renderer/i18n/locales/tr-TR/park.json'

/** i18n key 完整性（计划 5.5 unit）：所有语言的 park 域 key 集合与 zh-CN 完全一致。 */

function leafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...leafKeys(value as Record<string, unknown>, full))
    } else {
      keys.push(full)
    }
  }
  return keys.sort()
}

describe('park i18n key 完整性', () => {
  const reference = leafKeys(zhCN)

  it('zh-CN 参照集非空', () => {
    expect(reference.length).toBeGreaterThan(100)
  })

  for (const [name, locale] of [
    ['en-US', enUS],
    ['ja-JP', jaJP],
    ['zh-TW', zhTW],
    ['ko-KR', koKR],
    ['tr-TR', trTR],
  ] as const) {
    it(`${name} 的 key 集合与 zh-CN 一致`, () => {
      expect(leafKeys(locale)).toEqual(reference)
    })
  }
})
