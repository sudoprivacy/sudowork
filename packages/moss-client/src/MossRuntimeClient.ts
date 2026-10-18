import { z } from 'zod'
import { MossHttpError, type MossCallContext, type MossFetch } from './MossHttpClient.js'

const upgradedRuntimeSchema = z.object({ runtime: z.object({ ownerId: z.string().min(1) }) })
const updateRequiredSchema = z.object({
  startup: z.object({ code: z.literal('RUNTIME_UPDATE_REQUIRED'), isRetryable: z.literal(false) }),
})

/** Recognize only the public startup discriminator; raw upstream messages stay private. */
export function isMossRuntimeUpdateRequired(error: unknown): boolean {
  if (!(error instanceof MossHttpError) || error.status !== 503) return false
  try {
    return updateRequiredSchema.safeParse(JSON.parse(error.bodyText)).success
  } catch {
    return false
  }
}

/** The host derives the owner from an authorized Session; Moss enforces the update policy. */
export async function upgradeMossRuntime(fetchRuntime: MossFetch, ctx: MossCallContext, ownerId: string): Promise<void> {
  const response = upgradedRuntimeSchema.parse(await fetchRuntime(ctx.baseUrl, {
    method: 'POST', path: `/api/v1/agent-runtimes/${encodeURIComponent(ownerId)}/upgrade`,
    accessToken: ctx.accessToken, body: {},
  }, 180_000))
  if (response.runtime.ownerId !== ownerId) throw new Error('Runtime update returned a different owner')
}
