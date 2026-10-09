import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePreviewLauncher } from '@renderer/hooks/usePreviewLauncher';

const mocks = vi.hoisted(() => ({ open: vi.fn(), remote: vi.fn(), read: vi.fn(), image: vi.fn(), temp: vi.fn(), write: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: { previewRemoteWorkspaceFile: { invoke: mocks.remote } },
  fs: { createTempFile: { invoke: mocks.temp }, writeFile: { invoke: mocks.write }, readFile: { invoke: mocks.read }, getImageBase64: { invoke: mocks.image } },
}));
vi.mock('@renderer/context/ConversationContext', () => ({ useConversationContextSafe: () => ({ conversationId: 'conversation', workspace: '/unavailable-server-path', type: 'remote-agent' }) }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ openPreview: mocks.open }) }));

beforeEach(() => {
  vi.clearAllMocks();
});
it('previews cloud JSON through the session API and keeps remote download metadata', async () => {
  mocks.remote.mockResolvedValue({ success: true, data: { kind: 'text', content: '{"total":90.3}', mime: 'application/json' } });
  const { result } = renderHook(() => usePreviewLauncher());
  await act(() => result.current.launchPreview({ remoteConversationId: 'conversation', relativePath: '报价 数据.json', contentType: 'code', editable: false }));
  expect(mocks.remote).toHaveBeenCalledWith({ conversation_id: 'conversation', path: '报价 数据.json' });
  expect(mocks.open).toHaveBeenCalledWith('{"total":90.3}', 'code', expect.objectContaining({ remote: true, relativePath: '报价 数据.json', filePath: undefined }));
  expect(mocks.read).not.toHaveBeenCalled();
});
it('preserves cloud image bytes for preview and download without reading local files', async () => {
  mocks.remote.mockResolvedValue({ success: true, data: { kind: 'base64', contentBase64: 'AQID', mime: 'image/png' } });
  const { result } = renderHook(() => usePreviewLauncher());
  await act(() => result.current.launchPreview({ remoteConversationId: 'conversation', relativePath: '图.png', contentType: 'image', editable: false }));
  expect(mocks.open).toHaveBeenCalledWith('data:image/png;base64,AQID', 'image', expect.objectContaining({ remote: true, downloadBase64: 'AQID', downloadMime: 'image/png' }));
  expect(mocks.image).not.toHaveBeenCalled();
});

it('prepares a cloud CSV for the spreadsheet preview using its exact contents', async () => {
  mocks.remote.mockResolvedValue({ success: true, data: { kind: 'text', content: 'name,total\n螺丝,107.5', mime: 'text/csv' } });
  mocks.temp.mockResolvedValue('/temp/报价.csv');
  mocks.write.mockResolvedValue(true);
  const { result } = renderHook(() => usePreviewLauncher());
  await act(() => result.current.launchPreview({ remoteConversationId: 'conversation', relativePath: '报价.csv', contentType: 'excel', editable: false }));
  expect(mocks.write).toHaveBeenCalledWith({ path: '/temp/报价.csv', data: 'name,total\n螺丝,107.5' });
  expect(mocks.open).toHaveBeenCalledWith('name,total\n螺丝,107.5', 'excel', expect.objectContaining({ remote: true, localPreviewFilePath: '/temp/报价.csv' }));
});
