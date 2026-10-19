import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'

export type ParkRole = 'park_leader' | 'park_recruiter' | 'park_system_operator'

type AuthState =
  | { status: 'loading' | 'anonymous' | 'forbidden' | 'error' }
  | {
      status: 'authenticated'
      user: { id: string; name: string }
      orgId: string
      parkRole: ParkRole
    }

interface AuthContextValue {
  state: AuthState
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadSession(): Promise<AuthState> {
  const sessionResponse = await fetch('/park/api/auth/session', {
    credentials: 'include',
  })
  if (sessionResponse.status === 401) return { status: 'anonymous' }
  if (!sessionResponse.ok) return { status: 'error' }
  const session = (await sessionResponse.json()) as {
    user?: { id?: string; name?: string }
    organization?: { id?: string } | null
  }
  const orgId = session.organization?.id
  const userId = session.user?.id
  if (!orgId || !userId) return { status: 'forbidden' }
  const roleResponse = await fetch(`/park/api/v1/parks/${encodeURIComponent(orgId)}/me`, {
    credentials: 'include',
  })
  if (roleResponse.status === 403) return { status: 'forbidden' }
  if (roleResponse.status === 401) return { status: 'anonymous' }
  if (!roleResponse.ok) return { status: 'error' }
  const data = (await roleResponse.json()) as { park_role?: unknown }
  const role = data.park_role
  if (role !== 'park_leader' && role !== 'park_recruiter' && role !== 'park_system_operator') {
    return { status: 'forbidden' }
  }
  return {
    status: 'authenticated',
    user: { id: userId, name: session.user?.name ?? userId },
    orgId,
    parkRole: role,
  }
}

export function ParkAuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const refresh = useCallback(async () => {
    try {
      setState(await loadSession())
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      const response = await fetch('/park/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Logout failed')
      setState({ status: 'anonymous' })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch('/park/api/auth/login/password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (response.status === 403) throw new Error('当前账号没有园区管理权限。')
    if (response.status === 401) throw new Error('账号或密码不正确，请重试。')
    if (!response.ok) throw new Error('园区服务暂不可用，请稍后重试。')
    const next = await loadSession()
    if (next.status === 'error') throw new Error('园区服务暂不可用，请稍后重试。')
    if (next.status !== 'authenticated') {
      await fetch('/park/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      setState({ status: 'anonymous' })
      throw new Error('当前账号没有园区管理权限。')
    }
    setState(next)
  }, [])

  const value = useMemo(() => ({ state, login, logout, refresh }), [state, login, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useParkAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('ParkAuthProvider is required')
  return value
}
