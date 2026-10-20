import { z } from 'zod'
import type { MossCallContext, MossFetch } from './MossHttpClient.js'
import { MossHttpError } from './MossHttpClient.js'

/** Reuse conversation interrupt/continue without allocating Chrome or sending another prompt. */
export async function changeMossBrowserConversation(
  request: MossFetch,
  ctx: MossCallContext,
  sessionId: string,
  intent: 'interrupt' | 'continue',
): Promise<boolean> {
  let reply: unknown
  try {
    reply = await request(
      ctx.baseUrl,
      {
        method: 'POST',
        path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/browser/conversation`,
        accessToken: ctx.accessToken,
        body: { intent },
      },
      30_000,
    )
  } catch (error) {
    if (error instanceof MossHttpError && error.status === 404) {
      let body: unknown
      try {
        body = JSON.parse(error.bodyText)
      } catch {
        /* Preserve an unknown response. */
      }
      if (body && typeof body === 'object' && (body as { error?: unknown }).error === 'Not found')
        return false
    }
    throw error
  }
  return z.object({ changed: z.boolean() }).parse(reply).changed
}
