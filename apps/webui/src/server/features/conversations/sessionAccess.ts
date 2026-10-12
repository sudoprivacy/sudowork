import type { MossSessionSummary } from '@sudowork/contracts/conversations'
import type { Principal } from '../auth/principalRepository.js'

/** Moss verifies current permission first; this restricts the shared workbench to its intended actor. */
export function isSessionAccessible(
  session: MossSessionSummary,
  principal: Pick<Principal, 'mossUserId' | 'orgId'>,
): boolean {
  return (
    session.orgId === principal.orgId &&
    (session.userId === principal.mossUserId ||
      (session.source === 'agent-manager' &&
        session.clientMetadata?.agent_manager_actor_id === principal.mossUserId))
  )
}
