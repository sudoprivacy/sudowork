/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScroll, BOTTOM_BUFFER_PX } from '../../src/renderer/messages/useAutoScroll';
import type { TMessage, IMessageText, IMessageToolGroup } from '../../src/common/chatLib';

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

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initialMessages, itemCount: 2 } });

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

  it('should auto-follow AI text message by aligning its bottom near the viewport bottom (position=left)', async () => {
    const initialMessages: TMessage[] = [createMessage('right', '1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initialMessages, itemCount: 1 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    // Add AI response (position=left, type=text)
    const newMessages: TMessage[] = [...initialMessages, createMessage('left', '2')];

    rerender({ messages: newMessages, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // Auto-follow uses scrollToIndex with align: 'end' so we don't scroll past
    // the last message into the (viewport-tall) empty bottom spacer that
    // exists to keep the user's prompt pinned at the top after sending.
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 1,
        align: 'end',
        behavior: 'auto',
        offset: -BOTTOM_BUFFER_PX,
      })
    );
    // Regression guard: must NOT use `scrollTo({ top: MAX })` because, with
    // the viewport-tall bottom spacer, that would expose the empty spacer at
    // the bottom of the viewport, hiding the AI message.
    expect(mockVirtuosoHandle.scrollTo).not.toHaveBeenCalled();
  });

  it('should reset userScrolled flag when user sends message', async () => {
    const initialMessages: TMessage[] = [createMessage('left', '1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initialMessages, itemCount: 1 } });

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
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: [], itemCount: 0 } });

    // Initially hidden
    expect(result.current.showScrollButton).toBe(false);

    // Simulate not at bottom
    act(() => {
      result.current.handleAtBottomStateChange(false);
    });

    expect(result.current.showScrollButton).toBe(true);

    // Back to bottom
    act(() => {
      result.current.handleAtBottomStateChange(true);
    });

    expect(result.current.showScrollButton).toBe(false);
  });

  it('should provide scrollToBottom function that aligns the last message bottom near the viewport bottom', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: [], itemCount: 5 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    act(() => {
      result.current.scrollToBottom('smooth');
    });

    // scrollToBottom uses scrollToIndex (not `scrollTo({ top: MAX })`) so we
    // don't scroll past the last message into the empty bottom spacer.
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 4, // itemCount - 1
        align: 'end',
        behavior: 'smooth',
        offset: -BOTTOM_BUFFER_PX,
      })
    );
    expect(mockVirtuosoHandle.scrollTo).not.toHaveBeenCalled();
  });

  it('should handle followOutput correctly based on scroll state', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: [], itemCount: 0 } });

    // When at bottom and not user-scrolled, should return 'auto'
    expect(result.current.handleFollowOutput(true)).toBe('auto');

    // When not at bottom, should return false
    expect(result.current.handleFollowOutput(false)).toBe(false);
  });

  it('should expose a bottomSpacerHeight that grows with the measured scroller height', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: [], itemCount: 0 } });

    // Default fallback before any measurement
    expect(result.current.bottomSpacerHeight).toBeGreaterThanOrEqual(40);

    // Hand Virtuoso a fake scroller element with a measured viewport height —
    // the spacer should grow to match so the user's message can be scrolled
    // all the way to the top of the viewport.
    const fakeScroller = document.createElement('div');
    Object.defineProperty(fakeScroller, 'clientHeight', { value: 720, configurable: true });

    act(() => {
      result.current.handleScrollerRef(fakeScroller);
    });

    expect(result.current.bottomSpacerHeight).toBe(720);
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

  it('should auto-follow when a tool_group message is appended (align: end)', async () => {
    const initial: TMessage[] = [createTextMessage('right', 'u1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initial, itemCount: 1 } });

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

    // Auto-follow uses scrollToIndex with align: 'end' so the empty bottom
    // spacer (reserved to keep the user prompt pinned at the top) is not
    // exposed in the viewport.
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 1,
        align: 'end',
        behavior: 'auto',
        offset: -BOTTOM_BUFFER_PX,
      })
    );
    expect(mockVirtuosoHandle.scrollTo).not.toHaveBeenCalled();
  });

  it('should auto-follow on in-place tool_group content updates (streaming output)', async () => {
    const userMsg = createTextMessage('right', 'u1');
    const initial: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initial, itemCount: 2 } });

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

    // Auto-follow uses scrollToIndex with align: 'end' on in-place updates.
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 1,
        align: 'end',
        behavior: 'auto',
        offset: -BOTTOM_BUFFER_PX,
      })
    );
    // Regression guard: must NOT use `scrollTo({ top: MAX })` — that would
    // scroll past the last message into the empty bottom spacer reserved for
    // the user-message-at-top behavior.
    expect(mockVirtuosoHandle.scrollTo).not.toHaveBeenCalled();
  });

  it('should NOT auto-scroll during tool call streaming if user scrolled up', async () => {
    const userMsg = createTextMessage('right', 'u1');
    const initial: TMessage[] = [userMsg, createToolGroupMessage('t1', 'step 1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initial, itemCount: 2 } });

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

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initial, itemCount: 2 } });

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

    // Auto-follow should have resumed.
    expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 1,
        align: 'end',
        behavior: 'auto',
        offset: -BOTTOM_BUFFER_PX,
      })
    );
  });
});
