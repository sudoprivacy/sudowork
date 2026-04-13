/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useAutoScroll - Auto-scroll hook with user scroll detection.
 *
 * Behavior:
 * - When the user sends a message, scrolls the prompt to the top of the viewport.
 * - When the AI streams output (text or ToolCall), auto-scrolls to the bottom
 *   so the latest content stays visible. This covers both new messages AND
 *   in-place content updates (e.g. long-running tool output that streams into
 *   an existing message), which Virtuoso's native `followOutput` does not handle.
 * - When the user manually scrolls up, auto-follow pauses to preserve their
 *   reading position, and resumes once they scroll back to the bottom.
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

  // Force scroll when user sends a message, or auto-follow AI output (including
  // ToolCall streaming content updates) unless the user has manually scrolled up.
  // 处理用户发送消息 / 跟随 AI 输出（包含 ToolCall 运行时内容更新）
  useEffect(() => {
    const currentListLength = messages.length;
    const prevLength = previousListLengthRef.current;
    const isNewMessage = currentListLength > prevLength;

    previousListLengthRef.current = currentListLength;

    if (!messages.length || itemCount <= 0) return;

    const lastMessage = messages[messages.length - 1];

    // User sent a new message - scroll to show the message at top of viewport.
    // 用户发送消息后将其滚动到视口顶部，方便用户对照自己的输入
    if (isNewMessage && lastMessage?.position === 'right') {
      userScrolledRef.current = false;
      // Use double RAF to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (virtuosoRef.current) {
            lastProgrammaticScrollTimeRef.current = Date.now();
            virtuosoRef.current.scrollToIndex({
              index: itemCount - 1,
              align: 'start',
              behavior: 'auto', // Use auto for immediate positioning
            });
          }
        });
      });
      return;
    }

    // AI output (new message or in-place content update, including ToolCall streaming).
    // Auto-scroll to bottom to keep the latest content visible, unless the user has
    // manually scrolled up — in which case we respect their reading position.
    // 自动滚动到底部以跟随 AI 输出（含 ToolCall 运行时内容更新）；
    // 若用户已手动向上滚动，则保留其阅读位置，不干扰阅读。
    //
    // Note: we intentionally do NOT update lastProgrammaticScrollTimeRef here.
    // Auto-follow always scrolls DOWN (scrollTop increases → delta > 0), so it
    // cannot be misdetected as a user scroll-up in handleScroll. Skipping the
    // guard update keeps user scroll-up detection responsive during high-frequency
    // streaming updates where the guard window would otherwise never close.
    if (!userScrolledRef.current && lastMessage?.position === 'left') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({
              index: itemCount - 1,
              align: 'end',
              behavior: 'auto',
            });
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
