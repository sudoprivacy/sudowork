import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useParkAuth } from '../auth'
import { useParkTitle } from '../useParkTitle'
import { createParkApi } from './api'
import { parkLabels as t } from './labels'
import { LeaderPage } from './leader'
import { RecruiterPage } from './recruiter'
import { OperatorPage } from './operator'
import styles from './park.module.css'
import { DEFAULT_PARK_LOGO, parkLogoUrl, setParkFavicon } from '../brand'

export type ParkRole = 'park_leader' | 'park_recruiter' | 'park_system_operator'
export type PageId =
  | 'overview'
  | 'summary'
  | 'reports'
  | 'compliance'
  | 'leads'
  | 'detail'
  | 'followUps'
  | 'policies'
  | 'content'
  | 'assistant'
  | 'publicLinks'
  | 'rateLimits'
  | 'audit'
  | 'operations'

const pages: Array<{ id: PageId; path: string; role: ParkRole }> = [
  { id: 'overview', path: '/park/overview', role: 'park_leader' },
  { id: 'summary', path: '/park/leads/summary', role: 'park_leader' },
  { id: 'reports', path: '/park/reports', role: 'park_leader' },
  { id: 'compliance', path: '/park/compliance/summary', role: 'park_leader' },
  { id: 'leads', path: '/park/leads', role: 'park_recruiter' },
  { id: 'followUps', path: '/park/follow-ups', role: 'park_recruiter' },
  {
    id: 'policies',
    path: '/park/admin/policies',
    role: 'park_system_operator',
  },
  {
    id: 'content',
    path: '/park/admin/content',
    role: 'park_system_operator',
  },
  {
    id: 'assistant',
    path: '/park/admin/assistant',
    role: 'park_system_operator',
  },
  {
    id: 'publicLinks',
    path: '/park/admin/public-links',
    role: 'park_system_operator',
  },
  {
    id: 'rateLimits',
    path: '/park/admin/rate-limits',
    role: 'park_system_operator',
  },
  { id: 'audit', path: '/park/admin/audit', role: 'park_system_operator' },
  {
    id: 'operations',
    path: '/park/admin/operations',
    role: 'park_system_operator',
  },
]

function currentPage(path: string): { id: PageId; path: string; role: ParkRole } | undefined {
  if (/^\/park\/leads\/[^/]+$/.test(path) && path !== '/park/leads/summary')
    return { id: 'detail', path, role: 'park_recruiter' }
  return pages.find((page) => page.path === path)
}

export default function ParkConsole() {
  const location = useLocation()
  const { state, logout } = useParkAuth()
  const orgId = state.status === 'authenticated' ? state.orgId : null
  const role = state.status === 'authenticated' ? state.parkRole : null
  const page = currentPage(location.pathname)
  const api = useMemo(() => (orgId ? createParkApi(orgId) : null), [orgId])
  const [parkBrand, setParkBrand] = useState<{
    orgId: string
    displayName: string
    logoUrl: string | null
  } | null>(null)
  const brandRequestVersion = useRef(0)

  useEffect(() => {
    if (!orgId) return
    const version = ++brandRequestVersion.current
    void fetch('/public/consult/context', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`)
        return response.json() as Promise<{ display_name: string; logo_url: string | null }>
      })
      .then((context) => {
        if (version === brandRequestVersion.current) {
          setParkBrand({ orgId, displayName: context.display_name, logoUrl: context.logo_url })
        }
      })
      .catch(() => {
        if (version === brandRequestVersion.current) setParkBrand(null)
      })
    return () => {
      brandRequestVersion.current++
    }
  }, [orgId])

  const displayName = parkBrand?.orgId === orgId ? parkBrand.displayName : ''
  const logoUrl = parkBrand?.orgId === orgId ? parkBrand.logoUrl : null
  useEffect(() => setParkFavicon(logoUrl), [logoUrl])
  useParkTitle(displayName)
  const brand = displayName ? `${displayName} · ${t.brand}` : t.brand

  function onBrandSaved(next: { display_name: string; logo_url: string | null }) {
    if (!orgId) return
    brandRequestVersion.current++
    setParkBrand({ orgId, displayName: next.display_name, logoUrl: next.logo_url })
  }

  if (!page) return <div className={styles.message}>{t.failed}</div>
  if (!orgId || !api) return <div className={styles.message}>{t.noPark}</div>
  if (role !== page.role) return <div className={styles.message}>{t.noAccess}</div>

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img
            className={styles.brandLogo}
            src={parkLogoUrl(logoUrl)}
            alt=""
            onError={(event) => {
              event.currentTarget.onerror = null
              event.currentTarget.src = DEFAULT_PARK_LOGO
            }}
          />
          <strong>{t.brand}</strong>
        </div>
        <nav className={styles.nav} aria-label={brand}>
          {pages
            .filter((item) => item.role === role)
            .map((item) => (
              <Link
                key={item.id}
                to={item.path}
                className={`${styles.navLink} ${page.id === item.id ? styles.active : ''}`}
              >
                {t.nav[item.id]}
              </Link>
            ))}
        </nav>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <h1 className={styles.topbarTitle}>{t.nav[page.id]}</h1>
          <div className={styles.topbarActions}>
            <button className={styles.logout} type="button" onClick={() => void logout()}>
              退出登录
            </button>
          </div>
        </header>
        <main className={styles.main}>
          {role === 'park_leader' && <LeaderPage key={page.id} id={page.id} api={api} />}
          {role === 'park_recruiter' && (
            <RecruiterPage
              key={location.pathname}
              id={page.id}
              api={api}
              leadId={page.id === 'detail' ? location.pathname.split('/').at(-1)! : undefined}
            />
          )}
          {role === 'park_system_operator' && (
            <OperatorPage key={page.id} id={page.id} api={api} onBrandSaved={onBrandSaved} />
          )}
        </main>
      </div>
    </div>
  )
}
