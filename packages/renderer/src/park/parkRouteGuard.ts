/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/** park 域路由守卫决策（纯函数，供 router.tsx 与单测共用）。
 *  前端守卫只裁剪导航；权威鉴权在 moss park 域（ParkAuthorization）。 */
export function resolveParkRoute(expected: 'park' | 'enterprise', context: { org_type: 'park' | 'enterprise' | null } | null, options: { loading: boolean; isDesktop: boolean }): 'render' | 'wait' | 'redirect' {
  if (options.isDesktop) return 'redirect';
  if (options.loading || context === null) return 'wait';
  return context.org_type === expected ? 'render' : 'redirect';
}
