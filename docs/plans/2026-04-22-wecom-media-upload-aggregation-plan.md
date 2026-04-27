# 企业微信媒体上传与消息聚合实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现企业微信媒体上传（分片上传临时素材）和消息聚合（解决图文混合重复回复问题）

**Architecture:** 新增 WeComUploader.ts 处理 WebSocket 分片上传（init/chunk/finish 三步流程），MessageAggregator.ts 实现消息聚合窗口（800ms等待合并多回调），修改 WeComPlugin.ts 集成两者。

**Tech Stack:** TypeScript, Node.js crypto (MD5), WebSocket, Base64 encoding

---

## Task 1: 媒体类型检测与大小验证

**Files:**
- Create: `src/channels/plugins/wecom/WeComMediaUtils.ts`
- Test: `tests/unit/channels/wecomMediaUtils.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/channels/wecomMediaUtils.test.ts
import { describe, it, expect } from 'vitest';
import { detectMediaType, validateSize, SIZE_LIMITS } from '@/channels/plugins/wecom/WeComMediaUtils';

describe('WeComMediaUtils', () => {
  describe('detectMediaType', () => {
    it('should detect JPEG from magic bytes', () => {
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(detectMediaType(jpegHeader)).toBe('image');
    });

    it('should detect PNG from magic bytes', () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      expect(detectMediaType(pngHeader)).toBe('image');
    });

    it('should detect PDF from magic bytes', () => {
      const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46]);
      expect(detectMediaType(pdfHeader)).toBe('file');
    });

    it('should default to file for unknown types', () => {
      const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(detectMediaType(unknownBuffer)).toBe('file');
    });
  });

  describe('validateSize', () => {
    it('should accept image under 10MB', () => {
      const result = validateSize(5 * 1024 * 1024, 'image');
      expect(result.shouldReject).toBe(false);
      expect(result.finalType).toBe('image');
    });

    it('should reject image over 10MB', () => {
      const result = validateSize(15 * 1024 * 1024, 'image');
      expect(result.shouldReject).toBe(true);
      expect(result.rejectReason).toContain('10MB');
    });

    it('should downgrade oversized image to file', () => {
      // 15MB image should be downgraded to file (not rejected since file limit is 20MB)
      const result = validateSize(15 * 1024 * 1024, 'image');
      expect(result.shouldReject).toBe(false); // 15MB fits file limit
    });

    it('should accept file under 20MB', () => {
      const result = validateSize(18 * 1024 * 1024, 'file');
      expect(result.shouldReject).toBe(false);
    });

    it('should reject file over 20MB', () => {
      const result = validateSize(25 * 1024 * 1024, 'file');
      expect(result.shouldReject).toBe(true);
      expect(result.rejectReason).toContain('20MB');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test tests/unit/channels/wecomMediaUtils.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/channels/plugins/wecom/WeComMediaUtils.ts
/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 媒体大小限制（字节）
 */
export const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,      // 10MB
  voice: 2 * 1024 * 1024,       // 2MB
  video: 10 * 1024 * 1024,      // 10MB
  file: 20 * 1024 * 1024,       // 20MB
};

export type WeComMediaType = 'image' | 'voice' | 'video' | 'file';

/**
 * 文件大小检查结果
 */
export interface SizeCheckResult {
  finalType: WeComMediaType;
  shouldReject: boolean;
  rejectReason?: string;
  downgraded?: boolean;
  downgradeNote?: string;
}

/**
 * 通过魔术字节检测媒体类型
 */
export function detectMediaType(buffer: Buffer): WeComMediaType {
  if (buffer.length < 4) return 'file';

  const signature = buffer.slice(0, 4).toString('hex');

  // 图片格式
  const imageSignatures = ['ffd8ffe0', 'ffd8ffe1', '89504e47', '47494638'];
  if (imageSignatures.some(s => signature.startsWith(s.slice(0, 4)))) {
    return 'image';
  }

  // PDF
  if (signature === '25504446') {
    return 'file';
  }

  // 视频 MP4 (ftyp box)
  if (buffer.length >= 8) {
    const mp4Check = buffer.slice(4, 8).toString();
    if (mp4Check === 'ftyp') {
      return 'video';
    }
  }

  // 默认为文件
  return 'file';
}

/**
 * 验证文件大小并处理降级策略
 */
export function validateSize(fileSize: number, type: WeComMediaType): SizeCheckResult {
  const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

  // 超过绝对上限 20MB
  if (fileSize > SIZE_LIMITS.file) {
    return {
      finalType: type,
      shouldReject: true,
      rejectReason: `文件大小 ${fileSizeMB}MB 超过了企业微信允许的最大限制 20MB，无法发送`,
      downgraded: false,
    };
  }

  // 按类型检查
  if (type === 'image' && fileSize > SIZE_LIMITS.image) {
    return {
      finalType: 'file',
      shouldReject: false,
      downgraded: true,
      downgradeNote: `图片大小 ${fileSizeMB}MB 超过 10MB 限制，已转为文件格式发送`,
    };
  }

  if (type === 'video' && fileSize > SIZE_LIMITS.video) {
    return {
      finalType: 'file',
      shouldReject: false,
      downgraded: true,
      downgradeNote: `视频大小 ${fileSizeMB}MB 超过 10MB 限制，已转为文件格式发送`,
    };
  }

  if (type === 'voice' && fileSize > SIZE_LIMITS.voice) {
    return {
      finalType: 'file',
      shouldReject: false,
      downgraded: true,
      downgradeNote: `语音大小 ${fileSizeMB}MB 超过 2MB 限制，已转为文件格式发送`,
    };
  }

  return {
    finalType: type,
    shouldReject: false,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test tests/unit/channels/wecomMediaUtils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/plugins/wecom/WeComMediaUtils.ts tests/unit/channels/wecomMediaUtils.test.ts
git commit -m "feat(wecom): add media type detection and size validation"
```

---

## Task 2: WebSocket 响应等待器

**Files:**
- Create: `src/channels/plugins/wecom/WeComUploader.ts` (Part 1 - WebSocket helper)
- Test: `tests/unit/channels/wecomUploader.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/channels/wecomUploader.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsCommandSender, UPLOAD_TIMEOUT_MS } from '@/channels/plugins/wecom/WeComUploader';
import WebSocket from 'ws';

describe('WeComUploader', () => {
  describe('WsCommandSender', () => {
    it('should send command and wait for response', async () => {
      const ws = new WebSocket('ws://localhost:8080');
      vi.spyOn(ws, 'send').mockImplementation(() => {});

      const sender = new WsCommandSender(ws);

      // Simulate response
      setTimeout(() => {
        sender.handleResponse({ req_id: 'test-123', errcode: 0, body: { upload_id: 'upload-abc' } });
      }, 100);

      const result = await sender.sendCommand({
        cmd: 'test_cmd',
        headers: { req_id: 'test-123' },
        body: {}
      });

      expect(result.errcode).toBe(0);
      expect(result.body.upload_id).toBe('upload-abc');
    });

    it('should timeout if no response', async () => {
      const ws = new WebSocket('ws://localhost:8080');
      vi.spyOn(ws, 'send').mockImplementation(() => {});

      const sender = new WsCommandSender(ws, 100); // 100ms timeout

      await expect(sender.sendCommand({
        cmd: 'test_cmd',
        headers: { req_id: 'test-456' },
        body: {}
      })).rejects.toThrow('timeout');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test tests/unit/channels/wecomUploader.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/channels/plugins/wecom/WeComUploader.ts
/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';
import { createHash } from 'crypto';
import type { WeComMediaType } from './WeComMediaUtils';

/**
 * 分片大小：512KB（Base64编码前）
 */
export const CHUNK_SIZE = 512 * 1024;

/**
 * 最大分片数（对应50MB）
 */
export const MAX_CHUNKS = 100;

/**
 * 上传超时时间
 */
export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * WebSocket 响应接口
 */
export interface WsResponse {
  errcode?: number;
  errmsg?: string;
  body?: Record<string, unknown>;
}

/**
 * WebSocket 响应等待器
 * 管理命令发送和响应匹配
 */
export class WsCommandSender {
  private pendingRequests: Map<string, {
    resolve: (response: WsResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(
    private ws: WebSocket,
    private timeoutMs: number = UPLOAD_TIMEOUT_MS
  ) {}

  /**
   * 发送命令并等待响应
   */
  async sendCommand(data: {
    cmd: string;
    headers: { req_id: string };
    body: Record<string, unknown>;
  }): Promise<WsResponse> {
    const reqId = data.headers.req_id;

    return new Promise((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`WebSocket command ${data.cmd} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      // 注册等待
      this.pendingRequests.set(reqId, { resolve, reject, timer });

      // 发送命令
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
      } else {
        clearTimeout(timer);
        this.pendingRequests.delete(reqId);
        reject(new Error('WebSocket not connected'));
      }
    });
  }

  /**
   * 处理收到的响应
   */
  handleResponse(response: { req_id?: string } & WsResponse): void {
    const reqId = response.req_id;
    if (!reqId) return;

    const pending = this.pendingRequests.get(reqId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(reqId);

    if (response.errcode !== undefined && response.errcode !== 0) {
      pending.reject(new Error(`WeCom error ${response.errcode}: ${response.errmsg || 'unknown'}`));
    } else {
      pending.resolve(response);
    }
  }
}

/**
 * 计算 Buffer 的 MD5
 */
export function calculateMd5(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex');
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test tests/unit/channels/wecomUploader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/plugins/wecom/WeComUploader.ts tests/unit/channels/wecomUploader.test.ts
git commit -m "feat(wecom): add WebSocket command sender for upload"
```

---

## Task 3: 分片上传流程实现

**Files:**
- Modify: `src/channels/plugins/wecom/WeComUploader.ts` (add uploadMedia)
- Modify: `tests/unit/channels/wecomUploader.test.ts` (add tests)

**Step 1: Write the failing test**

```typescript
// Add to tests/unit/channels/wecomUploader.test.ts
describe('uploadMedia', () => {
  it('should upload small file in one chunk', async () => {
    const mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      on: vi.fn(),
    } as any;

    const sender = new WsCommandSender(mockWs);

    // Mock init response
    setTimeout(() => sender.handleResponse({
      req_id: 'init-1',
      errcode: 0,
      body: { upload_id: 'upload-1' }
    }), 50);

    // Mock chunk response
    setTimeout(() => sender.handleResponse({
      req_id: 'chunk-0',
      errcode: 0
    }), 100);

    // Mock finish response
    setTimeout(() => sender.handleResponse({
      req_id: 'finish-1',
      errcode: 0,
      body: { media_id: 'media-abc-123' }
    }), 150);

    const smallBuffer = Buffer.from('test content');

    const result = await uploadMedia(sender, smallBuffer, {
      type: 'file',
      filename: 'test.txt'
    });

    expect(result).toBe('media-abc-123');
    expect(mockWs.send).toHaveBeenCalledTimes(3);
  });

  it('should upload large file in multiple chunks', async () => {
    const mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as any;

    const sender = new WsCommandSender(mockWs, 500);

    // Create buffer larger than CHUNK_SIZE
    const largeBuffer = Buffer.alloc(CHUNK_SIZE * 2 + 100, 0x42);

    const totalChunks = Math.ceil(largeBuffer.length / CHUNK_SIZE);
    expect(totalChunks).toBe(3);

    // Mock responses
    setTimeout(() => sender.handleResponse({
      req_id: 'init-2',
      errcode: 0,
      body: { upload_id: 'upload-2' }
    }), 50);

    // Mock chunk responses for each chunk
    for (let i = 0; i < totalChunks; i++) {
      setTimeout(() => sender.handleResponse({
        req_id: `chunk-${i}`,
        errcode: 0
      }), 100 + i * 50);
    }

    setTimeout(() => sender.handleResponse({
      req_id: 'finish-2',
      errcode: 0,
      body: { media_id: 'media-large-123' }
    }), 300);

    const result = await uploadMedia(sender, largeBuffer, {
      type: 'file',
      filename: 'large.bin'
    });

    expect(result).toBe('media-large-123');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test tests/unit/channels/wecomUploader.test.ts`
Expected: FAIL - uploadMedia not found

**Step 3: Write implementation**

```typescript
// Add to src/channels/plugins/wecom/WeComUploader.ts

/**
 * 上传选项
 */
export interface UploadOptions {
  type: WeComMediaType;
  filename: string;
}

/**
 * 分片上传媒体文件
 *
 * 流程：
 * 1. aibot_upload_media_init - 初始化上传
 * 2. aibot_upload_media_chunk - 分片上传（base64编码）
 * 3. aibot_upload_media_finish - 完成上传
 */
export async function uploadMedia(
  sender: WsCommandSender,
  buffer: Buffer,
  options: UploadOptions
): Promise<string> {
  const { type, filename } = options;

  // 计算分片数
  const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
  if (totalChunks > MAX_CHUNKS) {
    throw new Error(`文件过大，分片数 ${totalChunks} 超过最大限制 ${MAX_CHUNKS}`);
  }

  // 1. 初始化上传
  const initReqId = `upload_init_${Date.now()}`;
  const initResult = await sender.sendCommand({
    cmd: 'aibot_upload_media_init',
    headers: { req_id: initReqId },
    body: {
      type,
      filename,
      total_size: buffer.length,
      total_chunks: totalChunks,
      md5: calculateMd5(buffer),
    },
  });

  const uploadId = initResult.body?.upload_id as string;
  if (!uploadId) {
    throw new Error('上传初始化失败：未返回 upload_id');
  }

  // 2. 分片上传
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buffer.length);
    const chunk = buffer.slice(start, end);

    const chunkReqId = `upload_chunk_${uploadId}_${i}`;
    await sender.sendCommand({
      cmd: 'aibot_upload_media_chunk',
      headers: { req_id: chunkReqId },
      body: {
        upload_id: uploadId,
        chunk_index: i,
        base64_data: chunk.toString('base64'),
      },
    });
  }

  // 3. 完成上传
  const finishReqId = `upload_finish_${uploadId}`;
  const finishResult = await sender.sendCommand({
    cmd: 'aibot_upload_media_finish',
    headers: { req_id: finishReqId },
    body: { upload_id: uploadId },
  });

  const mediaId = finishResult.body?.media_id as string;
  if (!mediaId) {
    throw new Error('上传完成失败：未返回 media_id');
  }

  return mediaId;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test tests/unit/channels/wecomUploader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/plugins/wecom/WeComUploader.ts tests/unit/channels/wecomUploader.test.ts
git commit -m "feat(wecom): implement chunked media upload"
```

---

## Task 4: 媒体加载与发送集成

**Files:**
- Modify: `src/channels/plugins/wecom/WeComUploader.ts` (add loadMediaFromUrl)
- Modify: `src/channels/plugins/wecom/WeComPlugin.ts` (integrate upload into sendMessage)

**Step 1: Write test for loadMediaFromUrl**

```typescript
// Add to tests/unit/channels/wecomUploader.test.ts
import { loadMediaFromUrl } from '@/channels/plugins/wecom/WeComUploader';

describe('loadMediaFromUrl', () => {
  it('should load media from URL', async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    const result = await loadMediaFromUrl('https://example.com/image.jpg');
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(100);
  });

  it('should throw on fetch error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(loadMediaFromUrl('https://example.com/notfound.jpg'))
      .rejects.toThrow('404');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test tests/unit/channels/wecomUploader.test.ts`
Expected: FAIL - loadMediaFromUrl not exported

**Step 3: Write implementation**

```typescript
// Add to src/channels/plugins/wecom/WeComUploader.ts

/**
 * 从 URL 加载媒体文件
 */
export async function loadMediaFromUrl(url: string, timeoutMs = 30_000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Failed to load media: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Media load timed out');
    }
    throw error;
  }
}

/**
 * 从 URL 或本地路径提取文件名
 */
export function extractFilename(url: string): string {
  try {
    const urlObj = new URL(url, 'file://');
    const pathParts = urlObj.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && lastPart.includes('.')) {
      return decodeURIComponent(lastPart);
    }
  } catch {
    // 作为普通路径处理
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.includes('.')) {
      return lastPart;
    }
  }
  return `media_${Date.now()}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test tests/unit/channels/wecomUploader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/plugins/wecom/WeComUploader.ts tests/unit/channels/wecomUploader.test.ts
git commit -m "feat(wecom): add media loading from URL"
```

---

## Task 5: 消息聚合器实现

**Files:**
- Create: `src/channels/plugins/wecom/MessageAggregator.ts`
- Test: `tests/unit/channels/messageAggregator.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/channels/messageAggregator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageAggregator, AGGREGATION_WINDOW_MS } from '@/channels/plugins/wecom/MessageAggregator';
import type { WeComMsgCallback } from '@/channels/plugins/wecom/WeComAdapter';

describe('MessageAggregator', () => {
  let aggregator: MessageAggregator;

  beforeEach(() => {
    aggregator = new MessageAggregator();
  });

  describe('shouldAggregate', () => {
    it('should return false for first message', () => {
      expect(aggregator.shouldAggregate('user1', 'chat1')).toBe(false);
    });

    it('should return true after first message added', () => {
      const msg: WeComMsgCallback = {
        msgid: 'msg1',
        msgtype: 'text',
        from: { userid: 'user1' },
        chattype: 'single',
        text: { content: 'hello' },
      };

      aggregator.addToQueue('user1', 'chat1', msg);
      expect(aggregator.shouldAggregate('user1', 'chat1')).toBe(true);
    });

    it('should return false after window expires', async () => {
      const msg: WeComMsgCallback = {
        msgid: 'msg1',
        msgtype: 'text',
        from: { userid: 'user1' },
        chattype: 'single',
        text: { content: 'hello' },
      };

      aggregator.addToQueue('user1', 'chat1', msg);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, AGGREGATION_WINDOW_MS + 100));

      expect(aggregator.shouldAggregate('user1', 'chat1')).toBe(false);
    });
  });

  describe('waitForComplete', () => {
    it('should merge text messages', async () => {
      const msg1: WeComMsgCallback = {
        msgid: 'msg1',
        msgtype: 'text',
        from: { userid: 'user1' },
        chattype: 'single',
        text: { content: 'hello' },
      };

      const msg2: WeComMsgCallback = {
        msgid: 'msg2',
        msgtype: 'text',
        from: { userid: 'user1' },
        chattype: 'single',
        text: { content: 'world' },
      };

      aggregator.addToQueue('user1', 'chat1', msg1);
      aggregator.addToQueue('user1', 'chat1', msg2);

      const merged = await aggregator.waitForComplete('user1', 'chat1');

      expect(merged?.msgtype).toBe('text');
      expect(merged?.text?.content).toBe('hello\nworld');
    });

    it('should merge text and image into mixed', async () => {
      const msg1: WeComMsgCallback = {
        msgid: 'msg1',
        msgtype: 'text',
        from: { userid: 'user1' },
        chattype: 'single',
        text: { content: 'look at this' },
      };

      const msg2: WeComMsgCallback = {
        msgid: 'msg2',
        msgtype: 'image',
        from: { userid: 'user1' },
        chattype: 'single',
        image: { url: 'https://example.com/img.jpg', aeskey: 'abc123' },
      };

      aggregator.addToQueue('user1', 'chat1', msg1);
      aggregator.addToQueue('user1', 'chat1', msg2);

      const merged = await aggregator.waitForComplete('user1', 'chat1');

      expect(merged?.msgtype).toBe('mixed');
      expect(merged?.mixed?.msg_item?.length).toBe(2);
      expect(merged?.mixed?.msg_item?.[0]?.type).toBe('text');
      expect(merged?.mixed?.msg_item?.[1]?.type).toBe('image');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test tests/unit/channels/messageAggregator.test.ts`
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/channels/plugins/wecom/MessageAggregator.ts
/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WeComMsgCallback } from './WeComAdapter';

/**
 * 聚合窗口时间（毫秒）
 */
export const AGGREGATION_WINDOW_MS = 800;

/**
 * 单队列最大消息数
 */
export const MAX_QUEUE_SIZE = 10;

/**
 * 聚合队列
 */
class AggregationQueue {
  private messages: WeComMsgCallback[] = [];
  private createdAt: number = Date.now();
  private windowMs: number;

  constructor(windowMs: number = AGGREGATION_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  add(msg: WeComMsgCallback): void {
    if (this.messages.length < MAX_QUEUE_SIZE) {
      this.messages.push(msg);
    }
  }

  isExpired(): boolean {
    return Date.now() - this.createdAt > this.windowMs;
  }

  async waitForWindowClose(): Promise<void> {
    const remaining = this.windowMs - (Date.now() - this.createdAt);
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
  }

  mergeAndClear(): WeComMsgCallback | null {
    if (this.messages.length === 0) return null;
    if (this.messages.length === 1) return this.messages[0];

    const messages = this.messages;

    // 收集文本
    const textParts: string[] = [];
    for (const msg of messages) {
      if (msg.msgtype === 'text' && msg.text?.content) {
        textParts.push(msg.text.content);
      } else if (msg.msgtype === 'mixed') {
        const items = msg.mixed?.msg_item || msg.mixed?.items || msg.mixed?.item || [];
        for (const item of items) {
          const type = item.msgtype || item.type || '';
          if (type === 'text' && item.text?.content) {
            textParts.push(item.text.content);
          }
        }
      }
    }

    // 收集图片
    const images: Array<{ url: string; aeskey: string }> = [];
    for (const msg of messages) {
      if (msg.msgtype === 'image' && msg.image) {
        images.push({ url: msg.image.url, aeskey: msg.image.aeskey });
      } else if (msg.msgtype === 'mixed') {
        const items = msg.mixed?.msg_item || msg.mixed?.items || msg.mixed?.item || [];
        for (const item of items) {
          const type = item.msgtype || item.type || '';
          if (type === 'image' && item.image) {
            images.push({ url: item.image.url, aeskey: item.image.aeskey });
          }
        }
      }
    }

    const firstMsg = messages[0];

    // 有图片时构造 mixed 消息
    if (images.length > 0) {
      const msgItem: Array<{ type: string; text?: { content: string }; image?: { url: string; aeskey: string } }> = [];

      for (const text of textParts) {
        msgItem.push({ type: 'text', text: { content: text } });
      }

      for (const img of images) {
        msgItem.push({ type: 'image', image: { url: img.url, aeskey: img.aeskey } });
      }

      return {
        msgid: `merged_${Date.now()}`,
        msgtype: 'mixed',
        from: firstMsg.from,
        chatid: firstMsg.chatid,
        chattype: firstMsg.chattype,
        aibotid: firstMsg.aibotid,
        mixed: { msg_item: msgItem },
      };
    }

    // 仅文本
    return {
      msgid: `merged_${Date.now()}`,
      msgtype: 'text',
      from: firstMsg.from,
      chatid: firstMsg.chatid,
      chattype: firstMsg.chattype,
      aibotid: firstMsg.aibotid,
      text: { content: textParts.join('\n') },
    };
  }
}

/**
 * 消息聚合管理器
 */
export class MessageAggregator {
  private queues: Map<string, AggregationQueue> = new Map();

  /**
   * 判断是否应该聚合等待
   */
  shouldAggregate(userId: string, chatId: string): boolean {
    const key = `${userId}:${chatId}`;
    const queue = this.queues.get(key);
    return queue !== undefined && !queue.isExpired();
  }

  /**
   * 添加消息到聚合队列
   */
  addToQueue(userId: string, chatId: string, msg: WeComMsgCallback): void {
    const key = `${userId}:${chatId}`;
    let queue = this.queues.get(key);
    if (!queue) {
      queue = new AggregationQueue();
      this.queues.set(key, queue);
    }
    queue.add(msg);
  }

  /**
   * 等待聚合完成并返回合并消息
   */
  async waitForComplete(userId: string, chatId: string): Promise<WeComMsgCallback | null> {
    const key = `${userId}:${chatId}`;
    const queue = this.queues.get(key);
    if (!queue) return null;

    await queue.waitForWindowClose();
    const merged = queue.mergeAndClear();
    this.queues.delete(key);
    return merged;
  }

  /**
   * 清理过期队列
   */
  cleanupExpired(): void {
    for (const [key, queue] of this.queues.entries()) {
      if (queue.isExpired()) {
        this.queues.delete(key);
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test tests/unit/channels/messageAggregator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/plugins/wecom/MessageAggregator.ts tests/unit/channels/messageAggregator.test.ts
git commit -m "feat(wecom): add message aggregator for multi-callback handling"
```

---

## Task 6: WeComPlugin 集成媒体上传

**Files:**
- Modify: `src/channels/plugins/wecom/WeComPlugin.ts`
- Check: existing implementation at lines 218-275

**Step 1: Import new modules**

在文件顶部添加导入：

```typescript
// 在现有导入后添加
import { detectMediaType, validateSize, type WeComMediaType } from './WeComMediaUtils';
import { WsCommandSender, uploadMedia, loadMediaFromUrl, extractFilename } from './WeComUploader';
```

**Step 2: Add WsCommandSender instance**

在类属性中添加：

```typescript
export class WeComPlugin extends BasePlugin {
  // ... 现有属性 ...

  // WebSocket 响应处理器（用于上传）
  private wsCommandSender: WsCommandSender | null = null;
```

**Step 3: Initialize sender in connect()**

在 WebSocket 连接建立后初始化：

```typescript
// 在 ws.on('open') 回调中，subscribe() 之后添加
ws.on('open', () => {
  this.wsCommandSender = new WsCommandSender(ws);
  this.subscribe();
});
```

**Step 4: Handle responses in ws.on('message')**

```typescript
// 在 ws.on('message') 回调中添加响应处理
ws.on('message', (data: WebSocket.Data) => {
  try {
    const msg = JSON.parse(data.toString());

    // 处理上传响应
    if (msg.req_id && this.wsCommandSender) {
      this.wsCommandSender.handleResponse(msg);
    }

    this.handleWsMessage(msg);
    // ... 后续逻辑 ...
  } catch (error) {
    // ...
  }
});
```

**Step 5: Add media sending support in sendMessage**

修改 sendMessage 方法支持媒体：

```typescript
async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
  console.log(`[WeComPlugin] sendMessage: chatId=${chatId}, hasMedia=${!!message.imageUrl || !!message.fileUrl}`);

  // 检测媒体附件
  const mediaUrl = message.imageUrl || message.fileUrl;
  if (mediaUrl && this.wsCommandSender) {
    try {
      // 1. 加载媒体文件
      const mediaBuffer = await loadMediaFromUrl(mediaUrl);

      // 2. 检测类型并验证大小
      const detectedType = detectMediaType(mediaBuffer);
      const sizeCheck = validateSize(mediaBuffer.length, detectedType);

      if (sizeCheck.shouldReject) {
        console.error(`[WeComPlugin] Media rejected: ${sizeCheck.rejectReason}`);
        // 发送错误提示文本
        return this.sendTextMessage(chatId, `❌ ${sizeCheck.rejectReason}`);
      }

      // 3. 上传获取 media_id
      const mediaId = await uploadMedia(this.wsCommandSender, mediaBuffer, {
        type: sizeCheck.finalType,
        filename: extractFilename(mediaUrl),
      });

      console.log(`[WeComPlugin] Media uploaded: media_id=${mediaId}, type=${sizeCheck.finalType}`);

      // 4. 发送媒体消息
      const { type: chatType } = parseChatId(chatId);
      const reqId = this.generateReqId();
      this.send({
        cmd: 'aibot_send_msg',
        headers: { req_id: reqId },
        body: {
          chatid: chatId,
          chat_type: chatType === 'group' ? 2 : 1,
          msgtype: sizeCheck.finalType,
          [sizeCheck.finalType]: { media_id: mediaId },
        },
      });

      // 5. 如有文本，再发送文本消息
      if (message.text) {
        await this.sendTextMessage(chatId, message.text);
      }

      return `media_${reqId}`;
    } catch (error) {
      console.error('[WeComPlugin] Media upload failed:', error);
      // 降级为纯文本发送
      if (message.text) {
        return this.sendTextMessage(chatId, message.text);
      }
      throw error;
    }
  }

  // 现有文本/markdown发送逻辑...
  return this.sendTextMessage(chatId, message.text || '');
}
```

**Step 6: Extract sendTextMessage helper**

```typescript
/**
 * 发送纯文本消息
 */
private async sendTextMessage(chatId: string, text: string): Promise<string> {
  const reqId = this.reqIdCache.get(chatId);
  const { content } = toWeComSendParams({ text });
  const truncatedContent = content.length > WECOM_MESSAGE_LIMIT
    ? content.slice(0, WECOM_MESSAGE_LIMIT - 3) + '...'
    : content;

  if (reqId) {
    // 流式回复
    const streamId = this.generateStreamId();
    this.send({
      cmd: 'aibot_respond_msg',
      headers: { req_id: reqId },
      body: {
        msgtype: 'stream',
        stream: {
          id: streamId,
          finish: true,
          content: truncatedContent,
        },
      },
    });
    return `stream_${streamId}`;
  }

  // 主动推送
  const { type: chatType } = parseChatId(chatId);
  const sendReqId = this.generateReqId();
  this.send({
    cmd: 'aibot_send_msg',
    headers: { req_id: sendReqId },
    body: {
      chatid: chatId,
      chat_type: chatType === 'group' ? 2 : 1,
      msgtype: 'markdown',
      markdown: { content: truncatedContent },
    },
  });
  return `push_${sendReqId}`;
}
```

**Step 7: Run build to verify no errors**

Run: `npm run build`
Expected: No TypeScript errors

**Step 8: Commit**

```bash
git add src/channels/plugins/wecom/WeComPlugin.ts
git commit -m "feat(wecom): integrate media upload into sendMessage"
```

---

## Task 7: WeComPlugin 集成消息聚合

**Files:**
- Modify: `src/channels/plugins/wecom/WeComPlugin.ts`

**Step 1: Import MessageAggregator**

```typescript
import { MessageAggregator, AGGREGATION_WINDOW_MS } from './MessageAggregator';
```

**Step 2: Add aggregator instance**

```typescript
// 添加类属性
private messageAggregator = new MessageAggregator();
private waitingForAggregate: Map<string, boolean> = new Map();
```

**Step 3: Modify handleMsgCallback**

修改消息回调处理逻辑：

```typescript
private async handleMsgCallback(msg: Record<string, unknown>): Promise<void> {
  try {
    const body = msg.body as WeComMsgCallback;
    const headers = msg.headers as { req_id?: string } | undefined;
    const msgId = body?.msgid;
    const userId = body?.from?.userid;
    const chatType = body?.chattype;
    const msgType = body?.msgtype;

    console.log(`[WeComPlugin] handleMsgCallback: msgId=${msgId}, msgtype=${msgType}`);

    if (!msgId || !userId) {
      console.warn('[WeComPlugin] handleMsgCallback: missing msgId or userId');
      return;
    }

    // 检查是否正在聚合等待
    const chatId = encodeChatId(body);
    const key = `${userId}:${chatId}`;

    if (this.messageAggregator.shouldAggregate(userId, chatId)) {
      // 加入聚合队列
      this.messageAggregator.addToQueue(userId, chatId, body);
      console.log(`[WeComPlugin] Added to aggregation queue: key=${key}`);
      return;
    }

    // 检查是否已启动聚合窗口
    if (this.waitingForAggregate.has(key)) {
      // 已在等待中，添加到队列
      this.messageAggregator.addToQueue(userId, chatId, body);
      return;
    }

    // 首条消息：启动聚合窗口
    // 但先检查是否是多媒体消息类型（可能需要聚合）
    const needsAggregation = msgType === 'mixed' ||
      (msgType === 'text' && Date.now() % 100 < 50); // 简化判断，实际应基于消息类型

    // 对于非混合消息，直接处理
    if (msgType !== 'mixed' && msgType !== 'image') {
      // 文本、语音等直接处理
      await this.processSingleMessage(body, headers);
      return;
    }

    // 启动聚合窗口
    this.messageAggregator.addToQueue(userId, chatId, body);
    this.waitingForAggregate.set(key, true);

    console.log(`[WeComPlugin] Starting aggregation window: key=${key}`);

    // 等待聚合窗口关闭
    setTimeout(async () => {
      try {
        const merged = await this.messageAggregator.waitForComplete(userId, chatId);
        this.waitingForAggregate.delete(key);

        if (merged) {
          console.log(`[WeComPlugin] Processing merged message: msgid=${merged.msgid}, msgtype=${merged.msgtype}`);
          await this.processSingleMessage(merged, headers);
        }
      } catch (error) {
        console.error('[WeComPlugin] Aggregation processing failed:', error);
        this.waitingForAggregate.delete(key);
      }
    }, AGGREGATION_WINDOW_MS);
  } catch (error) {
    console.error('[WeComPlugin] Error processing message callback:', error);
  }
}

/**
 * 处理单条（或合并后的）消息
 */
private async processSingleMessage(
  body: WeComMsgCallback,
  headers?: { req_id?: string }
): Promise<void> {
  const msgId = body.msgid;

  // 事件去重
  if (this.isEventProcessed(msgId)) {
    console.log(`[WeComPlugin] Message ${msgId} already processed`);
    return;
  }
  this.markEventProcessed(msgId);

  const userId = body.from?.userid;
  if (!userId) return;

  // 跟踪活跃用户
  this.activeUsers.add(userId);

  // 缓存 reqId
  const chatId = encodeChatId(body);
  if (headers?.req_id) {
    this.reqIdCache.set(chatId, headers.req_id);
  }

  // 下载媒体（如有）
  try {
    await this.downloadMediaItems(body);
  } catch (error) {
    console.error('[WeComPlugin] Media download failed:', error);
  }

  // 转换并发送
  const unifiedMessage = toUnifiedIncomingMessage(body);
  if (unifiedMessage && this.messageHandler) {
    // 处理菜单按钮命令...
    // 然后发送消息
    void this.emitMessage(unifiedMessage).catch(error =>
      console.error('[WeComPlugin] Error handling message:', error)
    );
  }
}
```

**Step 4: Run build**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add src/channels/plugins/wecom/WeComPlugin.ts
git commit -m "feat(wecom): integrate message aggregator to handle multi-callback"
```

---

## Task 8: 更新导出

**Files:**
- Modify: `src/channels/plugins/wecom/index.ts`

**Step 1: Add new exports**

```typescript
// 在现有导出后添加
export { WeComMediaUtils, detectMediaType, validateSize, SIZE_LIMITS, type WeComMediaType, type SizeCheckResult } from './WeComMediaUtils';
export { WeComUploader, WsCommandSender, uploadMedia, loadMediaFromUrl, extractFilename, CHUNK_SIZE, MAX_CHUNKS, UPLOAD_TIMEOUT_MS } from './WeComUploader';
export { MessageAggregator, AGGREGATION_WINDOW_MS, MAX_QUEUE_SIZE } from './MessageAggregator';
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/channels/plugins/wecom/index.ts
git commit -m "feat(wecom): export new media upload and aggregation modules"
```

---

## Task 9: 集成测试

**Files:**
- Create: `tests/integration/channels/wecomMedia.test.ts`

**Step 1: Write integration test**

```typescript
// tests/integration/channels/wecomMedia.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('WeCom Media Upload Integration', () => {
  it.skip('should upload and send image in real environment', async () => {
    // 此测试需要真实的企微环境
    // 1. 创建 WebSocket 连接
    // 2. 上传图片
    // 3. 发送媒体消息
    // 4. 验证用户收到
  });

  it.skip('should aggregate mixed callbacks in real environment', async () => {
    // 此测试需要真实的企微环境
    // 1. 用户发送图文混合
    // 2. 验证只触发一次 AI 响应
    // 3. 验证回复正确包含文本和图片
  });
});
```

**Step 2: Commit**

```bash
git add tests/integration/channels/wecomMedia.test.ts
git commit -m "test(wecom): add integration test placeholders for media upload"
```

---

## Task 10: 文档更新

**Files:**
- Modify: `docs/plans/2026-04-22-wecom-media-upload-aggregation-design.md` (update status)

**Step 1: Update design doc status**

```markdown
# 企业微信媒体上传与消息聚合设计

**日期**: 2026-04-22
**状态**: 已实现 ✅
**作者**: Claude Code
```

**Step 2: Commit**

```bash
git add docs/plans/2026-04-22-wecom-media-upload-aggregation-design.md
git commit -m "docs(wecom): mark design as implemented"
```

---

## 验收清单

- [ ] 媒体上传功能正常（图片、文件）
- [ ] 大文件分片上传正常
- [ ] 超限文件正确拒绝或降级
- [ ] 图文混合消息不再重复回复
- [ ] 单独文本消息正常处理
- [ ] 单独图片消息正常处理
- [ ] 所有单元测试通过
- [ ] TypeScript 编译无错误

---

## 实现完成后的后续工作

1. 在真实企微环境测试上传和发送
2. 测试消息聚合效果（观察日志确认只触发一次 emitMessage）
3. 根据实际测试调整聚合窗口时间
4. 添加更多媒体格式支持（voice, video）