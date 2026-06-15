/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Timeline utility functions for conversation history grouping
 * 会话历史分组的时间线工具函数
 */

import type { TChatConversation } from '@/common/storage';

/**
 * Calculate the difference in days between two timestamps
 * 计算两个时间戳之间的天数差
 */
export const diffDay = (time1: number, time2: number): number => {
  const date1 = new Date(time1);
  const date2 = new Date(time2);
  const ymd1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const ymd2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
  const diff = Math.abs(ymd2.getTime() - ymd1.getTime());
  return diff / (1000 * 60 * 60 * 24);
};

/**
 * Get the activity time (most recent) from a conversation
 * 获取会话的活动时间（最近的时间）
 */
export const getActivityTime = (conversation: TChatConversation): number => {
  return conversation.modifyTime || conversation.createTime || 0;
};

/**
 * Get the timeline label for a given timestamp
 * 获取给定时间戳的时间线标签
 *
 * @param time - The timestamp to check
 * @param currentTime - The current timestamp (usually Date.now())
 * @param t - The i18n translation function
 */
export const getTimelineLabel = (time: number, currentTime: number, t: (key: string) => string): string => {
  const daysDiff = diffDay(currentTime, time);

  if (daysDiff === 0) return t('conversation.history.today');
  if (daysDiff === 1) return t('conversation.history.yesterday');
  if (daysDiff < 7) return t('conversation.history.recent7Days');
  return t('conversation.history.earlier');
};
