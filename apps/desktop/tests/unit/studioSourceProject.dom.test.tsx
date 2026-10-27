import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IOntologyStudioProject } from '@sudowork/ontology-common';
import StudioSourceProject from '../../../../packages/ontology-ui/src/studio/StudioSourceProject';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: Record<string, unknown>) => (args ? JSON.stringify(args) : key) }) }));
afterEach(cleanup);

it('keeps the shared chat mounted while source receipt details are collapsed or expanded', () => {
  const renderChat = vi.fn(() => <textarea aria-label='Existing chat' defaultValue='Preserve this draft' />);
  const project = { workspaceId: 'registered-source', name: 'Current source', authority: 'sudograph', source: { structureComplete: true, delivery: 'live', tables: 13, databaseViews: 17, fields: 204, revision: 'recorded-model-revision', observedAt: '2026-10-27' } } as IOntologyStudioProject;
  render(<StudioSourceProject project={project} renderChat={renderChat} onBack={vi.fn()} onRefresh={vi.fn()} />);
  const summary = screen.getByText('ontology.studio.sourceOverview').closest('summary')!;
  const receipt = summary.parentElement as HTMLDetailsElement;
  expect(receipt.open).toBe(false);
  expect(summary.textContent).toContain('sourceStructureComplete');
  expect(summary.textContent).toContain('204');
  const input = screen.getByRole('textbox', { name: 'Existing chat' });
  fireEvent.click(summary);
  expect(receipt.open).toBe(true);
  expect(screen.getByText('recorded-model-revision')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Existing chat' })).toBe(input);
  expect(input).toHaveProperty('value', 'Preserve this draft');
  expect(renderChat).toHaveBeenCalledWith('registered-source', 'Current source', undefined, undefined, { modelAuthority: 'sudograph' });
});
