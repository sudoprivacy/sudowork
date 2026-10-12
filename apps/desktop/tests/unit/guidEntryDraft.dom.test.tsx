import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuidEntryPrompt } from '@renderer/pages/guid/hooks/useGuidEntryPrompt';
import { useGuidInput } from '@renderer/pages/guid/hooks/useGuidInput';
import { clearGuidDraft, setGuidDraft } from '@renderer/pages/guid/hooks/useGuidDraft';

vi.mock('@renderer/hooks/useDragUpload', () => ({ useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }) }));
vi.mock('@renderer/hooks/usePasteService', () => ({ usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }) }));
vi.mock('@renderer/services/FileService', () => ({ allSupportedExts: [] }));

beforeEach(clearGuidDraft);

afterEach(cleanup);

interface IComposerProps {
  selectionKey: string | null;
  prompt?: string;
  onSend?: (input: string) => void;
}

function Composer({ selectionKey, prompt, onSend }: IComposerProps) {
  const { input, setInput, getInputRevision } = useGuidInput({ locationState: null });
  const onReset = useGuidEntryPrompt({ selectionKey, prompt, getInputRevision, setInput });
  return (
    <>
      <textarea aria-label='Message' value={input} onChange={(event) => setInput(event.target.value)} />
      <button disabled={prompt === undefined || !input.trim()} onClick={() => onSend?.(input)}>
        Send
      </button>
      <button onClick={onReset}>New Session</button>
    </>
  );
}

describe('Agent entry draft lifecycle', () => {
  it.each(['', 'Template opening prompt'])('preserves text typed before the Agent resolves with prompt %j', (prompt) => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer selectionKey='moss-agent:user:alice' onSend={onSend} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My first message' } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Composer selectionKey='moss-agent:user:alice' prompt={prompt} onSend={onSend} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My first message');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('My first message');
  });

  it('initializes each selected Agent once and preserves edits through catalogue refreshes', () => {
    setGuidDraft({ input: 'Previous draft' });
    const { rerender } = render(<Composer selectionKey='agent-a' prompt='Agent A prompt' />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Agent A prompt');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My edit' } });
    rerender(<Composer selectionKey='agent-a' prompt='Updated catalogue prompt' />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My edit');
    rerender(<Composer selectionKey='agent-b' prompt='Agent B prompt' />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Agent B prompt');
  });

  it('preserves user edits even when they return to the entry’s original text', () => {
    setGuidDraft({ input: 'Original draft' });
    const { rerender } = render(<Composer selectionKey='agent-a' />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original draft' } });
    rerender(<Composer selectionKey='agent-a' prompt='Opening prompt' />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Original draft');
  });

  it('clears the rendered draft when New Session repeats the same Agent entry', () => {
    render(<Composer selectionKey='agent-a' prompt='' />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Previous draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('restores a template opening prompt for a new entry without overwriting later text', () => {
    render(<Composer selectionKey='template-a' prompt='Template prompt' />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Previous session draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Template prompt');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New message' } });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('New message');
  });
});
