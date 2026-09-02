/**
 * Moss REST 薄封装（计划 3.2）：
 * - 每次请求由调用方传入该 Web Session 自己的 access token（禁止全局 token）
 * - 超时控制；非 2xx 抛 MossHttpError；网络不可达抛 MossNetworkError
 * - 日志不记录 Authorization / Cookie / token / 敏感 body（计划 3.5）
 */

export class MossHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
    readonly path: string,
  ) {
    super(`moss ${path} responded ${status}`)
    this.name = 'MossHttpError'
  }
}

export class MossNetworkError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`moss ${path} unreachable: ${(cause as Error)?.message ?? String(cause)}`)
    this.name = 'MossNetworkError'
  }
}

export type MossRequestMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface MossRequest {
  method: MossRequestMethod
  path: string
  body?: unknown
  accessToken?: string
  searchParams?: Record<string, string>
}

export type MossFetch = (baseUrl: string, req: MossRequest, timeoutMs?: number) => Promise<unknown>

export const DEFAULT_MOSS_TIMEOUT_MS = 15_000

export async function mossRequest(
  baseUrl: string,
  req: MossRequest,
  timeoutMs = DEFAULT_MOSS_TIMEOUT_MS,
): Promise<unknown> {
  const url = new URL(req.path, baseUrl)
  for (const [key, value] of Object.entries(req.searchParams ?? {})) {
    url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {}
  if (req.accessToken) {
    headers.authorization = `Bearer ${req.accessToken}`
  }
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let json: unknown = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
    }
    if (!res.ok) {
      throw new MossHttpError(res.status, text, req.path)
    }
    return json
  } catch (err) {
    if (err instanceof MossHttpError) throw err
    throw new MossNetworkError(req.path, err)
  } finally {
    clearTimeout(timer)
  }
}
