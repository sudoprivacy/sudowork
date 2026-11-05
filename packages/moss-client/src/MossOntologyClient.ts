import {
  MossOntologyProjectsResponseSchema,
  MossSessionProjectResponseSchema,
  ModelReviewBrowserEpochsSchema,
  ModelReviewSurfaceSchema,
  type ModelReviewBrowserEpochs,
  type ModelReviewSurface,
  type CanonicalModelProject,
} from '@sudowork/contracts/conversations'
import type { MossCallContext, MossFetch } from './MossHttpClient.js'
import { MossProjectScopeError } from './MossSessionClient.js'

export interface MossOntologyPort {
  projects(ctx: MossCallContext): Promise<CanonicalModelProject[]>
  sessionProject(ctx: MossCallContext, sessionId: string): Promise<CanonicalModelProject | null>
  openReview(
    ctx: MossCallContext,
    sessionId: string,
    epochs: ModelReviewBrowserEpochs,
  ): Promise<ModelReviewSurface>
}

/** Host references only. The current authenticated Moss owner supplies every authorization. */
export function createMossOntologyPort(request: MossFetch): MossOntologyPort {
  return {
    async projects(ctx) {
      const value = await request(ctx.baseUrl, {
        method: 'GET',
        path: '/api/v1/ontology/projects',
        accessToken: ctx.accessToken,
      })
      return MossOntologyProjectsResponseSchema.parse(value).projects
    },
    async sessionProject(ctx, sessionId) {
      const value = await request(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/ontology-project`,
        accessToken: ctx.accessToken,
      })
      return MossSessionProjectResponseSchema.parse(value).project
    },
    async openReview(ctx, sessionId, epochs) {
      const body = ModelReviewBrowserEpochsSchema.parse(epochs)
      const value = await request(
        ctx.baseUrl,
        {
          method: 'POST',
          path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/ontology-review`,
          accessToken: ctx.accessToken,
          body,
        },
        30_000,
      )
      const parsed = ModelReviewSurfaceSchema.safeParse(value)
      if (!parsed.success || parsed.data.conversationId !== sessionId)
        throw new MossProjectScopeError()
      return parsed.data
    },
  }
}
