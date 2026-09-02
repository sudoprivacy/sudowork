/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewToolbar } from '@/renderer/pages/conversation/preview/components/PreviewPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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
