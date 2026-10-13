import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFileLink from '@renderer/components/WorkspaceFileLink';
const mocks = vi.hoisted(() => ({ preview: vi.fn(), readFile: vi.fn(), openPreview: vi.fn(), error: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ conversation: { previewRemoteWorkspaceFile: { invoke: mocks.preview } }, fs: { readFile: { invoke: mocks.readFile } } }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ openPreview: mocks.openPreview }) }));
vi.mock('@renderer/context/ConversationContext', () => ({ useConversationContextSafe: () => ({ workspace: '/workspace' }) }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: mocks.error } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const mount = () =>
  render(
    <WorkspaceFileLink href='qa-result.md' conversation={{ conversationId: 'cloud', type: 'remote-agent', workspace: '/workspace' }} file={{ path: '/workspace/qa-result.md', relativePath: 'qa-result.md' }}>
      Result
    </WorkspaceFileLink>
  );

describe('cloud file link preview', () => {
  it('uses the authorized remote session and displays the file content', async () => {
    mocks.preview.mockResolvedValue({ success: true, data: { kind: 'text', content: 'QA_FILE_OK', mime: 'text/markdown' } });
    mount();
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(mocks.openPreview).toHaveBeenCalledWith('QA_FILE_OK', 'markdown', expect.objectContaining({ remote: true, relativePath: 'qa-result.md' })));
    expect(mocks.preview).toHaveBeenCalledWith({ conversation_id: 'cloud', path: 'qa-result.md' });
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it('shows an error when the remote file no longer exists, without reading a local fallback', async () => {
    mocks.preview.mockResolvedValue({ success: false, msg: 'Not found' });
    mount();
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('messages.openFileFailed'));
    expect(mocks.openPreview).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
