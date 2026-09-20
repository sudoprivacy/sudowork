import { describe, expect, test } from 'vitest'
import { deriveWsBaseUrl } from '@sudowork/moss-client'
import type { AppConfig } from '@server/config'
import { resolveLoginMoss } from '@server/features/auth/authService'

const config = {
  moss: {
    baseUrl: 'https://moss.default.com',
    allowedOrigins: ['https://moss.default.com', 'https://custom.moss.com:8443'],
  },
} as AppConfig

describe('resolveLoginMoss（登录期 moss 地址归一化）', () => {
  test('无自定义地址 → 配置默认，身份地址为 null', () => {
    expect(resolveLoginMoss(config)).toEqual({
      baseUrl: 'https://moss.default.com',
      identityBaseUrl: null,
    })
  })

  test('自定义地址与配置同 origin → 视为未自定义，身份地址为 null', () => {
    expect(resolveLoginMoss(config, 'https://moss.default.com/')).toEqual({
      baseUrl: 'https://moss.default.com',
      identityBaseUrl: null,
    })
  })

  test('白名单中的自定义 origin → 身份地址非 null', () => {
    expect(resolveLoginMoss(config, 'https://custom.moss.com:8443')).toEqual({
      baseUrl: 'https://custom.moss.com:8443',
      identityBaseUrl: 'https://custom.moss.com:8443',
    })
  })

  test('拒绝白名单外地址和带路径的地址', () => {
    expect(() => resolveLoginMoss(config, 'http://127.0.0.1:8080')).toThrow(
      'moss origin is not allowed',
    )
    expect(() => resolveLoginMoss(config, 'https://custom.moss.com:8443/internal')).toThrow(
      'moss origin is not allowed',
    )
    expect(() => resolveLoginMoss(config, 'not a url')).toThrow('moss origin is not allowed')
  })
})

describe('deriveWsBaseUrl（http→ws / https→wss）', () => {
  test('http 推导 ws', () => {
    expect(deriveWsBaseUrl('http://moss.test:1/')).toBe('ws://moss.test:1/')
  })
  test('https 推导 wss', () => {
    expect(deriveWsBaseUrl('https://moss.test')).toBe('wss://moss.test')
  })
})
