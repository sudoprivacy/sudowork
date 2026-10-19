import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { ParkAuthProvider, useParkAuth } from './auth'
import type { ParkRole } from './auth'
import LoginPage from './login'
import ParkConsole from './pages'
import './base.css'

const landing: Record<ParkRole, string> = {
  park_leader: '/park/overview',
  park_recruiter: '/park/leads',
  park_system_operator: '/park/admin/policies',
}

function ParkGate() {
  const { state, logout, refresh } = useParkAuth()
  if (state.status === 'loading') return <div className="park-state">正在加载园区会话…</div>
  if (state.status === 'anonymous') return <Navigate to="/park/login" replace />
  if (state.status === 'error') {
    return (
      <div className="park-state" role="alert">
        园区服务暂不可用。<button onClick={() => void refresh()}>重试</button>
      </div>
    )
  }
  if (state.status === 'forbidden') {
    return (
      <div className="park-state" role="alert">
        当前账号没有园区管理权限。
        <button onClick={() => void logout()}>退出登录</button>
      </div>
    )
  }
  return <Outlet />
}

function ParkHome() {
  const { state } = useParkAuth()
  return state.status === 'authenticated' ? <Navigate to={landing[state.parkRole]} replace /> : null
}

function App() {
  return (
    <BrowserRouter>
      <ParkAuthProvider>
        <Routes>
          <Route path="/park/login" element={<LoginPage />} />
          <Route element={<ParkGate />}>
            <Route path="/park" element={<ParkHome />} />
            <Route path="/park/overview" element={<ParkConsole />} />
            <Route path="/park/leads/summary" element={<ParkConsole />} />
            <Route path="/park/reports" element={<ParkConsole />} />
            <Route path="/park/compliance/summary" element={<ParkConsole />} />
            <Route path="/park/leads" element={<ParkConsole />} />
            <Route path="/park/leads/:leadId" element={<ParkConsole />} />
            <Route path="/park/follow-ups" element={<ParkConsole />} />
            <Route path="/park/admin/policies" element={<ParkConsole />} />
            <Route path="/park/admin/quick-questions" element={<ParkConsole />} />
            <Route path="/park/admin/assistant" element={<ParkConsole />} />
            <Route path="/park/admin/public-links" element={<ParkConsole />} />
            <Route path="/park/admin/rate-limits" element={<ParkConsole />} />
            <Route path="/park/admin/audit" element={<ParkConsole />} />
            <Route path="/park/admin/operations" element={<ParkConsole />} />
          </Route>
          <Route path="*" element={<Navigate to="/park" replace />} />
        </Routes>
      </ParkAuthProvider>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
