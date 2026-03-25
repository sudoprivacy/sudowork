/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useAutoScroll - Auto-scroll hook with user scroll detection
 * Uses Virtuoso's native followOutput for streaming auto-scroll,
 * only calls scrollToIndex for user-initiated actions (send message, click button).
 *
 * Tool Call Optimization:
 * - Scrolls to top when user sends a message to show tool execution steps
 * - Auto-scrolls to bottom when task completes
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { TMessage } from '@/common/chatLib';

// Ignore scroll events within this window after a programmatic scroll (ms)
const PROGRAMMATIC_SCROLL_GUARD_MS = 150;

interface UseAutoScrollOptions {
  /** Message list for detecting new messages */
  messages: TMessage[];
  /** Total item count for scroll target */
  itemCount: number;
}

interface UseAutoScrollReturn {
  /** Ref to attach to Virtuoso component */
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  /** Scroll event handler for Virtuoso onScroll */
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  /** Virtuoso atBottomStateChange callback */
  handleAtBottomStateChange: (atBottom: boolean) => void;
  /** Virtuoso followOutput callback for streaming auto-scroll */
  handleFollowOutput: (isAtBottom: boolean) => false | 'auto';
  /** Whether to show scroll-to-bottom button */
  showScrollButton: boolean;
  /** Manually scroll to bottom (e.g., when clicking button) */
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
  /** Hide the scroll button */
  hideScrollButton: () => void;
  /** Manually scroll to top (e.g., when user sends message) */
  scrollToTop: (behavior?: 'smooth' | 'auto') => void;
}

export function useAutoScroll({ messages, itemCount }: UseAutoScrollOptions): UseAutoScrollReturn {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Refs for scroll control
  const userScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const previousListLengthRef = useRef(messages.length);
  const lastProgrammaticScrollTimeRef = useRef(0);

  // Scroll to bottom helper - only for user messages and button clicks
  const scrollToBottom = useCallback(
    (behavior: 'smooth' | 'auto' = 'smooth') => {
      if (!virtuosoRef.current) return;

      lastProgrammaticScrollTimeRef.current = Date.now();
      virtuosoRef.current.scrollToIndex({
        index: itemCount - 1,
        behavior,
        align: 'end',
      });
    },
    [itemCount]
  );

  // Scroll to top helper - for when user sends a message
  const scrollToTop = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    if (!virtuosoRef.current) return;

    lastProgrammaticScrollTimeRef.current = Date.now();
    virtuosoRef.current.scrollToIndex({
      index: 0,
      behavior,
      align: 'start',
    });
  }, []);

  // Virtuoso native followOutput - handles streaming auto-scroll internally
  // without external scrollToIndex calls that cause jitter
  const handleFollowOutput = useCallback((isAtBottom: boolean): false | 'auto' => {
    if (userScrolledRef.current || !isAtBottom) return false;
    return 'auto';
  }, []);

  // Reliable bottom state detection from Virtuoso
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setShowScrollButton(!atBottom);

    if (atBottom) {
      userScrolledRef.current = false;
    }
  }, []);

  // Detect user scrolling up
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const currentScrollTop = target.scrollTop;

    // Ignore scroll events shortly after a programmatic scroll to avoid
    // Virtuoso's internal layout adjustments being misdetected as user scroll
    if (Date.now() - lastProgrammaticScrollTimeRef.current < PROGRAMMATIC_SCROLL_GUARD_MS) {
      lastScrollTopRef.current = currentScrollTop;
      return;
    }

    const delta = currentScrollTop - lastScrollTopRef.current;
    if (delta < -10) {
      userScrolledRef.current = true;
    }

    lastScrollTopRef.current = currentScrollTop;
  }, []);

  // Force scroll when user sends a message or task completes
  useEffect(() => {
    const currentListLength = messages.length;
    const prevLength = previousListLengthRef.current;
    const isNewMessage = currentListLength > prevLength;

    previousListLengthRef.current = currentListLength;

    if (!isNewMessage) return;

    const lastMessage = messages[messages.length - 1];

    // User sent a message - scroll to show the message at top of viewport
    // 用户发送消息后滚动到合适位置，保持能看到用户输入，同时展示更多工具执行步骤空间
    if (lastMessage?.position === 'right') {
      userScrolledRef.current = false;
      // Use double RAF to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (virtuosoRef.current) {
            lastProgrammaticScrollTimeRef.current = Date.now();
            // Scroll to show user message at top, keeping it visible
            // 滚动到用户消息位置，使其位于视口顶部但仍可见
            virtuosoRef.current.scrollToIndex({
              index: itemCount - 1,
              align: 'start',
              behavior: 'smooth',
            });
          }
        });
      });
    } else if (lastMessage?.position === 'left' && lastMessage.type !== 'tool_group' && lastMessage.type !== 'acp_tool_call' && lastMessage.type !== 'codex_tool_call') {
      // Assistant final response - scroll to bottom to show completion
      // 助手完成回复后滚动到底部，展示完成状态
      userScrolledRef.current = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (virtuosoRef.current) {
            lastProgrammaticScrollTimeRef.current = Date.now();
            scrollToBottom('auto');
          }
        });
      });
    }
  }, [messages, itemCount]);

  // Hide scroll button handler
  const hideScrollButton = useCallback(() => {
    userScrolledRef.current = false;
    setShowScrollButton(false);
  }, []);

  return {
    virtuosoRef,
    handleScroll,
    handleAtBottomStateChange,
    handleFollowOutput,
    showScrollButton,
    scrollToBottom,
    hideScrollButton,
    scrollToTop,
  };
}
