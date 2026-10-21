import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ getMode: vi.fn(), setMode: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  acpConversation: {
    getMode: { invoke: state.getMode },
    setMode: { invoke: state.setMode },
  },
}));

import AgentModeSelector from '@renderer/components/AgentModeSelector';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Agent mode selector', () => {
  it('shows a remote session permission as read-only without calling the unsupported live API', () => {
    render(<AgentModeSelector backend='remote-agent' conversationId='remote-session' compact initialMode='yolo' compactLabelPrefix='Permission' />);
    const permission = screen.getByRole('button', { name: 'Permission · YOLO' });
    fireEvent.click(permission);
    expect(state.getMode).not.toHaveBeenCalled();
    expect(state.setMode).not.toHaveBeenCalled();
    expect(screen.queryByText('Default')).toBeNull();
  });

  it('keeps remote permission selection available before a session is created', () => {
    const onModeSelect = vi.fn();
    render(<AgentModeSelector backend='remote-agent' compact initialMode='default' onModeSelect={onModeSelect} compactLabelPrefix='Permission' />);
    fireEvent.click(screen.getByRole('button', { name: 'Permission · Default' }));
    fireEvent.click(screen.getByText('YOLO'));
    expect(onModeSelect).toHaveBeenCalledWith('yolo');
    expect(state.setMode).not.toHaveBeenCalled();
  });
});
