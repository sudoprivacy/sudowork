/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IDirOrFile } from '@sudowork/host-bridge/ipcBridge';

const encodeBase64 = (content: string): string => {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const mocks = vi.hoisted(() => ({
  previewRemoteWorkspaceFile: vi.fn(),
  createTempFile: vi.fn(),
  writeFile: vi.fn(),
  isLibreOfficeAvailable: vi.fn(),
}));

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: {
    previewRemoteWorkspaceFile: {
      invoke: mocks.previewRemoteWorkspaceFile,
    },
  },
  fs: {
    createTempFile: {
      invoke: mocks.createTempFile,
    },
    writeFile: {
      invoke: mocks.writeFile,
    },
  },
  document: {
    libreOffice: {
      isAvailable: {
        invoke: mocks.isLibreOfficeAvailable,
      },
    },
  },
}));

const { useWorkspaceFileOps } = await import('@renderer/pages/conversation/workspace/hooks/useWorkspaceFileOps');

function createFile(name: string): IDirOrFile {
  return {
    name,
    fullPath: `/remote/workspace/${name}`,
    relativePath: name,
    isDir: false,
    isFile: true,
  } as IDirOrFile;
}

function createOptions(openPreview = vi.fn()) {
  return {
    workspace: '/remote/workspace',
    eventPrefix: 'remote-agent' as const,
    conversation_id: 'conversation-1',
    dataSource: 'moss-session' as const,
    readonly: true,
    messageApi: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
    t: (key: string) => key,
    setFiles: vi.fn(),
    setSelected: vi.fn(),
    setExpandedKeys: vi.fn(),
    selectedKeysRef: { current: [] },
    selectedNodeRef: { current: null },
    ensureNodeSelected: vi.fn(),
    refreshWorkspace: vi.fn(),
    renameModal: { visible: false, value: '', target: null },
    deleteModal: { visible: false, target: null, loading: false },
    renameLoading: false,
    setRenameLoading: vi.fn(),
    closeRenameModal: vi.fn(),
    closeDeleteModal: vi.fn(),
    closeContextMenu: vi.fn(),
    setRenameModal: vi.fn(),
    setDeleteModal: vi.fn(),
    openPreview,
  };
}

function mockRemoteTextFile(name: string, content: string, options?: { mime?: string; truncated?: boolean }) {
  mocks.previewRemoteWorkspaceFile.mockResolvedValue({
    success: true,
    data: {
      kind: 'text',
      name,
      relativePath: name,
      mime: options?.mime || 'text/plain',
      encoding: 'utf8',
      content,
      size: content.length,
      truncated: Boolean(options?.truncated),
    },
  });
}

function mockRemoteBase64File(name: string, bytes: string, mime = 'application/octet-stream') {
  mocks.previewRemoteWorkspaceFile.mockResolvedValue({
    success: true,
    data: {
      kind: 'base64',
      name,
      relativePath: name,
      mime,
      contentBase64: encodeBase64(bytes),
      size: bytes.length,
    },
  });
}

describe('useWorkspaceFileOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLibreOfficeAvailable.mockResolvedValue(true);
    mockRemoteBase64File('report.docx', 'PK docx-bytes', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    mocks.createTempFile.mockImplementation(({ fileName }) => Promise.resolve(`/tmp/sudowork/${fileName}`));
    mocks.writeFile.mockResolvedValue(true);
  });

  it('opens remote docx files with the Word previewer using a local read-only preview file', async () => {
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile('report.docx'));

    expect(mocks.previewRemoteWorkspaceFile).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      path: 'report.docx',
    });
    expect(mocks.createTempFile).toHaveBeenCalledWith({ fileName: 'report.docx' });
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: '/tmp/sudowork/report.docx',
      data: expect.any(Uint8Array),
    });
    expect(openPreview).toHaveBeenCalledWith(
      encodeBase64('PK docx-bytes'),
      'word',
      expect.objectContaining({
        fileName: 'report.docx',
        remote: true,
        editable: false,
        localPreviewFilePath: '/tmp/sudowork/report.docx',
        downloadBase64: encodeBase64('PK docx-bytes'),
      })
    );
  });

  it('opens remote doc files containing UTF-8 markdown as markdown to avoid garbled PDF conversion', async () => {
    const markdown = '# sudowork 介绍\n\n- 支持 AI 生成文档\n';
    mockRemoteBase64File('sudowork-介绍.doc', markdown, 'application/msword');
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile('sudowork-介绍.doc'));

    expect(mocks.createTempFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(openPreview).toHaveBeenCalledWith(
      markdown,
      'markdown',
      expect.objectContaining({
        fileName: 'sudowork-介绍.doc',
        remote: true,
        editable: false,
        localPreviewFilePath: undefined,
        downloadBase64: encodeBase64(markdown),
      })
    );
  });

  it('opens remote doc files returned as text markdown without creating a local preview file', async () => {
    const markdown = '# sudowork 介绍\n\n- 支持 AI 生成文档\n';
    mockRemoteTextFile('sudowork-介绍.doc', markdown, { mime: 'text/plain' });
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile('sudowork-介绍.doc'));

    expect(mocks.createTempFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(openPreview).toHaveBeenCalledWith(
      markdown,
      'markdown',
      expect.objectContaining({
        fileName: 'sudowork-介绍.doc',
        remote: true,
        editable: false,
        localPreviewFilePath: undefined,
      })
    );
  });

  it.each([
    ['slides.pptx', 'ppt', 'pptx-bytes', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['sheet.xlsx', 'excel', 'xlsx-bytes', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['paper.pdf', 'pdf', 'pdf-bytes', 'application/pdf'],
    ['demo.mp4', 'video', 'mp4-bytes', 'video/mp4'],
    ['voice.mp3', 'audio', 'mp3-bytes', 'audio/mpeg'],
  ] as const)('opens remote %s with a local read-only preview file', async (fileName, contentType, bytes, mime) => {
    mockRemoteBase64File(fileName, bytes, mime);
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile(fileName));

    expect(mocks.createTempFile).toHaveBeenCalledWith({ fileName });
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: `/tmp/sudowork/${fileName}`,
      data: expect.any(Uint8Array),
    });
    expect(openPreview).toHaveBeenCalledWith(
      contentType === 'ppt' || contentType === 'excel' ? encodeBase64(bytes) : '',
      contentType,
      expect.objectContaining({
        fileName,
        remote: true,
        editable: false,
        localPreviewFilePath: `/tmp/sudowork/${fileName}`,
        downloadBase64: encodeBase64(bytes),
        downloadMime: mime,
      })
    );
  });

  it.each([
    ['README.md', 'markdown', '# Title'],
    ['changes.diff', 'diff', '-old\n+new'],
    ['main.ts', 'code', 'const value = 1;'],
  ] as const)('opens remote text %s as %s without creating a local preview file', async (fileName, contentType, content) => {
    mockRemoteTextFile(fileName, content);
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile(fileName));

    expect(mocks.createTempFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(openPreview).toHaveBeenCalledWith(
      content,
      contentType,
      expect.objectContaining({
        fileName,
        remote: true,
        editable: false,
        localPreviewFilePath: undefined,
      })
    );
  });

  it('opens remote text csv as an excel preview using a local read-only preview file', async () => {
    const content = 'name,score\nAda,99\nLinus,95\n';
    mockRemoteTextFile('scores.csv', content, { mime: 'text/csv' });
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile('scores.csv'));

    expect(mocks.createTempFile).toHaveBeenCalledWith({ fileName: 'scores.csv' });
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: '/tmp/sudowork/scores.csv',
      data: content,
    });
    expect(openPreview).toHaveBeenCalledWith(
      content,
      'excel',
      expect.objectContaining({
        fileName: 'scores.csv',
        remote: true,
        editable: false,
        localPreviewFilePath: '/tmp/sudowork/scores.csv',
      })
    );
  });

  it('opens remote text HTML with a local read-only preview file', async () => {
    const content = '<!doctype html><html><body><main>hello</main></body></html>';
    mockRemoteTextFile('index.html', content, { mime: 'text/html' });
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile('index.html'));

    expect(mocks.createTempFile).toHaveBeenCalledWith({ fileName: 'index.html' });
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: '/tmp/sudowork/index.html',
      data: content,
    });
    expect(openPreview).toHaveBeenCalledWith(
      content,
      'html',
      expect.objectContaining({
        fileName: 'index.html',
        remote: true,
        editable: false,
        localPreviewFilePath: '/tmp/sudowork/index.html',
      })
    );
  });

  it('opens remote images as data URLs without creating a local preview file', async () => {
    mockRemoteBase64File('image.png', 'png-bytes', 'image/png');
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(createOptions(openPreview)));

    await result.current.handlePreviewFile(createFile('image.png'));

    expect(mocks.createTempFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(openPreview).toHaveBeenCalledWith(
      `data:image/png;base64,${encodeBase64('png-bytes')}`,
      'image',
      expect.objectContaining({
        fileName: 'image.png',
        remote: true,
        editable: false,
        downloadBase64: encodeBase64('png-bytes'),
      })
    );
  });
});
