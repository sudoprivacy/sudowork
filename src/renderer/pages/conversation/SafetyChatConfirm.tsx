/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { useSafetyCheck } from '../../hooks/useSafetyCheck';

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
  const { hasEvent } = useSafetyCheck();

  return (
    <>
      {/* Chat input area - hidden when event is detected */}
      {hasEvent ? null : children}
    </>
  );
};

export default SafetyChatConfirm;
