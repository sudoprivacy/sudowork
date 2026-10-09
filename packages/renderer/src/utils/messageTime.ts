/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Smart message time formatting utilities
 * 智能消息时间格式化工具函数
 *
 * Follows mainstream IM conventions (WeChat/Telegram style):
 * - Shows time separators only when there's a gap between messages
 * - Uses relative time for recent messages (today/yesterday)
 * - Uses absolute date for older messages
 */

/**
 * Minimum gap (in milliseconds) between messages before showing a time separator.
 * Default: 5 minutes
 * 消息间隔超过5分钟才显示时间分隔符
 */
export const MESSAGE_TIME_GAP_MS = 5 * 60 * 1000;

/**
 * Check if a time separator should be shown between two messages.
 * Returns true if the gap between timestamps exceeds MESSAGE_TIME_GAP_MS,
 * or if prevTimestamp is undefined (first message).
 *
 * 判断两条消息之间是否需要显示时间分隔符
 */
export const shouldShowTimeSeparator = (prevTimestamp: number | undefined, currentTimestamp: number | undefined): boolean => {
  if (!currentTimestamp) return false;
  if (prevTimestamp === undefined) return true;
  return currentTimestamp - prevTimestamp >= MESSAGE_TIME_GAP_MS;
};

/**
 * Format a timestamp for message time separator display.
 * Uses smart formatting based on how recent the timestamp is:
 * - Today: "HH:mm" (e.g. "14:30")
 * - Yesterday: "Yesterday HH:mm"
 * - This year: "MM/DD HH:mm" (e.g. "3/15 14:30")
 * - Older: "YYYY/MM/DD HH:mm"
 *
 * 格式化消息时间分隔符显示
 */
export const formatMessageTime = (timestamp: number, locale: string, yesterdayLabel: string): string => {
  const now = new Date();
  const date = new Date(timestamp);

  const timeStr = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (messageDay.getTime() === today.getTime()) {
    // Today: just show time
    return timeStr;
  }

  if (messageDay.getTime() === yesterday.getTime()) {
    // Yesterday
    return `${yesterdayLabel} ${timeStr}`;
  }

  if (date.getFullYear() === now.getFullYear()) {
    // Same year: show month/day + time
    return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }) + ' ' + timeStr;
  }

  // Different year: show full date + time
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }) + ' ' + timeStr;
};

/**
 * Format a timestamp for session/conversation list display.
 * More compact than message time - suitable for sidebar items.
 * - Today: "HH:mm"
 * - Yesterday: "Yesterday"
 * - This week: weekday name (e.g. "Mon")
 * - This year: "MM/DD"
 * - Older: "YYYY/MM/DD"
 *
 * 格式化会话列表的时间显示（更紧凑）
 */
export const formatSessionTime = (timestamp: number, locale: string, yesterdayLabel: string): string => {
  if (!timestamp) return '';

  const now = new Date();
  const date = new Date(timestamp);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (messageDay.getTime() === today.getTime()) {
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  if (messageDay.getTime() === yesterday.getTime()) {
    return yesterdayLabel;
  }

  // Within 7 days: show weekday
  const daysDiff = Math.floor((today.getTime() - messageDay.getTime()) / (24 * 60 * 60 * 1000));
  if (daysDiff < 7) {
    return date.toLocaleDateString(locale, { weekday: 'short' });
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  }

  return date.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' });
};
