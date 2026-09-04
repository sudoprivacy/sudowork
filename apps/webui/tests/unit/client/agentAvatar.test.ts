import { describe, expect, test } from 'vitest'
import {
  AGENT_AVATAR_PROXY_PATH,
  resolveAgentAvatar,
} from '@client/components/agentAvatar'

describe('resolveAgentAvatar', () => {
  test('空/null/undefined 返回 null', () => {
    expect(resolveAgentAvatar('')).toBeNull()
    expect(resolveAgentAvatar('   ')).toBeNull()
    expect(resolveAgentAvatar(null)).toBeNull()
    expect(resolveAgentAvatar(undefined)).toBeNull()
  })

  test('绝对 URL（hub COS）跨源直连，原样返回', () => {
    const url = 'https://sudowork-hub.example.com/a/b.png'
    expect(resolveAgentAvatar(url)).toEqual({ kind: 'image', value: url })
  })

  test('data URI 原样返回为 image', () => {
    const uri = 'data:image/png;base64,AAAA'
    expect(resolveAgentAvatar(uri)).toEqual({ kind: 'image', value: uri })
  })

  test('emoji（含 ZWJ 序列）识别为 emoji', () => {
    expect(resolveAgentAvatar('🤖')).toEqual({ kind: 'emoji', value: '🤖' })
    expect(resolveAgentAvatar('👨‍💻')).toEqual({ kind: 'emoji', value: '👨‍💻' })
  })

  test('tenant 相对路径拼同源代理 URL（path 经 encodeURIComponent）', () => {
    const path = '/uploads/tenant-assistant-avatars/abc-1.png'
    expect(resolveAgentAvatar(path)).toEqual({
      kind: 'image',
      value: `${AGENT_AVATAR_PROXY_PATH}?path=${encodeURIComponent(path)}`,
    })
  })

  test('其他相对路径 / blob 不生成代理，返回 null 交兜底', () => {
    expect(resolveAgentAvatar('/other/path.png')).toBeNull()
    expect(resolveAgentAvatar('blob:xxx')).toBeNull()
  })
})
