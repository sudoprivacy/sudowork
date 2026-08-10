import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@arco-design/web-react', () => {
  const Container = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>;
  return { Layout: Object.assign(Container, { Header: Container, Content: Container }) };
});

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Panel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/renderer/components/ResizableSeparator', () => ({ default: () => null }));
vi.mock('@/renderer/context/LayoutContext', () => ({ useLayoutContext: () => ({ siderCollapsed: false, setSiderCollapsed: vi.fn() }) }));
vi.mock('@/renderer/hooks/useStoredPanelLayout', () => ({ useStoredPanelLayout: () => ({ defaultLayout: { main: 80, workspace: 20 }, onLayoutChanged: vi.fn() }) }));
vi.mock('@/renderer/pages/conversation/preview', () => ({
  usePreviewContext: () => ({ isOpen: true }),
  PreviewPanel: ({ onFullscreenToggle }: { onFullscreenToggle: () => void }) => <button onClick={onFullscreenToggle}>fullscreen</button>,
}));

import ChatLayout from '@/renderer/pages/conversation/ChatLayout';

describe('ChatLayout', () => {
  it('keeps the preview below the Linux titlebar in both panel modes', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Linux' });
    const { container } = render(
      <ChatLayout sider={<div />}>
        <div />
      </ChatLayout>
    );

    const preview = container.querySelector('.preview-panel');
    expect(preview).toHaveStyle({ paddingTop: '28px' });
    expect(preview).toHaveClass('z-9');

    fireEvent.click(screen.getByRole('button', { name: 'fullscreen' }));
    expect(preview).toHaveStyle({ paddingTop: '28px' });
    expect(preview).toHaveClass('z-9');
  });
});
