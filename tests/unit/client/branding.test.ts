import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('static UI branding', () => {
  test('uses CTWork title and China Telecom favicon', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const document = new DOMParser().parseFromString(html, 'text/html')

    expect(document.title).toBe('CTWork')
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href')).toBe(
      '/china-telecom-logo.svg',
    )
    expect(existsSync(resolve(process.cwd(), 'public/china-telecom-logo.svg'))).toBe(true)
  })
})
