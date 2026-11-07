import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useThoughtPreview } from '@renderer/hooks/useThoughtPreview';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('coalesces deltas, whitespace and snapshots without mixing separate reasoning blocks', () => {
  const { result } = renderHook(() => useThoughtPreview('conversation'));
  const send = (description: string, id = 'block', descriptionMode: 'delta' | 'snapshot' = 'delta') => act(() => result.current.onThought({ subject: 'Thinking', description, descriptionMode }, id));
  send('One');
  send(' ');
  send('paragraph.');
  act(() => vi.advanceTimersByTime(50));
  expect(result.current.thought.description).toBe('One paragraph.');
  send('One paragraph. Updated.', 'block', 'snapshot');
  act(() => vi.advanceTimersByTime(50));
  expect(result.current.thought.description).toBe('One paragraph. Updated.');
  send('Next block', 'next');
  act(() => vi.advanceTimersByTime(50));
  expect(result.current.thought.description).toBe('Next block');
});

it('does not resurrect queued preview text after an answer, cancellation or conversation change', () => {
  const { result, rerender } = renderHook(({ id }) => useThoughtPreview(id), { initialProps: { id: 'first' } });
  act(() => {
    result.current.onThought({ subject: 'Thinking', description: 'first' }, 'block');
    result.current.onThought({ subject: 'Thinking', description: 'pending' }, 'block');
  });
  act(() => result.current.onReset());
  act(() => vi.advanceTimersByTime(100));
  expect(result.current.thought.description).toBe('');
  act(() => result.current.onThought({ subject: 'Thinking', description: 'other' }, 'other'));
  rerender({ id: 'second' });
  expect(result.current.thought.description).toBe('');
});
