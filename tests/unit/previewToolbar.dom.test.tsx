/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayoutContext } from '@/renderer/context/LayoutContext';
import { PreviewTabs, PreviewToolbar } from '@/renderer/pages/conversation/preview/components/PreviewPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock('@/renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/platform')>()),
  isElectronDesktop: () => true,
  isMacOS: () => true,
}));

const noop = vi.fn();

const baseProps = {
  contentType: 'markdown',
  isMarkdown: true,
  isHTML: false,
  isEditable: false,
  isEditMode: false,
  viewMode: 'preview' as const,
  isSplitScreenEnabled: false,
  fileName: 'README.md',
  showOpenInSystemButton: false,
  historyTarget: null,
  snapshotSaving: false,
  onViewModeChange: noop,
  onSplitScreenToggle: noop,
  onEditClick: noop,
  onExitEdit: noop,
  onSaveSnapshot: noop,
  onRefreshHistory: noop,
  renderHistoryDropdown: () => null,
  onOpenInSystem: noop,
  onDownload: noop,
  onClose: noop,
};

describe('PreviewTabs', () => {
  const baseTabProps = {
    tabs: [{ id: 'readme', title: 'README.md' }],
    activeTabId: 'readme',
    tabFadeState: { left: false, right: false },
    tabsContainerRef: React.createRef<HTMLDivElement>(),
    onSwitchTab: noop,
    onCloseTab: noop,
    onContextMenu: noop,
  };

  it('toggles fullscreen from the tab bar', () => {
    const onFullscreenToggle = vi.fn();
    const { rerender } = render(<PreviewTabs {...baseTabProps} onFullscreenToggle={onFullscreenToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'preview.fullscreen' }));
    expect(onFullscreenToggle).toHaveBeenCalledOnce();

    rerender(<PreviewTabs {...baseTabProps} isFullscreen onFullscreenToggle={onFullscreenToggle} />);
    expect(screen.getByRole('button', { name: 'preview.exitFullscreen' })).toBeInTheDocument();
  });

  it('reserves macOS traffic-light space only when the sidebar is collapsed', () => {
    const { rerender } = render(
      <LayoutContext.Provider value={{ siderCollapsed: false, setSiderCollapsed: noop }}>
        <PreviewTabs {...baseTabProps} isFullscreen />
      </LayoutContext.Provider>
    );

    expect(baseTabProps.tabsContainerRef.current).not.toHaveStyle({ paddingLeft: '160px' });

    rerender(
      <LayoutContext.Provider value={{ siderCollapsed: true, setSiderCollapsed: noop }}>
        <PreviewTabs {...baseTabProps} isFullscreen />
      </LayoutContext.Provider>
    );
    expect(baseTabProps.tabsContainerRef.current).toHaveStyle({ paddingLeft: '160px' });
  });
});

describe('PreviewToolbar', () => {
  it('keeps source controls for local markdown previews by default', () => {
    render(<PreviewToolbar {...baseProps} />);

    expect(screen.getByText('preview.source')).toBeInTheDocument();
    expect(screen.getByText('preview.preview')).toBeInTheDocument();
    expect(screen.getByTitle('preview.openSplitScreen')).toBeInTheDocument();
  });

  it('hides source, split, and history controls for remote read-only previews', () => {
    render(<PreviewToolbar {...baseProps} sourceViewEnabled={false} showHistoryControls={false} />);

    expect(screen.queryByText('preview.source')).not.toBeInTheDocument();
    expect(screen.getByText('preview.preview')).toBeInTheDocument();
    expect(screen.queryByTitle('preview.openSplitScreen')).not.toBeInTheDocument();
    expect(screen.queryByText('preview.snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('preview.history')).not.toBeInTheDocument();
    expect(screen.getByText('common.download')).toBeInTheDocument();
  });
});
