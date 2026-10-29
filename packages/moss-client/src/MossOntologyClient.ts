import {
  MossOntologyProjectsResponseSchema,
  MossSessionProjectResponseSchema,
  type CanonicalModelProject,
} from '@sudowork/contracts/conversations'
import type { MossCallContext, MossFetch } from './MossHttpClient.js'

export interface MossOntologyPort {
  projects(ctx: MossCallContext): Promise<CanonicalModelProject[]>
  sessionProject(ctx: MossCallContext, sessionId: string): Promise<CanonicalModelProject | null>
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
  }
}
