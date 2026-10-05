/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The web entry that hosts the shared `@sudowork/renderer` over the moss
 * transport. This is the sole webui front-end entry.
 *
 * Order matters (mirrors the desktop entry packages/renderer/src/index.ts):
 * side-effect-import the moss adapter FIRST so `bridge.adapter` is wired before
 * the renderer's eager module-level ipcBridge calls run. `useAppMode` primes the
 * app mode via a module-level `ConfigStorage` ipcBridge call at import time, and
 * ES import hoisting means the transport must be live before `mountApp` (and the
 * modules it pulls in) execute.
 */

import '../bridgeAdapter/mossAdapter'
import { mountApp } from '@sudowork/renderer/bootstrap/mount'
import {
  TENANT_CONFIG_STORAGE_KEY,
  resolveTenantConfig,
  type TenantConfigInput,
} from '@sudowork/common/types/tenantConfig'
import { redirectLegacyPath } from './legacyPaths'
import { applyTenantBrowserBranding } from '@sudowork/renderer/utils/tenantBranding'

type PublicTenantConfigPayload = TenantConfigInput & {
  appName?: unknown
  topName?: unknown
  aboutName?: unknown
  appCompanyName?: unknown
  loginDesp?: unknown
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function normalizeTenantConfig(config: PublicTenantConfigPayload): TenantConfigInput {
  return {
    ...config,
    logo: pickString(config.logo),
    app_name: pickString(config.app_name, config.appName),
    top_name: pickString(config.top_name, config.topName),
    about_name: pickString(config.about_name, config.aboutName),
    app_company_name: pickString(config.app_company_name, config.appCompanyName),
    login_desp: pickString(config.login_desp, config.loginDesp),
  }
}

function readTenantConfigPayload(payload: unknown): TenantConfigInput | null {
  if (!payload || typeof payload !== 'object') return null

  const body = payload as { success?: unknown; data?: unknown }
  if (body.success === true && body.data && typeof body.data === 'object') {
    return normalizeTenantConfig(body.data as PublicTenantConfigPayload)
  }

  if ('app_name' in body || 'appName' in body || 'logo' in body) {
    return normalizeTenantConfig(body as PublicTenantConfigPayload)
  }

  return null
}

function applyCachedBranding(): void {
  try {
    const cached = localStorage.getItem(TENANT_CONFIG_STORAGE_KEY)
    if (!cached) return
    applyTenantBrowserBranding(resolveTenantConfig(JSON.parse(cached) as TenantConfigInput))
  } catch {
    /* best-effort bootstrap branding */
  }
}

async function refreshPublicTenantConfig(): Promise<void> {
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5_000)
      : undefined
  const response = await fetch('/api/v1/tenant/config', {
    method: 'GET',
    credentials: 'include',
    signal,
  })
  if (!response.ok) return

  const tenantConfig = readTenantConfigPayload(await response.json())
  if (!tenantConfig) return

  const mergedConfig = resolveTenantConfig(tenantConfig)
  localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify(mergedConfig))
  applyTenantBrowserBranding(mergedConfig)
}

async function bootstrapWebui(): Promise<void> {
  applyCachedBranding()
  await refreshPublicTenantConfig().catch(() => {})
}

if (!redirectLegacyPath()) {
  void bootstrapWebui().finally(() => mountApp())
}
