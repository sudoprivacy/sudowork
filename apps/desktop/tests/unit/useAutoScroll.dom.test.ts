/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { BOTTOM_BUFFER_PX, useAutoScroll } from '../../src/renderer/messages/useAutoScroll';
import type { TMessage, IMessageText, IMessageToolGroup } from '@sudowork/common/chatLib';

// Mock VirtuosoHandle
const createMockVirtuosoHandle = () => ({
  scrollToIndex: vi.fn(),
  scrollTo: vi.fn(),
  scrollBy: vi.fn(),
  getState: vi.fn(),
  autoscrollToBottom: vi.fn(),
});

describe('useAutoScroll - scroll to bottom on message send (#977)', () => {
  let mockVirtuosoHandle: ReturnType<typeof createMockVirtuosoHandle>;

  beforeEach(() => {
    mockVirtuosoHandle = createMockVirtuosoHandle();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const createMessage = (position: 'left' | 'right', id: string): IMessageText => ({
    id,
    msg_id: id,
    type: 'text',
    position,
    conversation_id: 'test-conv',
    content: { content: 'test message' },
    createdAt: Date.now(),
  });

  it('should scroll to show user message when user sends a message (position=right)', async () => {
    const initialMessages: TMessage[] = [createMessage('left', '1'), createMessage('right', '2')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: initialMessages, itemCount: 2 } });

    // Manually set the ref to mock Virtuoso
    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    // Add a new user message (position=right)
    const newMessages: TMessage[] = [...initialMessages, createMessage('right', '3')];

    rerender({ messages: newMessages, itemCount: 3 });

    // Wait for double RAF
    await act(async () => {
      vi.runAllTimers();
    });

    // Should scroll to show user message at top of viewport
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 2, // itemCount - 1
        behavior: 'auto',
        align: 'start',
      })
    );
  });

  it('should scroll to absolute bottom when AI responds with text message (position=left)', async () => {
    const initialMessages: TMessage[] = [createMessage('right', '1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: initialMessages, itemCount: 1 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    // Add AI response (position=left, type=text)
    const newMessages: TMessage[] = [...initialMessages, createMessage('left', '2')];

    rerender({ messages: newMessages, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // AI output auto-follows to the bottom via Virtuoso's followOutput (returns
    // 'auto' when the user is at the bottom and hasn't scrolled up). #977 replaced
    // the explicit scrollTo({ top: MAX }) with followOutput + a bottom spacer, so
    // the last message's bottom border stays clear of the SendBox without jitter.
    expect(result.current.handleFollowOutput(true)).toBe('auto');
    expect(result.current.handleFollowOutput(false)).toBe(false);
  });

  it('should reset userScrolled flag when user sends message', async () => {
    const initialMessages: TMessage[] = [createMessage('left', '1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: initialMessages, itemCount: 1 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    // Simulate user scrolling up
    act(() => {
      const mockEvent = {
        target: { scrollTop: 0 },
      } as unknown as React.UIEvent<HTMLDivElement>;

      // First set a high scroll position
      result.current.handleScroll({
        target: { scrollTop: 500 },
      } as unknown as React.UIEvent<HTMLDivElement>);

      // Then scroll up (delta < -10)
      result.current.handleScroll(mockEvent);
    });

    // Add user message - should force scroll
    const newMessages: TMessage[] = [...initialMessages, createMessage('right', '2')];

    rerender({ messages: newMessages, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // Should still scroll because user sent a message
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalled();
  });

  it('should show scroll button when not at bottom', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: [], itemCount: 0 } });

    // Initially hidden
    expect(result.current.showScrollButton).toBe(false);

    // Simulate not at bottom (bottom-state changes are debounced ~80ms to avoid flicker)
    act(() => {
      result.current.handleAtBottomStateChange(false);
      vi.advanceTimersByTime(80);
    });

    expect(result.current.showScrollButton).toBe(true);

    // Back to bottom
    act(() => {
      result.current.handleAtBottomStateChange(true);
      vi.advanceTimersByTime(80);
    });

    expect(result.current.showScrollButton).toBe(false);
  });

  it('should provide scrollToBottom function that scrolls to absolute bottom', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: [], itemCount: 5 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    act(() => {
      result.current.scrollToBottom('smooth');
    });

    // scrollToBottom uses scrollTo so the Footer (bottom buffer) is visible at
    // the bottom of the viewport, keeping the last message clear of the SendBox.
    expect(mockVirtuosoHandle.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: Number.MAX_SAFE_INTEGER,
        behavior: 'smooth',
      })
    );
  });

  it('should handle followOutput correctly based on scroll state', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: [], itemCount: 0 } });

    // When at bottom and not user-scrolled, should return 'auto'
    expect(result.current.handleFollowOutput(true)).toBe('auto');

    // When not at bottom, should return false
    expect(result.current.handleFollowOutput(false)).toBe(false);
  });
});

describe('useAutoScroll - tool call auto-follow (#306)', () => {
  let mockVirtuosoHandle: ReturnType<typeof createMockVirtuosoHandle>;

  beforeEach(() => {
    mockVirtuosoHandle = createMockVirtuosoHandle();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const createTextMessage = (position: 'left' | 'right', id: string): IMessageText => ({
    id,
    msg_id: id,
    type: 'text',
    position,
    conversation_id: 'test-conv',
    content: { content: 'test message' },
    createdAt: Date.now(),
  });

  const createToolGroupMessage = (id: string, description = 'running'): IMessageToolGroup => ({
    id,
    msg_id: id,
    type: 'tool_group',
    position: 'left',
    conversation_id: 'test-conv',
    content: [
      {
        callId: `call-${id}`,
        description,
        name: 'run_shell_command',
        renderOutputAsMarkdown: false,
        status: 'Executing',
      },
    ],
    createdAt: Date.now(),
  });

  it('should auto-scroll to absolute bottom when a tool_group message is appended', async () => {
    const initial: TMessage[] = [createTextMessage('right', 'u1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: initial, itemCount: 1 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    // Flush the scroll-to-top that happens on user send so we can assert on the
    // tool-call scroll independently.
    await act(async () => {
      vi.runAllTimers();
    });
    mockVirtuosoHandle.scrollToIndex.mockClear();
    mockVirtuosoHandle.scrollTo.mockClear();

    // AI now starts a tool call — this is a NEW left-position message.
    const withTool: TMessage[] = [...initial, createToolGroupMessage('t1')];
    rerender({ messages: withTool, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // Tool-call output auto-follows to the bottom via followOutput (see #977),
    // keeping the message clear of the SendBox without an explicit scrollTo.
    expect(result.current.handleFollowOutput(true)).toBe('auto');
    expect(result.current.handleFollowOutput(false)).toBe(false);
  });

  it('should auto-scroll on in-place tool_group content updates (streaming output)', async () => {
    const userMsg = createTextMessage('right', 'u1');
    const initial: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: initial, itemCount: 2 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    await act(async () => {
      vi.runAllTimers();
    });
    mockVirtuosoHandle.scrollToIndex.mockClear();
    mockVirtuosoHandle.scrollTo.mockClear();

    // Tool call content grows in place (same length, same id, new reference).
    // This simulates streaming stdout where only the last message's content updates.
    const updated: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1\nstep 2\nstep 3')];
    rerender({ messages: updated, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // In-place streaming updates keep auto-following via followOutput so the tool
    // call message's bottom border stays clear of the SendBox during streaming.
    expect(result.current.handleFollowOutput(true)).toBe('auto');
    // Regression guard: AI follow must NOT use scrollToIndex({ align: 'end' }) —
    // that aligns the message bottom flush with the viewport bottom, clipping the
    // bottom border against the SendBox.
    expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('should NOT auto-scroll during tool call streaming if user scrolled up', async () => {
    const userMsg = createTextMessage('right', 'u1');
    const initial: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: initial, itemCount: 2 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    await act(async () => {
      vi.runAllTimers();
    });
    mockVirtuosoHandle.scrollToIndex.mockClear();
    mockVirtuosoHandle.scrollTo.mockClear();

    // Simulate user scrolling up: first establish a high scrollTop, then scroll up by > 10px.
    // The programmatic-scroll guard is 150ms; advance past it first.
    act(() => {
      vi.advanceTimersByTime(200);
      result.current.handleScroll({ target: { scrollTop: 500 } } as unknown as React.UIEvent<HTMLDivElement>);
      result.current.handleScroll({ target: { scrollTop: 100 } } as unknown as React.UIEvent<HTMLDivElement>);
    });

    // Tool output streams in — should NOT auto-scroll because user is reading history
    const updated: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1\nstep 2')];
    rerender({ messages: updated, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled();
    expect(mockVirtuosoHandle.scrollTo).not.toHaveBeenCalled();
  });

  it('should resume auto-scroll after user scrolls back to bottom', async () => {
    const userMsg = createTextMessage('right', 'u1');
    const initial: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), { initialProps: { messages: initial, itemCount: 2 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    await act(async () => {
      vi.runAllTimers();
    });

    // User scrolls up
    act(() => {
      vi.advanceTimersByTime(200);
      result.current.handleScroll({ target: { scrollTop: 500 } } as unknown as React.UIEvent<HTMLDivElement>);
      result.current.handleScroll({ target: { scrollTop: 100 } } as unknown as React.UIEvent<HTMLDivElement>);
    });

    // User scrolls back to bottom (Virtuoso reports atBottom)
    act(() => {
      result.current.handleAtBottomStateChange(true);
    });

    mockVirtuosoHandle.scrollToIndex.mockClear();
    mockVirtuosoHandle.scrollTo.mockClear();

    // More streaming content arrives
    const updated: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1\nstep 2')];
    rerender({ messages: updated, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // Auto-follow resumes once the user is back at the bottom: returning to bottom
    // clears the user-scrolled flag, so followOutput reports 'auto' again.
    expect(result.current.handleFollowOutput(true)).toBe('auto');
  });
});

/**
 * Helpers for building a jsdom scroller element with the size properties
 * needed by `recomputeSpacer`. jsdom defaults clientHeight/scrollHeight to 0
 * and doesn't expose a real ResizeObserver, so we stub both.
 */
const setSize = (el: HTMLElement, prop: 'clientHeight' | 'scrollHeight' | 'scrollTop', value: number) => {
  Object.defineProperty(el, prop, { value, configurable: true, writable: true });
};

const mockRect = (el: HTMLElement, top: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({
      top,
      left: 0,
      right: 800,
      bottom: top + height,
      width: 800,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
};

describe('useAutoScroll - turn-mode bottom spacer (#345)', () => {
  let mockVirtuosoHandle: ReturnType<typeof createMockVirtuosoHandle>;
  let scrollerEl: HTMLElement;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    mockVirtuosoHandle = createMockVirtuosoHandle();
    vi.useFakeTimers();

    originalResizeObserver = (globalThis as any).ResizeObserver;
    class StubResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as any).ResizeObserver = StubResizeObserver;

    scrollerEl = document.createElement('div');
    setSize(scrollerEl, 'clientHeight', 600);
    setSize(scrollerEl, 'scrollHeight', 0);
    setSize(scrollerEl, 'scrollTop', 0);
    mockRect(scrollerEl, 0, 600);
    document.body.appendChild(scrollerEl);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.removeChild(scrollerEl);
    (globalThis as any).ResizeObserver = originalResizeObserver;
  });

  const createMessage = (position: 'left' | 'right', id: string): IMessageText => ({
    id,
    msg_id: id,
    type: 'text',
    position,
    conversation_id: 'test-conv',
    content: { content: 'test message' },
    createdAt: Date.now(),
  });

  /**
   * Render a `data-message-id` child on the scroller and set the scroller's
   * `scrollHeight` to reflect a realistic DOM state:
   *
   *   scrollHeight = itemsTotalHeight + BOTTOM_BUFFER_PX + currentSpacer
   *
   * where `currentSpacer` must match what the hook currently thinks the spacer
   * is — otherwise the recompute sees an inconsistent layout. Tests should
   * pass `result.current.bottomSpacerHeight` for this argument after the
   * previous rerender has settled.
   */
  const renderTurnDom = (userMsgId: string, userTop: number, userHeight: number, itemsTotalHeight: number, currentSpacer: number) => {
    scrollerEl.innerHTML = '';
    const el = document.createElement('div');
    el.setAttribute('data-message-id', userMsgId);
    mockRect(el, userTop, userHeight);
    scrollerEl.appendChild(el);
    setSize(scrollerEl, 'scrollHeight', itemsTotalHeight + BOTTOM_BUFFER_PX + currentSpacer);
    setSize(scrollerEl, 'scrollTop', 0);
  };

  it('starts with no bottom spacer in idle state', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), {
      initialProps: { messages: [] as TMessage[], itemCount: 0 },
    });
    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    act(() => {
      result.current.handleScrollerRef(scrollerEl);
    });

    expect(result.current.bottomSpacerHeight).toBe(0);
  });

  it('seeds the spacer to full viewport height when the user sends a message', async () => {
    const initial: TMessage[] = [];
    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), {
      initialProps: { messages: initial, itemCount: 0 },
    });
    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    act(() => {
      result.current.handleScrollerRef(scrollerEl);
    });

    // Before rerender, hook's spacer is still 0 (idle). DOM reflects that.
    renderTurnDom('u1', 10, 100, 100, 0);

    const next: TMessage[] = [createMessage('right', 'u1')];
    rerender({ messages: next, itemCount: 1 });

    await act(async () => {
      vi.runAllTimers();
    });

    // scrollToIndex pins the user message to the top.
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 0,
        align: 'start',
        behavior: 'auto',
      })
    );
    // Spacer is active (> 0) and bounded by the viewport height.
    expect(result.current.bottomSpacerHeight).toBeGreaterThan(0);
    expect(result.current.bottomSpacerHeight).toBeLessThanOrEqual(600);
  });

  it('does NOT auto-scroll while pinned — AI output fills the spacer instead', async () => {
    const userMsg = createMessage('right', 'u1');
    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), {
      initialProps: { messages: [] as TMessage[], itemCount: 0 },
    });
    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    act(() => {
      result.current.handleScrollerRef(scrollerEl);
    });

    // User sends — enter pinned mode.
    renderTurnDom('u1', 10, 100, 100, 0);
    rerender({ messages: [userMsg], itemCount: 1 });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.bottomSpacerHeight).toBeGreaterThan(0);
    mockVirtuosoHandle.scrollTo.mockClear();
    mockVirtuosoHandle.scrollToIndex.mockClear();

    // AI streams a short response that still fits inside the viewport:
    // user(100) + ai(200) = 300 < 600 (viewport), so we should remain pinned.
    renderTurnDom('u1', 10, 100, 300, result.current.bottomSpacerHeight);
    const aiMsg = createMessage('left', 'a1');
    rerender({ messages: [userMsg, aiMsg], itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // Pinned → no auto-scroll: neither scrollTo nor scrollToIndex should fire.
    expect(mockVirtuosoHandle.scrollTo).not.toHaveBeenCalled();
    expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled();
    // And the spacer should still be positive (we haven't overflowed yet).
    expect(result.current.bottomSpacerHeight).toBeGreaterThan(0);
  });

  it('releases the pin and resumes auto-follow once turn content overflows the viewport', async () => {
    const userMsg = createMessage('right', 'u1');
    const aiMsg = createMessage('left', 'a1');
    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), {
      initialProps: { messages: [] as TMessage[], itemCount: 0 },
    });
    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    act(() => {
      result.current.handleScrollerRef(scrollerEl);
    });

    // User sends.
    renderTurnDom('u1', 10, 100, 100, 0);
    rerender({ messages: [userMsg], itemCount: 1 });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.bottomSpacerHeight).toBeGreaterThan(0);

    // AI response grows large enough to overflow the viewport
    // (user 100 + AI 700 = items 800 > 600 viewport) → spacer should collapse
    // to 0 and the pin should release.
    renderTurnDom('u1', 10, 100, 800, result.current.bottomSpacerHeight);
    rerender({ messages: [userMsg, aiMsg], itemCount: 2 });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.bottomSpacerHeight).toBe(0);

    mockVirtuosoHandle.scrollTo.mockClear();

    // Further AI streaming after overflow should auto-follow. With the pin
    // released, followOutput reports 'auto' again — which also proves the pin
    // actually released (a still-pinned hook returns false).
    renderTurnDom('u1', 10, 100, 900, 0);
    const aiMsg2 = createMessage('left', 'a2');
    rerender({ messages: [userMsg, aiMsg, aiMsg2], itemCount: 3 });
    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.bottomSpacerHeight).toBe(0);
    expect(result.current.handleFollowOutput(true)).toBe('auto');
  });

  it('clears the spacer when the message list becomes empty (e.g., conversation switch)', async () => {
    const userMsg = createMessage('right', 'u1');
    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, items: messages.length ? messages : Array.from({ length: itemCount }) }), {
      initialProps: { messages: [userMsg], itemCount: 1 },
    });
    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    act(() => {
      result.current.handleScrollerRef(scrollerEl);
    });

    // Simulate a fresh user send establishing pinned state.
    renderTurnDom('u1', 10, 100, 100, 0);
    rerender({ messages: [userMsg, createMessage('right', 'u2')], itemCount: 2 });
    await act(async () => {
      vi.runAllTimers();
    });

    // Conversation cleared.
    rerender({ messages: [] as TMessage[], itemCount: 0 });
    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.bottomSpacerHeight).toBe(0);
  });
});
