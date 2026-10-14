import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import zhCN from '@sudowork/renderer/i18n/locales/zh-CN/park.json'

/**
 * 源码 t('park.xxx') 字面量 key 使用完整性（计划 5.5 unit "i18n key 完整性"的落地）：
 * parkI18nKeys.test 只做语言间 key 集合对比，检测不到"代码使用了未定义 key"
 * （曾发生：park.enterprises.enterpriseDetail 实际定义在 park.nav 下）。
 * 本测试扫描 renderer park 域页面与 login 页（park 注册入口所在）的 t() 字面量，
 * 断言每个 key 都在 zh-CN park.json 中定义。动态 key（模板字符串）不在扫描范围。
 */

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
  return keys
}

function collectTsxFiles(entry: string): string[] {
  const stat = statSync(entry)
  if (stat.isFile()) return entry.endsWith('.tsx') ? [entry] : []
  return readdirSync(entry).flatMap((name) => collectTsxFiles(path.join(entry, name)))
}

const rendererSrc = path.resolve(__dirname, '../../../../packages/renderer/src')
const scanRoots = [
  path.join(rendererSrc, 'pages/park'),
  path.join(rendererSrc, 'pages/login/index.tsx'),
]
const files = scanRoots.flatMap((root) => collectTsxFiles(root))
const used = new Map<string, string[]>()
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/\bt\(\s*'(park\.[a-zA-Z0-9_.]+)'/g)) {
    const key = match[1] as string
    used.set(key, [...(used.get(key) ?? []), path.relative(rendererSrc, file)])
  }
}

describe('park i18n 源码 key 使用完整性', () => {
  it('扫描到 park 域源码文件（防护：路径失效时测试不空转）', () => {
    expect(files.length).toBeGreaterThan(5)
    expect(used.size).toBeGreaterThan(10)
  })

  it("源码 t('park.*') 字面量 key 均在 zh-CN park.json 定义", () => {
    // park.json 是 i18next 的 park 命名空间文件：json 内路径需加 'park.' 前缀才等于 t() 的完整 key。
    const defined = new Set(leafKeys(zhCN).map((key) => `park.${key}`))
    const undefinedKeys = [...used.entries()].filter(([key]) => !defined.has(key))
    expect(undefinedKeys.map(([key, locations]) => `${key} @ ${locations.join(', ')}`)).toEqual([])
  })
})
