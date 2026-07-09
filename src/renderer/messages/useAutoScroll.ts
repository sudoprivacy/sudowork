/**
 * useAutoScroll - Auto-scroll hook with user scroll detection and a dynamic
 * bottom spacer that pins the latest user prompt to the top of the viewport.
 *
 * Behavior (see #345):
 * - When the user sends a message, the message is pinned to the top of the
 *   viewport and a "bottom spacer" is reserved below the last rendered item so
 *   the viewport under the prompt is initially empty — giving the upcoming AI
 *   response a full viewport of "canvas" to stream into, similar to ChatGPT /
 *   Claude.ai. The spacer shrinks 1:1 as the AI streams content, so the prompt
 *   stays pinned at the top while content fills the empty area below it.
 * - Once the turn's content (user prompt + AI output) reaches the viewport
 *   height, the spacer collapses to 0 and auto-follow resumes — the prompt is
 *   then free to scroll off the top as we keep the latest AI output in view.
 * - In idle state (no active turn, or the current turn has already overflowed
 *   the viewport) the spacer is 0 and the list behaves like a regular chat log.
 * - When the user manually scrolls up, auto-follow pauses so their reading
 *   position is preserved; it resumes once they scroll back to the bottom.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { TMessage } from '@/common/chatLib';

// Ignore scroll events within this window after a programmatic scroll (ms)
const PROGRAMMATIC_SCROLL_GUARD_MS = 150;

/**
 * Baseline breathing room between the last rendered message and the SendBox
 * that sits below the message list. This is applied as a static Footer height
 * outside of `bottomSpacerHeight`, so the spacer itself can cleanly go to 0 in
 * idle state without the last message's bottom border being clipped against
 * the input box.
 */
export const BOTTOM_BUFFER_PX = 40;

interface UseAutoScrollOptions {
  /** Message list for detecting new messages */
  messages: TMessage[];
  /** Total items in the rendered list (including summaries/separators) */
  items: any[];
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
  /** Virtuoso scrollerRef callback — lets us measure the viewport for spacer sizing */
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
   * Extra bottom padding (on top of BOTTOM_BUFFER_PX) that keeps the user's
   * latest prompt pinned to the top of the viewport while the AI streams into
   * the empty area below. 0 in idle state.
   */
  bottomSpacerHeight: number;
}

export function useAutoScroll({ messages, items }: UseAutoScrollOptions): UseAutoScrollReturn {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [bottomSpacerHeight, setBottomSpacerHeight] = useState(0);

  const itemCount = items.length;

  // Refs for scroll control
  const userScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const previousListLengthRef = useRef(messages.length);
  const lastProgrammaticScrollTimeRef = useRef(0);
  const bottomStateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAtBottomRef = useRef(true);

  // Turn-mode refs — track the "pin user prompt to top" state.
  const turnStartMsgIdRef = useRef<string | null>(null);
  const isPinnedRef = useRef(false);
  /**
   * Mirrors `bottomSpacerHeight` state so `recomputeSpacer` can reason about
   * the current spacer without reading stale state. Updating the state inside
   * `recomputeSpacer` would otherwise feed back into `scrollHeight`, creating
   * a circular dependency.
   */
  const spacerHeightRef = useRef(0);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const viewportHeightRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const resetTurnMode = useCallback(() => {
    turnStartMsgIdRef.current = null;
    isPinnedRef.current = false;
    if (spacerHeightRef.current !== 0) {
      spacerHeightRef.current = 0;
      setBottomSpacerHeight(0);
    }
  }, []);

  /**
   * Recompute the bottom spacer so the user prompt can reach the top of the
   * viewport with the "empty canvas" effect below it.
   *
   *   spacer = max(0, viewportHeight - heightOfContentSinceTurnStart)
   *
   * Where heightOfContentSinceTurnStart is the distance from the top of the
   * user-prompt element to the bottom of the last rendered item (excluding the
   * spacer itself and the static BOTTOM_BUFFER_PX Footer). As the AI streams
   * more content, the second term grows and the spacer shrinks 1:1, so the
   * prompt stays pinned at the top until the turn's content fills the viewport.
   *
   * Once the spacer collapses to 0, we clear `isPinnedRef` so auto-follow can
   * resume — the prompt is then free to scroll off the top as we keep the
   * latest AI output in view.
   */
  const recomputeSpacer = useCallback(() => {
    const scroller = scrollerElRef.current;
    const vh = viewportHeightRef.current;
    const turnMsgId = turnStartMsgIdRef.current;

    if (!turnMsgId || !scroller || vh <= 0) {
      if (spacerHeightRef.current !== 0) {
        spacerHeightRef.current = 0;
        setBottomSpacerHeight(0);
      }
      isPinnedRef.current = false;
      return;
    }

    // `CSS.escape` may not exist in all test environments — fall back to a
    // naive quote escape for IDs that don't contain special characters.
    const escapeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(turnMsgId) : turnMsgId.replace(/"/g, '\\"');

    // Optimization: avoid querying DOM on every render if possible
    // but we need the latest position for accurate spacer calculation
    const userEl = scroller.querySelector(`[data-message-id="${escapeId}"]`) as HTMLElement | null;
    if (!userEl) {
      // The user prompt is no longer rendered (either virtualized off-screen
      // because the turn overflowed, or the conversation was swapped out).
      // Either way, no spacer is needed anymore.
      if (spacerHeightRef.current !== 0) {
        spacerHeightRef.current = 0;
        setBottomSpacerHeight(0);
      }
      isPinnedRef.current = false;
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const userRect = userEl.getBoundingClientRect();
    // Offset of the user prompt's top within the scroll content.
    const userOffsetInScroll = userRect.top - scrollerRect.top + scroller.scrollTop;

    // scrollHeight includes both the current spacer and the static footer
    // buffer, so subtract them to get the content height without padding.
    const footerHeight = BOTTOM_BUFFER_PX + spacerHeightRef.current;
    const turnContent = Math.max(0, scroller.scrollHeight - footerHeight - userOffsetInScroll);

    // Ensure we don't have a negative spacer and leave some buffer
    const desiredSpacer = Math.max(0, vh - turnContent - 10);

    if (Math.abs(desiredSpacer - spacerHeightRef.current) >= 1) {
      spacerHeightRef.current = desiredSpacer;
      setBottomSpacerHeight(desiredSpacer);
    }

    // When the turn content has filled the viewport there is nothing left to
    // pin — let auto-follow take over.
    if (desiredSpacer === 0) {
      isPinnedRef.current = false;
    }
  }, []);

  // Virtuoso calls this with the scroll container (an HTMLElement) or null on
  // unmount / remount. We use it to measure the viewport for spacer sizing.
  const handleScrollerRef = useCallback(
    (ref: HTMLElement | Window | null) => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      const el = ref instanceof HTMLElement ? ref : null;
      scrollerElRef.current = el;
      if (!el) return;

      viewportHeightRef.current = el.clientHeight;

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            viewportHeightRef.current = (entry.target as HTMLElement).clientHeight;
          }
          recomputeSpacer();
        });
        ro.observe(el);
        resizeObserverRef.current = ro;
      }

      recomputeSpacer();
    },
    [recomputeSpacer]
  );

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (bottomStateDebounceRef.current) {
        clearTimeout(bottomStateDebounceRef.current);
        bottomStateDebounceRef.current = null;
      }
    };
  }, []);

  // Scroll to absolute bottom of the scroller. Using `scrollTo` (not
  // `scrollToIndex({ align: 'end' })`) keeps the static BOTTOM_BUFFER_PX footer
  // visible at the bottom of the viewport, preventing the last message's
  // bottom border from being clipped against the SendBox below.
  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    if (!virtuosoRef.current) return;

    lastProgrammaticScrollTimeRef.current = Date.now();
    virtuosoRef.current.scrollTo({
      top: Number.MAX_SAFE_INTEGER,
      behavior,
    });
  }, []);

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
  // without external scrollToIndex calls that cause jitter. Disabled while we
  // are pinning the user prompt at the top, so the empty spacer below gets
  // filled instead of scrolling the prompt off the screen.
  const handleFollowOutput = useCallback((isAtBottom: boolean): false | 'auto' => {
    if (userScrolledRef.current || !isAtBottom) return false;
    if (isPinnedRef.current) return false;

    // Always follow output when aiProcessing is active and we are near bottom
    return 'auto';
  }, []);

  // Reliable bottom state detection from Virtuoso
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    lastAtBottomRef.current = atBottom;
    if (bottomStateDebounceRef.current) {
      clearTimeout(bottomStateDebounceRef.current);
    }
    bottomStateDebounceRef.current = setTimeout(() => {
      if (lastAtBottomRef.current !== atBottom) return;
      setShowScrollButton(!atBottom);
      if (atBottom) {
        userScrolledRef.current = false;
      }
      bottomStateDebounceRef.current = null;
    }, 80);
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
  // ToolCall streaming content updates) unless the user has manually scrolled
  // up or we're currently pinning the user prompt at the top.
  useEffect(() => {
    const currentListLength = messages.length;
    const prevLength = previousListLengthRef.current;
    const isNewMessage = currentListLength > prevLength;

    previousListLengthRef.current = currentListLength;

    if (!messages.length || itemCount <= 0) {
      // Conversation cleared — drop any stale turn state.
      resetTurnMode();
      return;
    }

    const lastMessage = messages[messages.length - 1];

    // User sent a new message - pin it to the top of the viewport and reserve a
    // viewport-tall spacer below so the AI has an empty canvas to stream into.
    // We only enter pinned mode when we actually have a scroller to measure —
    // in headless / test environments without a scroller we preserve the old
    // "just scroll to top" behavior.
    if (isNewMessage && lastMessage?.position === 'right') {
      userScrolledRef.current = false;

      // Find the index of the newly added user message in the items array
      // This is necessary because separators or turn actions might have been added
      // We search from the end for efficiency
      const lastUserMsgIdx = items.findLastIndex((item) => (item as any).msg_id === lastMessage.msg_id && (item as any).position === 'right');
      const targetIdx = lastUserMsgIdx !== -1 ? lastUserMsgIdx : items.length - 1;

      // Reset scroll position to top when starting a new turn to avoid overflow issues
      // with the dynamic spacer recomputation
      virtuosoRef.current?.scrollTo({ top: 0, behavior: 'auto' });

      const vh = viewportHeightRef.current;
      const canPin = vh > 0 && scrollerElRef.current !== null;
      if (canPin) {
        turnStartMsgIdRef.current = lastMessage.id;
        isPinnedRef.current = true;
        // Seed the spacer at full viewport height so the user prompt can
        // actually reach the top on the first scrollToIndex call. The next
        // recompute (after layout settles) will refine it to the exact value.
        if (spacerHeightRef.current !== vh) {
          spacerHeightRef.current = vh;
          setBottomSpacerHeight(vh);
        }
      }

      // Use double RAF to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (virtuosoRef.current) {
            lastProgrammaticScrollTimeRef.current = Date.now();
            virtuosoRef.current.scrollToIndex({
              index: targetIdx,
              align: 'start',
              behavior: 'auto', // Use auto for immediate positioning
            });

            // Recompute spacer after initial scroll to ensure user message is pinned
            if (canPin) {
              setTimeout(() => {
                recomputeSpacer();
              }, 100);
            }
          }
        });
      });
      return;
    }

    // AI output (new message or in-place content update, including ToolCall
    // streaming). First, keep the spacer in sync with the new content so we
    // can correctly decide whether to stay pinned or resume auto-follow.
    if (turnStartMsgIdRef.current) {
      // Small delay to ensure React Virtuoso has updated the DOM with new items
      // before we measure for the spacer
      const timer = setTimeout(() => {
        recomputeSpacer();
      }, 50);
      return () => clearTimeout(timer);
    }

    // While pinned we intentionally do NOT auto-scroll — the user prompt needs
    // to stay at the top, and the AI content fills the empty spacer below.
    // Once the turn overflows the viewport, `recomputeSpacer` clears
    // `isPinnedRef` and subsequent updates fall through to the follow branch.
    if (isPinnedRef.current) return;
  }, [messages, itemCount, items, recomputeSpacer, resetTurnMode]);

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
    handleScrollerRef,
    showScrollButton,
    scrollToBottom,
    hideScrollButton,
    scrollToTop,
    bottomSpacerHeight,
  };
}
