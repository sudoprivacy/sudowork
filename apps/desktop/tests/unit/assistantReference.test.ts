import { describe, expect, it } from 'vitest';
import { resolveAssistantReference } from '@renderer/shared/agents/assistantReference';

describe('assistant navigation references', () => {
  const assistants = [
    { id: 'template-one', name: 'Research' },
    { id: 'template-two', name: 'Research' },
    { id: 'template-three', name: 'Finance' },
  ];

  it('keeps same-named templates distinct when entering by ID', () => {
    expect(resolveAssistantReference(assistants, 'template-two')?.id).toBe('template-two');
  });

  it('does not choose a template from an ambiguous old display-name link', () => {
    expect(resolveAssistantReference(assistants, 'Research')).toBeUndefined();
    expect(resolveAssistantReference(assistants, 'Finance')?.id).toBe('template-three');
  });

  it('gives an exact ID priority over another template with that display name', () => {
    expect(resolveAssistantReference([{ id: 'unrelated', name: 'template-two' }, ...assistants], 'template-two')?.id).toBe('template-two');
    expect(resolveAssistantReference(assistants, 'missing')).toBeUndefined();
  });
});
