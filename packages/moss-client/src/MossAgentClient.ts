import { z } from 'zod'
import type { IMyAgent, IUserAgent } from '@sudowork/common/personalAgents'
import type { MossRequest } from './MossHttpClient.js'

export type MossAgentRequest = Pick<MossRequest, 'method' | 'path' | 'body'>
export type MossAgentFetch = (request: MossAgentRequest) => Promise<unknown>

export interface MossAgentPort {
  listMine(): Promise<IMyAgent[]>
  createOwned(input: unknown): Promise<IUserAgent>
}

const agentsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(
    z.object({
      ref: z.string().min(1),
      displayName: z.string(),
      kind: z.enum(['default', 'own', 'template']),
    }),
  ),
})
const createAgentSchema = z.object({ displayName: z.string().trim().min(1).max(60) }).strict()
const createdAgentResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    displayName: z.string().min(1),
    createdAt: z.number(),
  }),
})

/** Share the Agent contract while the host supplies its authenticated transport. */
export function createMossAgentPort(fetchAgent: MossAgentFetch): MossAgentPort {
  return {
    async listMine() {
      const response = await fetchAgent({ method: 'GET', path: '/api/v1/agents/mine' })
      return agentsResponseSchema.parse(response).data
    },
    async createOwned(input) {
      const body = createAgentSchema.parse(input)
      const response = await fetchAgent({ method: 'POST', path: '/api/v1/user-agents', body })
      return createdAgentResponseSchema.parse(response).data
    },
  }
}
