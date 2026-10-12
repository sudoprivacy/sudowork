import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface IGuidEntryPromptOptions {
  selectionKey: string | null;
  getInputRevision: () => number;
  prompt: string | undefined;
  setInput: Dispatch<SetStateAction<string>>;
}

/** Initialize an entry once, preserving text entered while its Agent loads. */
export function useGuidEntryPrompt({ selectionKey, getInputRevision, prompt, setInput }: IGuidEntryPromptOptions): () => void {
  const entryRef = useRef({ key: selectionKey, initialRevision: getInputRevision(), isApplied: false });
  const [resetVersion, setResetVersion] = useState(0);
  if (entryRef.current.key !== selectionKey) {
    entryRef.current = { key: selectionKey, initialRevision: getInputRevision(), isApplied: false };
  }

  useEffect(() => {
    const entry = entryRef.current;
    if (!selectionKey || prompt === undefined || entry.key !== selectionKey || entry.isApplied) return;
    entry.isApplied = true;
    if (getInputRevision() === entry.initialRevision) setInput(prompt);
  }, [selectionKey, prompt, setInput, getInputRevision, resetVersion]);

  return useCallback(() => {
    setInput('');
    entryRef.current = { key: selectionKey, initialRevision: getInputRevision(), isApplied: false };
    setResetVersion((version) => version + 1);
  }, [selectionKey, setInput, getInputRevision]);
}
