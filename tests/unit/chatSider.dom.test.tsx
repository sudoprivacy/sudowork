/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/pages/conversation/right-panel/DeliverablesPanel', () => ({
  default: ({ conversationId, teamId }: { conversationId?: string; teamId?: string }) => (
    <div data-testid='deliverables-panel' data-conversation-id={conversationId} data-team-id={teamId}>
      DeliverablesPanel
    </div>
  ),
}));

import ChatSider from '@/renderer/pages/conversation/ChatSider';

describe('ChatSider', () => {
  it('renders single "交付物" tab', () => {
    render(<ChatSider />);
    const tab = screen.getByRole('tab');
    expect(tab).toBeTruthy();
    expect(tab.textContent).toContain('conversation.rightPanel.tabs.deliverables');
  });

  it('renders DeliverablesPanel with conversationId and teamId', () => {
    const conversation = { id: 'conv-123' } as any;
    render(<ChatSider conversation={conversation} teamId='team-456' />);
    const panel = screen.getByTestId('deliverables-panel');
    expect(panel.getAttribute('data-conversation-id')).toBe('conv-123');
    expect(panel.getAttribute('data-team-id')).toBe('team-456');
  });

  it('passes undefined when conversation is missing', () => {
    render(<ChatSider teamId='team-789' />);
    const panel = screen.getByTestId('deliverables-panel');
    expect(panel.getAttribute('data-conversation-id')).toBeNull();
    expect(panel.getAttribute('data-team-id')).toBe('team-789');
  });

  it('does not render Workspace/Browser/Terminal tabs', () => {
    const { container } = render(<ChatSider />);
    const allTabs = container.querySelectorAll('[role="tab"]');
    expect(allTabs.length).toBe(1);
  });
});
