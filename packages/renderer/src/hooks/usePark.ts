import { useCallback, useEffect, useState } from 'react'
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge'

/** 园区业务域数据 hook：封装 park.* channel 调用（WebUI 经 mossAdapter 转发 BFF）。
 *  method 为 ipcBridge.park 的方法名（camelCase，如 getContext / listLeads）。 */

type ParkProvider = { invoke: (args?: unknown) => Promise<unknown> }

function parkMethod(method: string): ParkProvider {
  const park = (ipcBridge as unknown as { park: Record<string, ParkProvider> }).park
  const target = park[method]
  if (!target) throw new Error(`unknown park method: ${method}`)
  return target
}

export function useParkQuery<T>(method: string | null, args?: Record<string, unknown>): {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const argKey = JSON.stringify(args ?? {})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    if (method === null) {
      // 跳过模式（如桌面端不展示园区入口）：不发请求、不进入错误态。
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const result = await parkMethod(method).invoke(args)
        // 上游错误体（BFF/moss 的 {error:{...}} 或 {__error}）不得进入 data——
        // 否则调用方按正常结构渲染时读到 undefined 字段崩溃。
        if (result && typeof result === 'object' && !Array.isArray(result)
          && (('error' in (result as Record<string, unknown>) && (result as Record<string, unknown>).error)
            || '__error' in (result as Record<string, unknown>))) {
          if (!cancelled) setError(JSON.stringify((result as Record<string, unknown>).error ?? (result as Record<string, unknown>).__error).slice(0, 200))
          return
        }
        if (!cancelled) setData(result as T)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // deps 有意为之：args 经 argKey 序列化进入依赖（避免每次渲染的新对象引用触发重复请求）。
  }, [method, argKey, tick])

  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, loading, error, reload }
}

export async function invokePark<R = unknown>(method: string, args?: Record<string, unknown>): Promise<R> {
  return (await parkMethod(method).invoke(args)) as R
}

export interface IParkContext {
  org_type: 'park' | 'enterprise' | null
  park_role: 'park_leader' | 'park_ops' | 'park_system_operator' | null
  park_org_id: string | null
  display_name: string | null
}

/** 园区侧页面共用的 parkOrgId 来源（来自 /api/park/context，服务端推导）。 */
export function useParkOrgId(): { parkOrgId: string | null; role: IParkContext['park_role']; loading: boolean } {
  const { data, loading } = useParkQuery<IParkContext>('getContext')
  return { parkOrgId: data?.park_org_id ?? null, role: data?.park_role ?? null, loading }
}
