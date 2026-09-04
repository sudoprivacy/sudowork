import { useState, type FormEvent } from 'react'
import { ApiError, loginApiKey, loginPassword } from './authApi'
import './LoginPage.css'

/**
 * 登录页（计划 Task 3）：密码/API Key 两种方式；
 * 自定义 Moss 地址默认折叠、永不自动展开，展开填写后该会话所有 moss 调用走此地址。
 * 视觉在 Task 4 摘取 Sudowork design tokens 后统一替换。
 */

type LoginMode = 'password' | 'apiKey'

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: '用户名或密码错误',
  MOSS_UNAVAILABLE: '服务暂不可用，请稍后重试',
  INVALID_REQUEST: '输入不完整',
}

export function LoginPage({ onSuccess }: { onSuccess?: (result: { ok: true }) => void }) {
  const [mode, setMode] = useState<LoginMode>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [mossUrl, setMossUrl] = useState<string>(() => localStorage.getItem('login.mossBaseUrl') ?? '')
  const [customUrlExpanded, setCustomUrlExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function switchMode(next: LoginMode): void {
    setMode(next)
    setError(null)
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    // 自定义地址：仅展开时生效。非空须为 http(s) 完整 URL 并记忆；展开且清空则移除记忆。
    let mossBaseUrl: string | undefined
    if (customUrlExpanded) {
      const trimmed = mossUrl.trim()
      if (trimmed) {
        try {
          const parsed = new URL(trimmed)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme')
        } catch {
          setError('地址必须是以 http:// 或 https:// 开头的完整 URL')
          return
        }
        mossBaseUrl = trimmed
        localStorage.setItem('login.mossBaseUrl', trimmed)
      } else {
        localStorage.removeItem('login.mossBaseUrl')
      }
    }

    setLoading(true)
    try {
      const result =
        mode === 'password'
          ? await loginPassword({ username, password, ...(mossBaseUrl ? { mossBaseUrl } : {}) })
          : await loginApiKey(apiKey, mossBaseUrl)
      onSuccess?.(result)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(ERROR_MESSAGES[err.code] ?? `登录失败（${err.code}）`)
      } else {
        setError('网络错误，请重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" aria-label="登录表单" onSubmit={handleSubmit}>
        <h1 className="login-title">CTWork</h1>

        <div className="login-tabs" role="tablist" aria-label="登录方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'password'}
            className={mode === 'password' ? 'login-tab login-tab--active' : 'login-tab'}
            onClick={() => switchMode('password')}
          >
            账户密码
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'apiKey'}
            className={mode === 'apiKey' ? 'login-tab login-tab--active' : 'login-tab'}
            onClick={() => switchMode('apiKey')}
          >
            API Key
          </button>
        </div>

        {mode === 'password' ? (
          <>
            <label className="login-field">
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="login-field">
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          </>
        ) : (
          <label className="login-field">
            API Key
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          </label>
        )}

        {customUrlExpanded ? (
          <label className="login-field">
            Moss 服务器地址
            <input
              value={mossUrl}
              onChange={(e) => setMossUrl(e.target.value)}
              autoComplete="off"
              inputMode="url"
            />
          </label>
        ) : (
          <button type="button" className="login-custom-toggle" onClick={() => setCustomUrlExpanded(true)}>
            使用自定义服务器地址
          </button>
        )}

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="login-submit" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  )
}
