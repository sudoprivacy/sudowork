/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for DingTalkPlugin media upload and send functionality.
 *
 * Strategy: Mock `https` and `fs` modules via vi.doMock, then use
 * vi.resetModules() + dynamic import() to load DingTalkPlugin with mocks.
 * Access private methods via (instance as any).
 */

// ---- Shared mock state (set before each loadPluginWithMocks call) ----
let mockUploadResponse: any;
let mockApiRequestResponse: any;
let mockRequestError: Error | null;
let mockFsExistsSync: boolean;
let fsReadFileSyncMock: ReturnType<typeof vi.fn>;

// ---- Captured request data ----
interface CapturedRequest {
  options: any;
  writeData: Buffer[];
  endCalled: boolean;
  responseCallback: ((res: any) => void) | null;
}
let capturedRequests: CapturedRequest[];

/**
 * Create a mock https.request that captures requests and auto-responds.
 */
function createMockHttpsRequest() {
  capturedRequests = [];

  return (optionsOrUrl: any, responseCallback?: (res: any) => void) => {
    const writeData: Buffer[] = [];
    const req: CapturedRequest = {
      options: optionsOrUrl,
      writeData,
      endCalled: false,
      responseCallback: responseCallback || null,
    };
    capturedRequests.push(req);

    const mockReq = {
      on: vi.fn((_event: string, _handler: (...args: any[]) => void) => mockReq),
      setTimeout: vi.fn((_ms: number, _handler: () => void) => {}),
      write: vi.fn((data: any) => {
        writeData.push(typeof data === 'string' ? Buffer.from(data, 'utf-8') : data);
      }),
      end: vi.fn(() => {
        req.endCalled = true;
        if (req.responseCallback) {
          // Determine response based on request path (options.path, not full URL)
          const reqPath = optionsOrUrl.path || '';
          let responseData: string;

          if (reqPath.includes('/media/upload')) {
            responseData = JSON.stringify(mockUploadResponse);
          } else {
            responseData = JSON.stringify(mockApiRequestResponse);
          }

          const mockRes = {
            statusCode: 200,
            on: vi.fn((event: string, handler: (...args: any[]) => void) => {
              if (event === 'data') handler(responseData);
              if (event === 'end') handler();
            }),
          };

          req.responseCallback(mockRes);
        }
      }),
      destroy: vi.fn(),
    };

    if (mockRequestError) {
      setTimeout(() => {
        const errorCall = mockReq.on.mock.calls.find((c: any[]) => c[0] === 'error');
        if (errorCall) errorCall[1](mockRequestError);
      }, 0);
    }

    return mockReq;
  };
}

async function loadPluginWithMocks() {
  vi.resetModules();

  mockFsExistsSync = true;
  fsReadFileSyncMock = vi.fn(() => Buffer.from('fake-file-content'));
  mockUploadResponse = { errcode: 0, media_id: '@test_media_id_123', type: 'image' };
  mockApiRequestResponse = { processQueryKey: 'test_process_key' };
  mockRequestError = null;

  const mockHttpsRequest = createMockHttpsRequest();

  vi.doMock('fs', () => ({
    default: {
      existsSync: vi.fn(() => mockFsExistsSync),
      readFileSync: fsReadFileSyncMock,
      writeFileSync: vi.fn(),
    },
    existsSync: vi.fn(() => mockFsExistsSync),
    readFileSync: fsReadFileSyncMock,
    writeFileSync: vi.fn(),
  }));

  vi.doMock('https', () => ({
    default: { request: mockHttpsRequest },
    request: mockHttpsRequest,
  }));

  vi.doMock('dingtalk-stream', () => ({
    DWClient: vi.fn(),
    TOPIC_ROBOT: 'TOPIC_ROBOT',
    TOPIC_CARD: 'TOPIC_CARD',
    EventAck: { SUCCESS: 'SUCCESS' },
  }));

  vi.doMock('@/process/utils/mainLogger', () => ({
    mainLog: vi.fn(),
    mainWarn: vi.fn(),
    mainError: vi.fn(),
  }));

  vi.doMock('@/channels/plugins/dingtalk/DingTalkAdapter', () => ({
    DINGTALK_MESSAGE_LIMIT: 20000,
    encodeChatId: vi.fn(),
    extractCardAction: vi.fn(),
    parseChatId: vi.fn((chatId: string) => {
      if (chatId.startsWith('user:')) return { type: 'user' as const, id: chatId.slice(5) };
      if (chatId.startsWith('group:')) return { type: 'group' as const, id: chatId.slice(6) };
      return { type: 'user' as const, id: chatId };
    }),
    toDingTalkSendParams: vi.fn(() => ({
      contentType: 'markdown',
      content: { title: 'Message', text: 'test' },
      rawText: 'test',
    })),
    toUnifiedIncomingMessage: vi.fn(),
    convertHtmlToDingTalkMarkdown: vi.fn((s: string) => s),
    getDefaultExtension: vi.fn(),
    getDefaultMimeType: vi.fn(),
    extractMediaDownloadInfo: vi.fn(),
    setMediaLocalPath: vi.fn(),
    getUploadMediaType: vi.fn((fileName: string) => {
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      return ['jpg', 'jpeg', 'gif', 'png', 'bmp'].includes(ext) ? 'image' : 'file';
    }),
    getDingTalkFileType: vi.fn((fileName: string) => {
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      const map: Record<string, string> = {
        pdf: 'pdf',
        doc: 'doc',
        docx: 'doc',
        xls: 'xlsx',
        xlsx: 'xlsx',
        ppt: 'ppt',
        pptx: 'ppt',
        zip: 'zip',
        rar: 'rar',
      };
      return map[ext] || 'pdf';
    }),
  }));

  vi.doMock('@/channels/plugins/BasePlugin', () => {
    class BasePlugin {
      type = 'dingtalk';
      protected _status = 'created';
      protected config: any = null;
      protected messageHandler: any = null;
      protected confirmHandler: any = null;
      getStatus() {
        return this._status;
      }
      getConfig() {
        return this.config;
      }
      setMessageHandler(h: any) {
        this.messageHandler = h;
      }
      setConfirmHandler(h: any) {
        this.confirmHandler = h;
      }
    }
    return { BasePlugin };
  });

  return await import('@/channels/plugins/dingtalk/DingTalkPlugin');
}

// ==================== uploadMedia ====================

describe('DingTalkPlugin uploadMedia', () => {
  it('uploads image file and returns media_id', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-access-token', expiresAt: Date.now() + 3600000 };

    const result = await (plugin as any).uploadMedia('/tmp/photo.jpg', 'image');

    expect(result).toBe('@test_media_id_123');

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeDefined();
    expect(uploadReq!.options.path).toContain('access_token=test-access-token');
    expect(uploadReq!.options.path).toContain('type=image');
    expect(uploadReq!.options.method).toBe('POST');
    expect(uploadReq!.options.headers['Content-Type']).toContain('multipart/form-data');
    expect(uploadReq!.options.headers['Content-Type']).toContain('boundary=');
    expect(uploadReq!.endCalled).toBe(true);
    expect(fsReadFileSyncMock).toHaveBeenCalledWith('/tmp/photo.jpg');
  });

  it('uploads file with type=file parameter', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };

    await (plugin as any).uploadMedia('/tmp/report.pdf', 'file');

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeDefined();
    expect(uploadReq!.options.path).toContain('type=file');
  });

  it('throws error when file does not exist', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    mockFsExistsSync = false;

    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };

    await expect((plugin as any).uploadMedia('/tmp/nonexistent.jpg', 'image')).rejects.toThrow('File not found');
  });

  it('throws error when upload API returns errcode != 0', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    mockUploadResponse = { errcode: 40004, errmsg: '不合法的媒体文件类型' };

    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };

    await expect((plugin as any).uploadMedia('/tmp/bad.jpg', 'image')).rejects.toThrow('errcode=40004');
  });

  it('throws error when upload response has no media_id', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    mockUploadResponse = { errcode: 0, errmsg: 'ok', type: 'image' };

    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };

    await expect((plugin as any).uploadMedia('/tmp/empty.jpg', 'image')).rejects.toThrow('no media_id');
  });

  it('multipart body uses an ASCII placeholder filename in Content-Disposition', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };

    await (plugin as any).uploadMedia('/tmp/my_photo.jpg', 'image');

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeDefined();

    const bodyStr = Buffer.concat(uploadReq!.writeData).toString('utf-8');
    expect(bodyStr).toContain('filename="upload.jpg"');
    expect(bodyStr).toContain('name="media"');
  });

  it('multipart body contains file content', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };

    await (plugin as any).uploadMedia('/tmp/photo.jpg', 'image');

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeDefined();

    const bodyStr = Buffer.concat(uploadReq!.writeData).toString('binary');
    expect(bodyStr).toContain('fake-file-content');
  });

  it('encodes access_token with special characters in URL', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'token=special&chars', expiresAt: Date.now() + 3600000 };

    await (plugin as any).uploadMedia('/tmp/photo.jpg', 'image');

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeDefined();
    expect(uploadReq!.options.path).toContain('access_token=');
    // Special chars should be encoded
    expect(uploadReq!.options.path).not.toContain('token=special&chars');
  });
});

// ==================== sendMediaViaAPI ====================

describe('DingTalkPlugin sendMediaViaAPI', () => {
  async function createPlugin() {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };
    return plugin;
  }

  it('sends image via user chat with sampleImageMsg', async () => {
    const plugin = await createPlugin();

    const result = await (plugin as any).sendMediaViaAPI('user', 'user123', 'image', '@media_abc');

    expect(result).toBe('test_process_key');

    const apiReq = capturedRequests.find((r) => r.options.path?.includes('oToMessages/batchSend'));
    expect(apiReq).toBeDefined();

    const body = JSON.parse(Buffer.concat(apiReq!.writeData).toString('utf-8'));
    expect(body.msgKey).toBe('sampleImageMsg');
    expect(body.robotCode).toBe('test-client-id');
    expect(body.userIds).toEqual(['user123']);

    const msgParam = JSON.parse(body.msgParam);
    expect(msgParam.photoURL).toBe('@media_abc');
  });

  it('sends file via user chat with sampleFile', async () => {
    const plugin = await createPlugin();

    const result = await (plugin as any).sendMediaViaAPI('user', 'user123', 'file', '@media_xyz', 'report.pdf', 'pdf');

    expect(result).toBe('test_process_key');

    const apiReq = capturedRequests.find((r) => r.options.path?.includes('oToMessages/batchSend'));
    expect(apiReq).toBeDefined();

    const body = JSON.parse(Buffer.concat(apiReq!.writeData).toString('utf-8'));
    expect(body.msgKey).toBe('sampleFile');
    expect(body.robotCode).toBe('test-client-id');
    expect(body.userIds).toEqual(['user123']);

    const msgParam = JSON.parse(body.msgParam);
    expect(msgParam.mediaId).toBe('@media_xyz');
    expect(msgParam.fileName).toBe('report.pdf');
    expect(msgParam.fileType).toBe('pdf');
  });

  it('sends image via group chat with groupMessages/send', async () => {
    const plugin = await createPlugin();

    await (plugin as any).sendMediaViaAPI('group', 'group456', 'image', '@media_abc');

    const apiReq = capturedRequests.find((r) => r.options.path?.includes('groupMessages/send'));
    expect(apiReq).toBeDefined();

    const body = JSON.parse(Buffer.concat(apiReq!.writeData).toString('utf-8'));
    expect(body.msgKey).toBe('sampleImageMsg');
    expect(body.openConversationId).toBe('group456');
    expect(body.robotCode).toBe('test-client-id');

    const msgParam = JSON.parse(body.msgParam);
    expect(msgParam.photoURL).toBe('@media_abc');
  });

  it('sends file via group chat with correct fileType', async () => {
    const plugin = await createPlugin();

    await (plugin as any).sendMediaViaAPI('group', 'group456', 'file', '@media_xyz', 'data.xlsx', 'xlsx');

    const apiReq = capturedRequests.find((r) => r.options.path?.includes('groupMessages/send'));
    expect(apiReq).toBeDefined();

    const body = JSON.parse(Buffer.concat(apiReq!.writeData).toString('utf-8'));
    expect(body.msgKey).toBe('sampleFile');

    const msgParam = JSON.parse(body.msgParam);
    expect(msgParam.mediaId).toBe('@media_xyz');
    expect(msgParam.fileName).toBe('data.xlsx');
    expect(msgParam.fileType).toBe('xlsx');
  });

  it('uses x-acs-dingtalk-access-token header', async () => {
    const plugin = await createPlugin();

    await (plugin as any).sendMediaViaAPI('user', 'user123', 'image', '@media_abc');

    const apiReq = capturedRequests.find((r) => r.options.path?.includes('oToMessages/batchSend'));
    expect(apiReq).toBeDefined();
    expect(apiReq!.options.headers['x-acs-dingtalk-access-token']).toBe('test-token');
    expect(apiReq!.options.headers['Content-Type']).toBe('application/json');
  });
});

// ==================== sendMessage routing ====================

describe('DingTalkPlugin sendMessage routing', () => {
  async function createPlugin() {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };
    (plugin as any).ensureAccessToken = vi.fn(async () => {});
    return plugin;
  }

  it('routes image message to upload + sendMediaViaAPI', async () => {
    const plugin = await createPlugin();

    await plugin.sendMessage('user:user123', {
      type: 'image',
      imageUrl: '/tmp/photo.jpg',
    });

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    const sendReq = capturedRequests.find((r) => r.options.path?.includes('oToMessages/batchSend'));
    expect(uploadReq).toBeDefined();
    expect(sendReq).toBeDefined();

    const body = JSON.parse(Buffer.concat(sendReq!.writeData).toString('utf-8'));
    expect(body.msgKey).toBe('sampleImageMsg');
  });

  it('routes file message to upload + sendMediaViaAPI', async () => {
    const plugin = await createPlugin();

    await plugin.sendMessage('user:user123', {
      type: 'file',
      fileUrl: '/tmp/report.pdf',
      fileName: 'report.pdf',
    });

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    const sendReq = capturedRequests.find((r) => r.options.path?.includes('oToMessages/batchSend'));
    expect(uploadReq).toBeDefined();
    expect(sendReq).toBeDefined();

    const body = JSON.parse(Buffer.concat(sendReq!.writeData).toString('utf-8'));
    expect(body.msgKey).toBe('sampleFile');
    const msgParam = JSON.parse(body.msgParam);
    expect(msgParam.fileName).toBe('report.pdf');
    expect(msgParam.fileType).toBe('pdf');
  });

  it('skips image send when imageUrl is empty - no upload request made', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };
    (plugin as any).ensureAccessToken = vi.fn(async () => {});
    (plugin as any).createAndDeliverAICard = vi.fn(() => Promise.reject(new Error('no AI card')));
    (plugin as any).webhookCache = new Map();

    // imageUrl is empty → skip image branch, fall through to existing markdown path
    // The existing path will succeed via mocked API send
    await plugin.sendMessage('user:user123', { type: 'image' });

    // Verify no upload request was made
    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeUndefined();
  });

  it('skips file send when fileUrl is missing - no upload request made', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };
    (plugin as any).ensureAccessToken = vi.fn(async () => {});
    (plugin as any).createAndDeliverAICard = vi.fn(() => Promise.reject(new Error('no AI card')));
    (plugin as any).webhookCache = new Map();

    await plugin.sendMessage('user:user123', { type: 'file', fileName: 'test.pdf' });

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeUndefined();
  });

  it('skips file send when fileName is missing - no upload request made', async () => {
    const { DingTalkPlugin } = await loadPluginWithMocks();
    const plugin = new DingTalkPlugin();
    (plugin as any).clientId = 'test-client-id';
    (plugin as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };
    (plugin as any).ensureAccessToken = vi.fn(async () => {});
    (plugin as any).createAndDeliverAICard = vi.fn(() => Promise.reject(new Error('no AI card')));
    (plugin as any).webhookCache = new Map();

    await plugin.sendMessage('user:user123', { type: 'file', fileUrl: '/tmp/test.pdf' });

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    expect(uploadReq).toBeUndefined();
  });

  it('routes group chat file message correctly', async () => {
    const plugin = await createPlugin();

    await plugin.sendMessage('group:group789', {
      type: 'file',
      fileUrl: '/tmp/data.xlsx',
      fileName: 'data.xlsx',
    });

    const uploadReq = capturedRequests.find((r) => r.options.path?.includes('/media/upload'));
    const sendReq = capturedRequests.find((r) => r.options.path?.includes('groupMessages/send'));
    expect(uploadReq).toBeDefined();
    expect(sendReq).toBeDefined();

    const body = JSON.parse(Buffer.concat(sendReq!.writeData).toString('utf-8'));
    expect(body.openConversationId).toBe('group789');
    expect(body.msgKey).toBe('sampleFile');
    const msgParam = JSON.parse(body.msgParam);
    expect(msgParam.fileType).toBe('xlsx');
  });
});
