import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { GeneratedFileEntry } from '@/common/generatedFiles';

const { getFileMetadata, launchPreview, warning } = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  launchPreview: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { getFileMetadata: { invoke: getFileMetadata } },
    shell: {
      openFile: { invoke: vi.fn() },
      showItemInFolder: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/hooks/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({ launchPreview, loading: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { error: vi.fn(), warning },
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', () => ({
  ExternalLink: () => null,
  FolderOpen: () => null,
}));

vi.mock('@/renderer/utils/fileIcon', () => ({
  resolveFileIcon: () => null,
}));

vi.mock('@/renderer/services/FileService', () => ({
  formatFileSize: () => '',
}));

import { GeneratedFileCard } from '@/renderer/messages/GeneratedFileCard';

const entry: GeneratedFileEntry = {
  path: '/workspace/report.md',
  relativePath: 'report.md',
  kind: 'create',
  ext: 'md',
  createdAt: 1,
};

describe('GeneratedFileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns when clicking a file already known to be missing', async () => {
    getFileMetadata.mockResolvedValue(null);
    render(<GeneratedFileCard entry={entry} />);

    await screen.findByText('messages.generatedFile.statusMissing');
    fireEvent.click(screen.getByRole('button', { name: 'report.md' }));

    expect(warning).toHaveBeenCalledWith('messages.generatedFile.missingHint');
    expect(launchPreview).not.toHaveBeenCalled();
  });

  it('rechecks the path and warns when the file moved after mount', async () => {
    getFileMetadata.mockResolvedValueOnce({ size: 10 }).mockResolvedValueOnce(null);
    render(<GeneratedFileCard entry={entry} />);

    await waitFor(() => expect(getFileMetadata).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'report.md' }));

    await waitFor(() => expect(warning).toHaveBeenCalledWith('messages.generatedFile.missingHint'));
    expect(getFileMetadata).toHaveBeenCalledTimes(2);
    expect(launchPreview).not.toHaveBeenCalled();
  });
});
