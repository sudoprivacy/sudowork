import { describe, expect, it } from 'vitest'
import zhCN from '@sudowork/renderer/i18n/locales/zh-CN/park.json'
import enUS from '@sudowork/renderer/i18n/locales/en-US/park.json'
import jaJP from '@sudowork/renderer/i18n/locales/ja-JP/park.json'
import zhTW from '@sudowork/renderer/i18n/locales/zh-TW/park.json'
import koKR from '@sudowork/renderer/i18n/locales/ko-KR/park.json'
import trTR from '@sudowork/renderer/i18n/locales/tr-TR/park.json'
import enUSModules from '@sudowork/renderer/i18n/locales/en-US/index'
import jaJPModules from '@sudowork/renderer/i18n/locales/ja-JP/index'
import koKRModules from '@sudowork/renderer/i18n/locales/ko-KR/index'
import trTRModules from '@sudowork/renderer/i18n/locales/tr-TR/index'
import zhCNModules from '@sudowork/renderer/i18n/locales/zh-CN/index'
import zhTWModules from '@sudowork/renderer/i18n/locales/zh-TW/index'

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

function valueAt(obj: Record<string, unknown>, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
      obj,
    )
}

describe('park i18n key 完整性', () => {
  const reference = leafKeys(zhCN)

  it('zh-CN 参照集非空', () => {
    expect(reference.length).toBeGreaterThan(100)
  })

  it('六种语言均将 park 文案注册到实际 i18n 模块', () => {
    for (const modules of [
      enUSModules,
      jaJPModules,
      koKRModules,
      trTRModules,
      zhCNModules,
      zhTWModules,
    ]) {
      expect(leafKeys(valueAt(modules, 'park') as Record<string, unknown>)).toEqual(reference)
    }
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

  it('非中文语言不能批量沿用简体中文文案', () => {
    for (const locale of [jaJP, koKR, trTR]) {
      const identical = reference.filter((key) => valueAt(locale, key) === valueAt(zhCN, key))
      expect(identical.length).toBeLessThan(reference.length / 10)
    }
  })

  it('园区、线索和审计术语符合各语言的业务含义', () => {
    expect(jaJP.nav.overview).toContain('産業団地')
    expect(jaJP.nav.leads).toContain('見込み企業')
    expect(jaJP.admin.audit.actor).toBe('操作担当者')

    expect(koKR.nav.overview).toContain('산업단지')
    expect(koKR.consultations.hasLead).toContain('리드')
    expect(koKR.admin.audit.actor).toBe('작업자')

    expect(trTR.nav.overview).toContain('Sanayi Parkı')
    expect(trTR.nav.leadDetail).toContain('Potansiyel Müşteri')
    expect(trTR.common.score).toBe('Puan')
    expect(trTR.admin.audit.actor).toBe('İşlemi Yapan')
  })
})
