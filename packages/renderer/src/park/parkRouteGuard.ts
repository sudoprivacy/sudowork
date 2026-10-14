/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/** park 域路由守卫决策（纯函数，供 router.tsx 与单测共用）。
 *  前端守卫只裁剪导航；权威鉴权在 moss park 域（ParkAuthorization）。 */
export type ParkRole = 'park_leader' | 'park_ops' | 'park_system_operator'

export function resolveParkRoute(expected: 'park' | 'enterprise', context: { org_type: 'park' | 'enterprise' | null; park_role?: ParkRole | null } | null, options: { loading: boolean; isDesktop: boolean; allowedRoles?: ParkRole[] }): 'render' | 'wait' | 'redirect' {
  if (options.isDesktop) return 'redirect';
  if (options.loading || context === null) return 'wait';
  if (context.org_type !== expected) return 'redirect';
  if (expected === 'park' && options.allowedRoles && (!context.park_role || !options.allowedRoles.includes(context.park_role))) return 'redirect';
  return 'render';
}
