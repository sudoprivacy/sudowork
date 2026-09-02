import React from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { LoginPage } from './features/auth/LoginPage'
import { useSession } from './features/auth/useAuth'
import { ConversationPage } from './features/conversations/ConversationPage'
import { NewConversationPage } from './features/conversations/NewConversationPage'
import { AgentsPage } from './features/agents/AgentsPage'
import { SkillsPage } from './features/skills/SkillsPage'
import { CronPage } from './features/cron/CronPage'
import { CronJobDetailPage } from './features/cron/CronJobDetailPage'
import { ProfilePage } from './features/settings/ProfilePage'
import { DisplayPage } from './features/settings/DisplayPage'
import { AboutPage } from './features/settings/AboutPage'
import { McpSettingsPage } from './features/mcp/McpSettingsPage'
import { AppLayout } from './layouts/AppLayout'

/**
 * 路由表（计划 Task 4）：只注册
 * login / guid / conversation / agents / skills / cron / profile / mcp / display / about。
 * 严禁加入 local-kb、security、channels、recharge、members 等范围外页面。
 */

export const ROUTE_PATHS = [
  '/login',
  '/guid',
  '/conversation/:id',
  '/agents',
  '/skills',
  '/cron',
  '/settings/profile',
  '/settings/mcp',
  '/settings/display',
  '/settings/about',
] as const

export type RoutePath = (typeof ROUTE_PATHS)[number]

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, isLoading, unauthorized } = useSession()
  if (isLoading) {
    return (
      <div className='size-full f-center text-secondary text-14px' data-testid='auth-loading'>
        加载中…
      </div>
    )
  }
  if (unauthorized || !session) {
    return <Navigate to='/login' replace />
  }
  return <>{children}</>
}

function LoginRoute(): React.ReactElement {
  const navigate = useNavigate()
  const { refresh } = useSession()
  return (
    <LoginPage
      onSuccess={async () => {
        // 先刷新 SWR 缓存（否则 RequireAuth 仍看到旧的 401 状态会弹回登录页）
        await refresh()
        void navigate('/guid', { replace: true })
      }}
    />
  )
}

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path='/login' element={<LoginRoute />} />
      <Route
        path='/'
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to='/guid' replace />} />
        <Route path='guid' element={<NewConversationPage />} />
        <Route path='conversation/:id' element={<ConversationPage />} />
        <Route path='agents' element={<AgentsPage />} />
        <Route path='skills' element={<SkillsPage />} />
        <Route path='cron' element={<CronPage />} />
        <Route path='cron/:id' element={<CronJobDetailPage />} />
        <Route path='settings/profile' element={<ProfilePage />} />
        <Route path='settings/mcp' element={<McpSettingsPage />} />
        <Route path='settings/display' element={<DisplayPage />} />
        <Route path='settings/about' element={<AboutPage />} />
      </Route>
      <Route path='*' element={<Navigate to='/guid' replace />} />
    </Routes>
  )
}
