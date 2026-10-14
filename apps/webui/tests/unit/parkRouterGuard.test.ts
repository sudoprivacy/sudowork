import { describe, expect, it } from 'vitest'
import { resolveParkRoute } from '@sudowork/renderer/park/parkRouteGuard'

/** park 路由守卫决策测试（计划 5.5 unit：org 类型/isDesktopRuntime 分支）。
 *  纯函数直测——withParkGuard 组件只是该决策的渲染映射。 */

describe('resolveParkRoute（park 路由守卫决策）', () => {
  it('org 类型匹配 → render', () => {
    expect(
      resolveParkRoute(
        'enterprise',
        { org_type: 'enterprise' },
        { loading: false, isDesktop: false },
      ),
    ).toBe('render')
    expect(
      resolveParkRoute('park', { org_type: 'park' }, { loading: false, isDesktop: false }),
    ).toBe('render')
  })

  it('org 类型不匹配 → redirect', () => {
    expect(
      resolveParkRoute('enterprise', { org_type: 'park' }, { loading: false, isDesktop: false }),
    ).toBe('redirect')
    expect(
      resolveParkRoute('park', { org_type: 'enterprise' }, { loading: false, isDesktop: false }),
    ).toBe('redirect')
    expect(resolveParkRoute('park', { org_type: null }, { loading: false, isDesktop: false })).toBe(
      'redirect',
    )
  })

  it('上下文加载中 → wait（不渲染不重定向）', () => {
    expect(resolveParkRoute('park', null, { loading: true, isDesktop: false })).toBe('wait')
  })

  it('桌面端（isElectronDesktop）→ redirect（园区入口隐藏）', () => {
    expect(
      resolveParkRoute(
        'enterprise',
        { org_type: 'enterprise' },
        { loading: false, isDesktop: true },
      ),
    ).toBe('redirect')
    // 桌面判定优先于一切（含加载中）
    expect(resolveParkRoute('park', null, { loading: true, isDesktop: true })).toBe('redirect')
  })

  it('系统管理路由仅园区系统运营可进入', () => {
    const options = {
      loading: false,
      isDesktop: false,
      allowedRoles: ['park_system_operator' as const],
    }
    expect(
      resolveParkRoute('park', { org_type: 'park', park_role: 'park_system_operator' }, options),
    ).toBe('render')
    expect(resolveParkRoute('park', { org_type: 'park', park_role: 'park_leader' }, options)).toBe(
      'redirect',
    )
    expect(resolveParkRoute('park', { org_type: 'park', park_role: 'park_ops' }, options)).toBe(
      'redirect',
    )
  })
})
