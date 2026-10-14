import {
  BrowserSessionActionSchema,
  BrowserSessionReplySchema,
  type BrowserSessionAction,
  type BrowserSessionReply,
} from '@sudowork/contracts/browser-session'
import type { MossCallContext } from '@sudowork/moss-client'
import type { Principal } from '../auth/principalRepository.js'
import { requireAccessibleSession, type ConversationDeps } from './conversationService.js'

/** Revalidate session ownership before every browser operation, including frames. */
export async function invokeBrowserSession(
  deps: Pick<ConversationDeps, 'moss' | 'mossFetch'>,
  principal: Principal,
  sessionId: string,
  ctx: MossCallContext,
  action: BrowserSessionAction,
): Promise<BrowserSessionReply> {
  const input = BrowserSessionActionSchema.parse(action)
  await requireAccessibleSession(deps, principal, sessionId, ctx)
  const reply = await deps.mossFetch(
    ctx.baseUrl,
    {
      method: 'POST',
      path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/browser`,
      accessToken: ctx.accessToken,
      body: input,
    },
    30_000,
  )
  return BrowserSessionReplySchema.parse(reply)
}
