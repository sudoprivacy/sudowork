import React, { type PropsWithChildren } from 'react';

/**
 * Safety Chat Confirm Component
 *
 * Wraps chat input components and blocks them when safety risks are detected.
 *
 * Usage:
 * ```tsx
 * <SafetyChatConfirm conversation_id={conversation_id}>
 *   <ConversationChatConfirm conversation_id={conversation_id}>
 *     <SendBoxComponent />
 *   </ConversationChatConfirm>
 * </SafetyChatConfirm>
 * ```
 */
export function SafetyChatConfirm({ children }: PropsWithChildren<ISafetyChatConfirmProps>) {
  // Safety hooks are temporarily disabled; keep the wrapper as a restore point.
  return <>{children}</>;
}

interface ISafetyChatConfirmProps {
  conversation_id?: string;
}
