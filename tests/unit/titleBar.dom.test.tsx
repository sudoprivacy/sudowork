import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_TOGGLE_EVENT } from '@/renderer/utils/workspaceEvents';

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  isLinux: () => true,
  isMacOS: () => false,
}));

vi.mock('@/renderer/components/WindowControls', () => ({ default: () => null }));
vi.mock('@/renderer/context/LayoutContext', () => ({ useLayoutContext: () => ({ siderCollapsed: true, setSiderCollapsed: vi.fn() }) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

import TitleBar from '@/renderer/layouts/components/TitleBar';

describe('TitleBar', () => {
  it('shows the workspace toggle on Linux desktop', () => {
    const onToggle = vi.fn();
    window.addEventListener(WORKSPACE_TOGGLE_EVENT, onToggle);

    render(<TitleBar workspaceAvailable onNewConversation={vi.fn()} />);
    const expandButtons = screen.getAllByRole('button', { name: '展开更多' });
    fireEvent.click(expandButtons.at(-1)!);

    expect(onToggle).toHaveBeenCalledOnce();
    window.removeEventListener(WORKSPACE_TOGGLE_EVENT, onToggle);
  });

  it('moves collapsed left controls closer to the top on Linux', () => {
    render(<TitleBar workspaceAvailable={false} onNewConversation={vi.fn()} />);

    const newConversationButton = screen.getByRole('button', { name: 'common.newConversation' });
    expect(newConversationButton.parentElement).toHaveStyle({ transform: 'translateX(0px) translateY(4px)' });
  });
});
