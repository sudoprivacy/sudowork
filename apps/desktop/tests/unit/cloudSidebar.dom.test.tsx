import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';
import ChatSider from '@renderer/pages/conversation/ChatSider';
const mocks = vi.hoisted(() => ({ launchPreview: vi.fn(), metadata: vi.fn() }));
vi.mock('@renderer/hooks/usePreviewLauncher', () => ({ usePreviewLauncher: () => ({ launchPreview: mocks.launchPreview, loading: false }) }));
vi.mock('@renderer/pages/conversation/workspace', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation/right-panel/BrowserPanel', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation/right-panel/TerminalPanel', () => ({ default: () => <button>Local terminal</button> }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true, resolveExtensionAssetUrl: (url: string) => url }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  rightPanelBrowser: { open: { on: () => () => {} } },
  deliverables: {
    list: { invoke: async () => ({ success: true, data: [{ path: '/workspace/result.md', relativePath: 'result.md', ext: 'md', kind: 'create', createdAt: 1 }] }) },
    changed: { on: () => () => {} },
  },
  fs: { getFileMetadata: { invoke: mocks.metadata } },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const conversation = { id: 'cloud', type: 'remote-agent', extra: { workspace: '/workspace' } } as TChatConversation;

describe('cloud sidebar', () => {
  it('previews deliverables using the sidebar conversation and never stats the cloud path locally', async () => {
    render(<ChatSider conversation={conversation} />);
    fireEvent.click(screen.getByRole('tab', { name: 'conversation.rightPanel.tabs.deliverables' }));
    fireEvent.click(await screen.findByRole('button', { name: 'result.md' }));
    expect(mocks.launchPreview).toHaveBeenCalledWith(expect.objectContaining({ remoteConversationId: 'cloud', relativePath: 'result.md', originalPath: undefined }));
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it('explains that remote terminals are unavailable without mounting a local terminal', async () => {
    render(<ChatSider conversation={conversation} />);
    await screen.findByText('result.md');
    fireEvent.click(screen.getByRole('tab', { name: 'conversation.rightPanel.tabs.terminal' }));
    expect(screen.getByText('conversation.rightPanel.terminal.remoteUnavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Local terminal' })).not.toBeInTheDocument();
  });
});
