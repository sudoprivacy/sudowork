import type { TChatConversation } from '@sudowork/common/storage';
import { ProcessConfig } from '@process/initStorage';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';

/** Keep managed conversations bound to the account that created them. */
export function isConversationInCurrentAccount(conversation: TChatConversation): boolean {
  const scope = (conversation.extra as { mossAccountScope?: string } | undefined)?.mossAccountScope;
  const currentScope = ProcessConfig.getSync('eeclaw.accountScope');
  if (isEnterpriseMode() && currentScope) return !!ProcessConfig.getSync('eeclaw.authStorage') && scope === currentScope;
  return !scope;
}

export function assertConversationAccount(conversation: TChatConversation): void {
  if (!isConversationInCurrentAccount(conversation)) throw new Error('Conversation belongs to a different Moss account');
}

/** Persist location and ownership separately from ACP permission modes. */
export function getConversationExecutionExtra(target: 'local' | 'remote'): Record<string, unknown> {
  return {
    executionTarget: target,
    ...(isEnterpriseMode() && ProcessConfig.getSync('eeclaw.accountScope') ? { mossAccountScope: ProcessConfig.getSync('eeclaw.accountScope') } : {}),
  };
}
