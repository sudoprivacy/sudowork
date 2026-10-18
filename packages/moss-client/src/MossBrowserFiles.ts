import { BrowserFileSchema, type BrowserFile } from '@sudowork/contracts/browser-session'
import { MossHttpError, MossNetworkError, type MossCallContext } from './MossHttpClient.js'

export const BROWSER_FILE_LIMIT = 16 * 1024 * 1024

async function request<T>(
  ctx: MossCallContext,
  path: string,
  options: RequestInit,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(new URL(path, ctx.baseUrl), {
      ...options,
      redirect: 'error',
      headers: {
        ...options.headers,
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new MossHttpError(response.status, await response.text(), path)
    return await consume(response)
  } catch (error) {
    if (error instanceof MossHttpError) throw error
    throw new MossNetworkError(path, error)
  } finally {
    clearTimeout(timer)
  }
}

export async function uploadBrowserFile(
  ctx: MossCallContext,
  sessionId: string,
  input: { name: string; controlEpoch: number; targetEpoch: number },
  data: Uint8Array,
): Promise<BrowserFile> {
  if (data.byteLength > BROWSER_FILE_LIMIT) throw new Error('browser_files_too_large')
  return request(
    ctx,
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/browser/files/upload`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Browser-File-Name': encodeURIComponent(input.name),
        'X-Browser-Control-Epoch': String(input.controlEpoch),
        'X-Browser-Target-Epoch': String(input.targetEpoch),
      },
      body: new Uint8Array(data).buffer,
    },
    async (response) => {
      const result = (await response.json()) as { file?: unknown }
      return BrowserFileSchema.parse(result.file)
    },
  )
}

export async function downloadBrowserFile(
  ctx: MossCallContext,
  sessionId: string,
  fileId: string,
): Promise<Uint8Array> {
  if (!/^[a-f0-9]{32}$/.test(fileId)) throw new Error('browser_file_not_found')
  return request(
    ctx,
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/browser/files/${fileId}`,
    { method: 'GET' },
    async (response) => {
      const reader = response.body?.getReader()
      if (!reader) return new Uint8Array()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          length += chunk.value.byteLength
          if (length > BROWSER_FILE_LIMIT) throw new Error('browser_files_too_large')
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      const data = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      return data
    },
  )
}
