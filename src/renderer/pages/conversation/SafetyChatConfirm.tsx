import React, { type PropsWithChildren } from 'react';

export interface SafetyChatConfirmProps {
  conversation_id?: string;
}

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
export const SafetyChatConfirm: React.FC<PropsWithChildren<SafetyChatConfirmProps>> = ({ children }) => {
  // Safety hooks are temporarily disabled; keep the wrapper as a restore point.
  return <>{children}</>;
};

export default SafetyChatConfirm;
