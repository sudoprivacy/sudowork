import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComposerKeyHints, ComposerQueue } from '@renderer/components/ComposerStatus';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it('shows queue entries as a separate row and retains their delivery labels', () => {
  render(<ComposerQueue inputs={[{ id: 'queued', preview: 'Next task', delivery: 'queue' }]} />);
  expect(screen.getByTestId('composer-queue').textContent).toContain('Next task');
  expect(screen.getByTestId('queued-input-chip').textContent).toContain('messages.inputDelivery.queue');
});

it('hides delivery help while idle or answering a question and only advertises applicable actions', () => {
  const view = render(<ComposerKeyHints isEnabled isRunning={false} isAnsweringQuestion={false} isQueuePending={false} />);
  expect(screen.queryByTestId('input-delivery-hint')).toBeNull();
  view.rerender(<ComposerKeyHints isEnabled isRunning isAnsweringQuestion isQueuePending />);
  expect(screen.queryByTestId('input-delivery-hint')).toBeNull();
  view.rerender(<ComposerKeyHints isEnabled isRunning={false} isAnsweringQuestion={false} isQueuePending />);
  expect(screen.getByTestId('input-delivery-hint').textContent).toContain('flushHint');
  expect(screen.getByTestId('input-delivery-hint').textContent).not.toContain('inputDelivery.keys');
  view.rerender(<ComposerKeyHints isEnabled isRunning isAnsweringQuestion={false} isQueuePending={false} />);
  expect(screen.getByTestId('input-delivery-hint').textContent).toContain('inputDelivery.keys');
  expect(screen.getByTestId('input-delivery-hint').textContent).toContain('cancelHint');
});
