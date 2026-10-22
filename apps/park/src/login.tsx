import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useParkAuth } from './auth'
import { useParkTitle } from './useParkTitle'
import './login.css'
import { DEFAULT_PARK_LOGO, parkLogoUrl, setParkFavicon } from './brand'

export default function LoginPage() {
  const { state, login } = useParkAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [logoUrl, setLogoUrl] = useState(DEFAULT_PARK_LOGO)
  useParkTitle(displayName)

  useEffect(() => {
    let isActive = true
    void fetch('/public/consult/context', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`)
        return response.json() as Promise<{ display_name: string; logo_url: string | null }>
      })
      .then((context) => {
        if (isActive) {
          setDisplayName(context.display_name)
          setLogoUrl(parkLogoUrl(context.logo_url))
          setParkFavicon(context.logo_url)
        }
      })
      .catch(() => {
        if (isActive) setDisplayName('')
      })
    return () => {
      isActive = false
    }
  }, [])

  if (state.status === 'authenticated') return <Navigate to="/park" replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setError('')
    try {
      await login(username.trim(), password)
      navigate('/park', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="park-login">
      <div className="park-login__field" aria-hidden="true" />
      <section className="park-login__card" aria-labelledby="park-login-title">
        <img
          className="park-login__mark"
          src={logoUrl}
          alt={displayName ? `${displayName} logo` : '园区 logo'}
          onError={() => setLogoUrl(DEFAULT_PARK_LOGO)}
        />
        <p className="park-login__eyebrow">YUNQI SMART VALLEY</p>
        <h1 id="park-login-title">园区管理</h1>
        <p className="park-login__intro">{displayName}</p>
        <form onSubmit={(event) => void onSubmit(event)}>
          <label htmlFor="park-username">账号</label>
          <input
            id="park-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <label htmlFor="park-password">密码</label>
          <input
            id="park-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && (
            <p className="park-login__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '正在登录…' : '进入园区管理'}
          </button>
        </form>
      </section>
    </main>
  )
}
