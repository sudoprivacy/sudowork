/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Timeline utility functions for conversation history grouping
 * 会话历史分组的时间线工具函数
 */

import type { TChatConversation } from '@/common/storage';

/**
 * Get the activity time (most recent) from a conversation
 * 获取会话的活动时间（最近的时间）
 */
export const getActivityTime = (conversation: TChatConversation): number => {
  return conversation.modifyTime || conversation.createTime || 0;
};
