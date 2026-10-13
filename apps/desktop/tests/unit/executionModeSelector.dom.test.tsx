import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExecutionModeSelector from '@renderer/pages/guid/components/ExecutionModeSelector';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

describe('Agent execution target', () => {
  it('offers both authorized targets and reports a user selection', () => {
    const onSessionModeChange = vi.fn();
    render(<ExecutionModeSelector sessionMode='local' isLocalAvailable onSessionModeChange={onSessionModeChange} />);
    const cloud = screen.getByRole('radio', { name: 'conversation.welcome.execution.cloud' });
    expect(screen.getByRole('radio', { name: 'conversation.welcome.execution.local' })).toBeChecked();
    fireEvent.click(cloud);
    expect(onSessionModeChange).toHaveBeenCalledWith('remote');
  });

  it('restricts a cloud-only account even when an old local preference is supplied', () => {
    render(<ExecutionModeSelector sessionMode='local' isLocalAvailable={false} />);
    expect(screen.getByRole('radio', { name: 'conversation.welcome.execution.cloud' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'conversation.welcome.execution.local' })).toBeNull();
  });
});
