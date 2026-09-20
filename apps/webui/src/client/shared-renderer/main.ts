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

function inferIconType(src: string): string | undefined {
  const lower = src.toLowerCase()
  if (lower.startsWith('data:image/svg+xml') || lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.startsWith('data:image/png') || lower.endsWith('.png')) return 'image/png'
  if (lower.startsWith('data:image/jpeg') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (lower.startsWith('data:image/webp') || lower.endsWith('.webp')) return 'image/webp'
  return undefined
}

function ensureIconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (existing) return existing

  const link = document.createElement('link')
  link.rel = 'icon'
  document.head.appendChild(link)
  return link
}

function applyTenantBrowserBranding(config: ReturnType<typeof resolveTenantConfig>): void {
  const title = config.top_name || config.app_name
  if (title) {
    document.title = title
  }

  if (!config.logo) return

  const link = ensureIconLink()
  link.href = config.logo

  const type = inferIconType(config.logo)
  if (type) {
    link.type = type
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
