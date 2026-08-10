import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetLibraryEntry } from '@/common/generatedFiles';

const mocks = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  showItemInFolder: vi.fn(),
  launchPreview: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { getFileMetadata: { invoke: mocks.getFileMetadata } },
    shell: { showItemInFolder: { invoke: mocks.showItemInFolder } },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', () => {
  const Menu = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Menu.Item = ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) => (
    <button type='button' disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
  return {
    Dropdown: ({ children, droplist }: { children: React.ReactNode; droplist: React.ReactNode }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
    Menu,
    Message: { error: vi.fn() },
  };
});
vi.mock('lucide-react', () => ({
  FolderOpen: () => null,
  MessageCircle: () => null,
  MoreHorizontal: () => null,
}));
vi.mock('@/renderer/utils/fileIcon', () => ({ resolveFileIcon: () => null }));
vi.mock('@/renderer/hooks/usePreviewLauncher', () => ({ usePreviewLauncher: () => ({ launchPreview: mocks.launchPreview, loading: false }) }));
vi.mock('@/renderer/services/FileService', () => ({ formatFileSize: () => '10 KB' }));

import AssetLibraryItem from '@/renderer/pages/asset-library/components/AssetLibraryItem';

const entry: AssetLibraryEntry = {
  path: '/workspace/report.pdf',
  relativePath: 'report.pdf',
  kind: 'create',
  ext: 'pdf',
  createdAt: 1,
  conversationId: 'c1',
  conversationName: 'Tender chat',
};

describe('AssetLibraryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows grouped actions', async () => {
    const onOpenConversation = vi.fn();
    mocks.getFileMetadata.mockResolvedValue({ size: 10240 });
    mocks.showItemInFolder.mockResolvedValue(undefined);
    render(<AssetLibraryItem entry={entry} onPreviewStart={vi.fn()} onOpenConversation={onOpenConversation} onMissing={vi.fn()} />);

    await waitFor(() => expect(mocks.getFileMetadata).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'common.ariaLabel.more' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'messages.generatedFile.showInFolder' }));
    fireEvent.click(screen.getByRole('button', { name: 'messages.generatedFile.jumpToConversation' }));

    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/workspace/report.pdf');
    expect(onOpenConversation).toHaveBeenCalledOnce();
    expect(mocks.launchPreview).not.toHaveBeenCalled();
  });

  it('opens the existing preview panel when clicked', async () => {
    const onPreviewStart = vi.fn();
    mocks.getFileMetadata.mockResolvedValue({ size: 10240 });
    mocks.launchPreview.mockResolvedValue(undefined);
    render(<AssetLibraryItem entry={entry} onPreviewStart={onPreviewStart} onOpenConversation={vi.fn()} onMissing={vi.fn()} />);

    const card = await screen.findByRole('button', { name: 'report.pdf' });
    fireEvent.click(card);

    await waitFor(() =>
      expect(mocks.launchPreview).toHaveBeenCalledWith({
        originalPath: '/workspace/report.pdf',
        fileName: 'report.pdf',
        contentType: 'pdf',
        editable: false,
      })
    );
    expect(onPreviewStart).toHaveBeenCalledOnce();
  });

  it('does not render when the file is missing', async () => {
    const onMissing = vi.fn();
    mocks.getFileMetadata.mockResolvedValue(null);
    render(<AssetLibraryItem entry={entry} onPreviewStart={vi.fn()} onOpenConversation={vi.fn()} onMissing={onMissing} />);

    await waitFor(() => expect(onMissing).toHaveBeenCalledWith('/workspace/report.pdf'));
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument();
  });
});
