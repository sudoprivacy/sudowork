/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useAutoScroll - Auto-scroll hook with user scroll detection.
 *
 * Behavior:
 * - When the user sends a message, scrolls the prompt to the top of the viewport
 *   AND reserves a viewport-tall blank area below it so the message can actually
 *   reach the top (Virtuoso clamps `scrollToIndex` to the available scroll
 *   range, so the bottom spacer is what lets the latest item travel up). This
 *   recreates the "fresh chat" feel after every send: user prompt at top, empty
 *   space below for the AI response to fill into.
 * - When the AI streams output (text or ToolCall), auto-follows by aligning the
 *   bottom of the last message just above the SendBox, using `scrollToIndex`
 *   (not `scrollTo({ top: MAX })`) so we don't expose the empty bottom spacer
 *   that exists to support the user-message-at-top behavior. A small negative
 *   `offset` keeps a visual buffer between the last message's bottom border and
 *   the input box below.
 * - When the user manually scrolls up, auto-follow pauses to preserve their
 *   reading position, and resumes once they scroll back near the latest
 *   message (Virtuoso's `atBottomThreshold` is widened by the spacer height so
 *   "at bottom" means "near the last message", not "near the empty spacer's
 *   bottom").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListRange, VirtuosoHandle } from 'react-virtuoso';
import type { TMessage } from '@/common/chatLib';

// Ignore scroll events within this window after a programmatic scroll (ms)
const PROGRAMMATIC_SCROLL_GUARD_MS = 150;

// Visual gap kept between the last message's bottom border and the SendBox
// when auto-following AI output. Replaces the role of the previous fixed
// 40px Footer-as-buffer trick.
// 自动跟随 AI 输出时，最后一条消息底边与下方 SendBox 之间保留的视觉缓冲。
export const BOTTOM_BUFFER_PX = 40;

// Fallback bottom spacer height used until we measure the scroller's height.
const FALLBACK_BOTTOM_SPACER_PX = 40;

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
  /** Virtuoso rangeChanged callback — used to track which items are visible */
  handleRangeChanged: (range: ListRange) => void;
  /** Virtuoso scrollerRef callback — used to measure viewport height */
  handleScrollerRef: (ref: HTMLElement | Window | null) => void;
  /** Whether to show scroll-to-bottom button */
  showScrollButton: boolean;
  /** Manually scroll to bottom (e.g., when clicking button) */
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
  /** Hide the scroll button */
  hideScrollButton: () => void;
  /** Manually scroll to top (e.g., when user sends message) */
  scrollToTop: (behavior?: 'smooth' | 'auto') => void;
  /**
   * Height (px) for the bottom spacer rendered as Virtuoso's Footer. Equal to
   * the scroller's visible height so the last message can be scrolled all the
   * way to the top of the viewport, leaving a viewport-tall empty area below
   * for the AI response to stream into.
   * Footer 高度（px），等于滚动容器可视高度，用于让最后一条消息可以滚动到视口顶端。
   */
  bottomSpacerHeight: number;
}

export function useAutoScroll({ messages, itemCount }: UseAutoScrollOptions): UseAutoScrollReturn {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 });
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;

  const [showScrollButton, setShowScrollButton] = useState(false);
  const [bottomSpacerHeight, setBottomSpacerHeight] = useState<number>(FALLBACK_BOTTOM_SPACER_PX);
  const bottomSpacerHeightRef = useRef(FALLBACK_BOTTOM_SPACER_PX);

  // Refs for scroll control
  const userScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const previousListLengthRef = useRef(messages.length);
  const lastProgrammaticScrollTimeRef = useRef(0);

  const updateSpacerHeight = useCallback((nextHeight: number) => {
    const clamped = Math.max(FALLBACK_BOTTOM_SPACER_PX, Math.round(nextHeight));
    if (Math.abs(clamped - bottomSpacerHeightRef.current) < 1) return;
    bottomSpacerHeightRef.current = clamped;
    setBottomSpacerHeight(clamped);
  }, []);

  // Wire up Virtuoso's scrollerRef so we can measure the visible viewport
  // height (drives bottom spacer sizing) and read scrollTop/scrollHeight when
  // deciding whether AI output overflows the viewport.
  // 注入 Virtuoso 的 scrollerRef 以测量可视高度（决定底部留白尺寸），
  // 并在判断 AI 输出是否超出视口时读取 scrollTop / scrollHeight。
  const handleScrollerRef = useCallback(
    (ref: HTMLElement | Window | null) => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (ref instanceof HTMLElement) {
        scrollerElRef.current = ref;
        updateSpacerHeight(ref.clientHeight);
        if (typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(() => {
            updateSpacerHeight(ref.clientHeight);
          });
          ro.observe(ref);
          resizeObserverRef.current = ro;
        }
      } else {
        scrollerElRef.current = null;
      }
    },
    [updateSpacerHeight]
  );

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  // Track the visible item range so we know whether the last message is on
  // screen. Used to decide if the AI auto-follow scroll is needed at all
  // (when the AI message already fits in the viewport, leave the layout alone
  // so the user prompt stays at the top).
  // 跟踪可见 item 区间，以判断最后一条消息是否在视口内：当 AI 消息仍然完整可见时
  // 不再触发跟随滚动，让用户消息继续保持在顶端。
  const handleRangeChanged = useCallback((range: ListRange) => {
    lastRangeRef.current = range;
  }, []);

  // True when the bottom of the last message has scrolled below the visible
  // viewport — i.e., we need to follow it down to keep the latest content in
  // sight.
  const lastMessageOverflowsViewport = useCallback(() => {
    const el = scrollerElRef.current;
    if (!el) return true; // No measurement available — fall back to scrolling.
    const meaningfulBottom = el.scrollHeight - bottomSpacerHeightRef.current;
    const visibleBottom = el.scrollTop + el.clientHeight;
    return meaningfulBottom > visibleBottom + 4; // 4px tolerance
  }, []);

  // Scroll so that the last message's bottom sits BOTTOM_BUFFER_PX above the
  // SendBox. Uses scrollToIndex (not `scrollTo({ top: MAX })`) so the empty
  // bottom spacer below the message is not exposed in the viewport.
  // 使用 scrollToIndex 滚动到最后一条消息的底端，避免暴露下方空白 spacer。
  const scrollToBottom = useCallback(
    (behavior: 'smooth' | 'auto' = 'smooth') => {
      if (!virtuosoRef.current || itemCount <= 0) return;

      lastProgrammaticScrollTimeRef.current = Date.now();
      virtuosoRef.current.scrollToIndex({
        index: itemCount - 1,
        align: 'end',
        behavior,
        offset: -BOTTOM_BUFFER_PX,
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

  // Reliable bottom state detection from Virtuoso. With our enlarged
  // `atBottomThreshold` (spacer + buffer) on the Virtuoso component, "at
  // bottom" semantically means "the last message is in view", not "scrolled
  // past the empty spacer".
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

    // User sent a new message — scroll to show the message at the top of the
    // viewport, leaving the bottom spacer (≈ viewport height) below it as a
    // blank canvas for the AI response. This is what gives every turn the
    // "fresh chat" feel: user's prompt pinned to the top, empty room below.
    // 用户发送消息后将其滚动到视口顶部，下方保留整屏空白用于显示 AI 回复，
    // 让每一轮对话都呈现"初始状态"般的视觉体验。
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

    // AI output (new message or in-place content update, including ToolCall
    // streaming). Only scroll when the latest content has actually grown past
    // the visible viewport — while the AI response still fits in the empty
    // space we reserved below the user's prompt, leave the layout alone so
    // the user's prompt stays pinned at the top (similar to ChatGPT/Claude.ai).
    //
    // Use scrollToIndex (not `scrollTo({ top: MAX })`) so we don't scroll past
    // the last message into the empty bottom spacer. The negative `offset`
    // keeps a small visual buffer between the message's bottom border and
    // the SendBox below.
    //
    // 跟随 AI 输出：仅在最新内容已超出视口时才滚动，未超出时保持用户消息在顶端，
    // 让 AI 回复在用户消息下方的空白区域里逐步填充，复刻类 ChatGPT 的对话体验。
    // 使用 scrollToIndex（而非滚动到容器底部），避免暴露下方为用户消息预留的空白；
    // 通过 offset 在最后一条消息底边与 SendBox 之间保留视觉缓冲。
    if (!userScrolledRef.current && lastMessage?.position === 'left') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!virtuosoRef.current) return;
          if (!lastMessageOverflowsViewport()) return;
          virtuosoRef.current.scrollToIndex({
            index: itemCount - 1,
            align: 'end',
            behavior: 'auto',
            offset: -BOTTOM_BUFFER_PX,
          });
        });
      });
    }
  }, [messages, itemCount, lastMessageOverflowsViewport]);

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
    handleRangeChanged,
    handleScrollerRef,
    showScrollButton,
    scrollToBottom,
    hideScrollButton,
    scrollToTop,
    bottomSpacerHeight,
  };
}
