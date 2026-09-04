import useSWR from 'swr'
import { ApiError, fetchSession } from './authApi'

/**
 * 登录态恢复（计划 3.7）：前端每次刷新先调 GET /api/auth/session，
 * 再决定路由和按钮能力。
 */

export function useSession() {
  const { data, error, isLoading, mutate, isValidating } = useSWR('auth/session', fetchSession, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  })

  const unauthorized = error instanceof ApiError && error.status === 401
  const unavailable = error instanceof ApiError && error.status === 503

  return {
    session: unauthorized ? undefined : data,
    isLoading,
    isValidating,
    unauthorized,
    unavailable,
    refresh: mutate,
  }
}
