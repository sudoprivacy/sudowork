import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useParkAuth } from '../auth'
import { createParkApi } from './api'
import { parkLabels as t } from './labels'
import { LeaderPage } from './leader'
import { RecruiterPage } from './recruiter'
import { OperatorPage } from './operator'
import styles from './park.module.css'

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
  | 'quickQuestions'
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
    id: 'quickQuestions',
    path: '/park/admin/quick-questions',
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

  if (!page) return <div className={styles.message}>{t.failed}</div>
  if (!orgId || !api) return <div className={styles.message}>{t.noPark}</div>
  if (role !== page.role) return <div className={styles.message}>{t.noAccess}</div>

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>园</span>
          <strong>{t.brand}</strong>
        </div>
        <nav className={styles.nav} aria-label={t.brand}>
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
          <span>{t.nav[page.id]}</span>
          <div className={styles.topbarActions}>
            <span className={styles.dataSource}>{t.demo}</span>
            <button className={styles.logout} type="button" onClick={() => void logout()}>
              退出登录
            </button>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.pageHeading}>
            <div>
              <span className={styles.eyebrow}>PARK / {page.id.toUpperCase()}</span>
              <h1>{t.nav[page.id]}</h1>
            </div>
          </div>
          {role === 'park_leader' && <LeaderPage key={page.id} id={page.id} api={api} />}
          {role === 'park_recruiter' && (
            <RecruiterPage
              key={location.pathname}
              id={page.id}
              api={api}
              leadId={page.id === 'detail' ? location.pathname.split('/').at(-1)! : undefined}
            />
          )}
          {role === 'park_system_operator' && <OperatorPage key={page.id} id={page.id} api={api} />}
        </main>
      </div>
    </div>
  )
}
