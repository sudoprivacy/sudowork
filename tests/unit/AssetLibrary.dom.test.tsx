import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import AssetLibraryPage, { getAssetCategory } from '@renderer/pages/asset-library';

const mocks = vi.hoisted(() => ({
  listForUser: vi.fn(),
  navigate: vi.fn(),
  closePreviewByIdentity: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      ({
        'common.loading': 'Loading',
        'common.siderMenu.assetLibrary': 'Asset Library',
        'common.assetLibrary.subtitle': 'Generated deliverables',
        'common.assetLibrary.searchPlaceholder': 'Search files',
        'common.assetLibrary.typeFilter': 'File type',
        'common.assetLibrary.typeAll': 'All',
        'common.assetLibrary.typeImage': 'Images',
        'common.assetLibrary.typeDocument': 'Documents',
        'common.assetLibrary.typeVideo': 'Videos',
        'common.assetLibrary.typeOther': 'Other',
        'common.assetLibrary.emptyTitle': 'No deliverables yet',
        'common.assetLibrary.emptyHint': 'Generated files appear here.',
        'common.assetLibrary.count': `${options?.count ?? 0} files`,
      })[key] || key,
  }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    deliverables: {
      listForUser: { invoke: mocks.listForUser },
      changed: { on: () => vi.fn() },
    },
    database: { conversationChanged: { on: () => vi.fn() } },
    shell: { openFile: { invoke: vi.fn() } },
  },
}));
vi.mock('@renderer/utils/emitter', () => ({ addEventListener: () => vi.fn() }));
vi.mock('@renderer/pages/guid/hooks/useGuidAgentSelection', () => ({ getRendererSessionMode: () => 'local' }));
vi.mock('@renderer/pages/conversation/preview', () => ({
  PreviewPanel: ({ isFullscreen, onFullscreenToggle }: { isFullscreen?: boolean; onFullscreenToggle?: () => void }) => (
    <div>
      Preview panel
      <button type='button' onClick={onFullscreenToggle}>
        {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      </button>
    </div>
  ),
  usePreviewContext: () => ({ isOpen: true, closePreviewByIdentity: mocks.closePreviewByIdentity }),
}));
vi.mock('@renderer/pages/asset-library/components/AssetLibraryItem', () => ({
  default: ({ onPreviewStart }: { onPreviewStart: () => void }) => (
    <button type='button' onClick={onPreviewStart}>
      Asset cards
    </button>
  ),
}));

describe('getAssetCategory', () => {
  it('classifies common file types', () => {
    expect(getAssetCategory({ path: '/tmp/photo.PNG', ext: '' })).toBe('image');
    expect(getAssetCategory({ path: '/tmp/report.pdf', ext: 'pdf' })).toBe('document');
    expect(getAssetCategory({ path: '/tmp/demo.mp4', ext: 'mp4' })).toBe('video');
    expect(getAssetCategory({ path: '/tmp/archive.zip', ext: 'zip' })).toBe('other');
  });
});

describe('AssetLibraryPage', () => {
  it('renders the empty state', async () => {
    mocks.listForUser.mockResolvedValue({ success: true, data: [] });
    render(<AssetLibraryPage />);

    expect(screen.getByRole('heading', { name: 'Asset Library' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No deliverables yet')).toBeInTheDocument());
    expect(mocks.listForUser).toHaveBeenCalledWith({ sessionMode: 'local' });
  });

  it('renders returned asset cards and opens the preview panel', async () => {
    mocks.listForUser.mockResolvedValue({
      success: true,
      data: [{ path: '/tmp/report.pdf', relativePath: 'report.pdf', kind: 'create', ext: 'pdf', createdAt: Date.now(), conversationId: 'c1', conversationName: 'Tender chat' }],
    });
    render(<AssetLibraryPage />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    const card = await screen.findByRole('button', { name: 'Asset cards' });
    fireEvent.click(card);

    expect(await screen.findByText('Preview panel')).toBeInTheDocument();
  });

  it('toggles preview fullscreen within the asset page', async () => {
    mocks.listForUser.mockResolvedValue({
      success: true,
      data: [{ path: '/tmp/report.pdf', relativePath: 'report.pdf', kind: 'create', ext: 'pdf', createdAt: Date.now(), conversationId: 'c1', conversationName: 'Tender chat' }],
    });
    render(<AssetLibraryPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Asset cards' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Fullscreen' }));

    expect(screen.getByRole('heading', { name: 'Asset Library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
  });
});
