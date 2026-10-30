import {
  BrowserOwnerInfoSchema,
  BrowserSessionActionSchema,
  BrowserSessionReplySchema,
  type BrowserOwnerInfo,
  type BrowserSessionAction,
  type BrowserSessionReply,
} from '@sudowork/contracts/browser-session'
import {
  uploadBrowserFile,
  downloadBrowserFile,
  MossHttpError,
  type MossCallContext,
} from '@sudowork/moss-client'
import type { Principal } from '../auth/principalRepository.js'
import { requireAccessibleSession, type ConversationDeps } from './conversationService.js'

/** Browser routes surface the upstream cause instead of the generic MOSS_* rewrite. */
export class BrowserUpstreamError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code)
  }
}

const browserUpstreamCodes = new Map<number, string>([
  [401, 'browser_session_unauthorized'],
  [403, 'browser_session_forbidden'],
  [404, 'browser_session_not_found'],
])

function toBrowserUpstreamError(error: unknown): never {
  if (error instanceof MossHttpError && browserUpstreamCodes.has(error.status)) {
    let mapped: string | undefined
    try {
      const body = JSON.parse(error.bodyText) as { error?: unknown }
      if (typeof body.error === 'string' && /^[a-z_]{1,80}$/.test(body.error)) mapped = body.error
    } catch {
      // Non-JSON upstream bodies fall through to the status mapping.
    }
    throw new BrowserUpstreamError(error.status, mapped ?? browserUpstreamCodes.get(error.status)!)
  }
  throw error
}

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
  const reply = await deps
    .mossFetch(
      ctx.baseUrl,
      {
        method: 'POST',
        path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/browser`,
        accessToken: ctx.accessToken,
        body: input,
      },
      input.kind === 'start' || input.kind === 'restart' ? 90_000 : 30_000,
    )
    .catch(toBrowserUpstreamError)
  const parsed = BrowserSessionReplySchema.parse(reply)
  if (input.kind === 'window-stream' && parsed.stream) {
    const query = new URLSearchParams({
      viewerId: input.viewerId,
      controlEpoch: String(parsed.session.controlEpoch),
      targetEpoch: String(parsed.session.targetEpoch),
    })
    parsed.stream.socketPath = `/ws/browser/${encodeURIComponent(sessionId)}?${query}`
  }
  return parsed
}

/** Read-only: who currently holds this owner's browser profile. */
export async function browserOwnerInfo(
  deps: Pick<ConversationDeps, 'moss' | 'mossFetch'>,
  principal: Principal,
  sessionId: string,
  ctx: MossCallContext,
): Promise<BrowserOwnerInfo> {
  await requireAccessibleSession(deps, principal, sessionId, ctx)
  const reply = await deps
    .mossFetch(
      ctx.baseUrl,
      {
        method: 'GET',
        path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/browser-owner`,
        accessToken: ctx.accessToken,
      },
      30_000,
    )
    .catch(toBrowserUpstreamError)
  return BrowserOwnerInfoSchema.parse(reply)
}

export async function receiveBrowserFile(
  deps: Pick<ConversationDeps, 'moss' | 'mossFetch'>,
  principal: Principal,
  sessionId: string,
  ctx: MossCallContext,
  input: { name: string; controlEpoch: number; targetEpoch: number },
  data: Uint8Array,
) {
  await requireAccessibleSession(deps, principal, sessionId, ctx)
  return uploadBrowserFile(ctx, sessionId, input, data)
}

export async function readBrowserFile(
  deps: Pick<ConversationDeps, 'moss' | 'mossFetch'>,
  principal: Principal,
  sessionId: string,
  ctx: MossCallContext,
  fileId: string,
) {
  await requireAccessibleSession(deps, principal, sessionId, ctx)
  return downloadBrowserFile(ctx, sessionId, fileId)
}
