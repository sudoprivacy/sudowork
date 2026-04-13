/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScroll } from '../../src/renderer/messages/useAutoScroll';
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

  it('should scroll to absolute bottom when AI responds with text message (position=left)', async () => {
    const initialMessages: TMessage[] = [createMessage('right', '1')];

    const { result, rerender } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: initialMessages, itemCount: 1 } });

    (result.current.virtuosoRef as any).current = mockVirtuosoHandle;

    // Add AI response (position=left, type=text)
    const newMessages: TMessage[] = [...initialMessages, createMessage('left', '2')];

    rerender({ messages: newMessages, itemCount: 2 });

    await act(async () => {
      vi.runAllTimers();
    });

    // Should scroll to the absolute bottom (Footer visible) for AI messages so
    // the last message's bottom border isn't clipped against the SendBox.
    expect(mockVirtuosoHandle.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: Number.MAX_SAFE_INTEGER,
        behavior: 'auto',
      })
    );
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

  it('should provide scrollToBottom function that scrolls to absolute bottom', () => {
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: [], itemCount: 5 } });

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
    const { result } = renderHook(({ messages, itemCount }) => useAutoScroll({ messages, itemCount }), { initialProps: { messages: [], itemCount: 0 } });

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

    // Scroll to absolute bottom (Footer visible) so tool call message is not
    // clipped against the SendBox below.
    expect(mockVirtuosoHandle.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: Number.MAX_SAFE_INTEGER,
        behavior: 'auto',
      })
    );
  });

  it('should auto-scroll on in-place tool_group content updates (streaming output)', async () => {
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

    // Should still scroll to absolute bottom on in-place updates so the tool
    // call message's bottom border stays clear of the SendBox during streaming.
    expect(mockVirtuosoHandle.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: Number.MAX_SAFE_INTEGER,
        behavior: 'auto',
      })
    );
    // Regression guard: must NOT use scrollToIndex({ align: 'end' }) for AI
    // follow — that aligns the message bottom flush with the viewport bottom,
    // causing the bottom border to be visually clipped against the SendBox.
    expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled();
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

    // Auto-scroll should have resumed (scroll to absolute bottom).
    expect(mockVirtuosoHandle.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: Number.MAX_SAFE_INTEGER }));
  });
});
