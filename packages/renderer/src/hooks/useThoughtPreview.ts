import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeThoughtContent, type ThoughtContent } from '@sudowork/common/thought';

const EMPTY_THOUGHT = { subject: '', description: '' };

/** Coalesces engine reasoning for the activity preview without losing text or crossing blocks. */
export function useThoughtPreview(conversationId: string) {
  const [thought, setThought] = useState<ThoughtContent>(EMPTY_THOUGHT);
  const latest = useRef<{ id: string; content: ThoughtContent } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdate = useRef(0);
  const onReset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current = null;
    lastUpdate.current = 0;
    setThought(EMPTY_THOUGHT);
  }, []);
  const onThought = useCallback((content: ThoughtContent, id: string) => {
    latest.current = { id, content: mergeThoughtContent(latest.current?.id === id ? latest.current.content : undefined, content) };
    const flush = () => {
      timer.current = null;
      lastUpdate.current = Date.now();
      if (latest.current) setThought(latest.current.content);
    };
    const remaining = 50 - (Date.now() - lastUpdate.current);
    if (remaining <= 0) {
      if (timer.current) clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = setTimeout(flush, remaining);
  }, []);
  useEffect(() => {
    onReset();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [conversationId, onReset]);
  return { thought, onThought, onReset };
}
