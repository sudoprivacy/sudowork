# WeChat iLink Bot 文件上传实现方案

> Date: 2026-04-21

## 背景

当前 WeChatPlugin 已完整实现文件下载功能（AES-128-ECB 解密），但缺少文件上传能力。
基于逆向项目 photon-hq/wechat-ilink-client 发现的 `getUploadUrl` 端点，可以实现文件上传。

## 上传流程

```
Agent 生成文件 → WeChatPlugin.uploadMedia()
                  ↓
              1. 生成 AES key (16 bytes)
              2. 调用 getUploadUrl API → 获取 CDN URL
              3. AES-128-ECB 加密文件内容
              4. POST 到 CDN URL → 获取 x-encrypted-param
              5. 构造消息 item (image_item/file_item/video_item)
              6. sendMessage → 发送给用户
```

## 需要新增的代码

### 1. WeChatCrypto.ts - AES 加密函数

```typescript
/**
 * Encrypt data with AES-128-ECB.
 * @param plaintext - The raw file content
 * @param key - 16-byte AES key
 * @returns Encrypted ciphertext with PKCS7 padding
 */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/**
 * Generate a random 16-byte AES key.
 * @returns Hex string (32 chars) and raw Buffer (16 bytes)
 */
export function generateAesKey(): { hex: string; buffer: Buffer } {
  const buffer = crypto.randomBytes(16);
  return { hex: buffer.toString('hex'), buffer };
}
```

### 2. types.ts - 新增 API 类型

```typescript
/** getUploadUrl request */
export interface IWeChatGetUploadUrlRequest {
  filekey?: string;       // Random 16-byte hex (32 chars)
  media_type?: number;    // 1=IMAGE, 2=VIDEO, 3=FILE, 4=VOICE
  to_user_id?: string;    // Target user ID
  rawsize?: number;       // Original file size (bytes)
  rawfilemd5?: string;    // MD5 hash of original file (hex)
  filesize?: number;      // Encrypted file size (rawsize + padding)
  aeskey?: string;        // AES key (hex)
  base_info?: BaseInfo;
}

/** getUploadUrl response */
export interface IWeChatGetUploadUrlResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_url?: string;    // CDN URL to POST encrypted content
  download_param?: string; // Pre-generated download param (optional)
}

/** Media type for upload */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;
```

### 3. WeChatApiClient.ts - 上传 API

```typescript
/**
 * Request upload URL from iLink Bot API.
 */
async getUploadUrl(params: IWeChatGetUploadUrlRequest): Promise<IWeChatGetUploadUrlResponse> {
  return await this.apiFetch<IWeChatGetUploadUrlResponse>(
    'ilink/bot/getuploadurl',
    params as unknown as Record<string, unknown>,
    WECHAT_API_TIMEOUT_MS
  );
}

/**
 * Upload encrypted media to CDN.
 * @param url - CDN URL from getUploadUrl
 * @param encryptedData - AES-encrypted file content
 * @returns downloadParam from x-encrypted-param header
 */
async uploadToCdn(url: string, encryptedData: Buffer): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encryptedData,
  });
  if (!response.ok) {
    throw new Error(`CDN upload failed: HTTP ${response.status}`);
  }
  const downloadParam = response.headers.get('x-encrypted-param');
  if (!downloadParam) {
    throw new Error('CDN upload missing x-encrypted-param header');
  }
  return downloadParam;
}

/**
 * Compute MD5 hash of file content.
 */
computeMd5(data: Buffer): string {
  return crypto.createHash('md5').update(data).digest('hex');
}
```

### 4. WeChatPlugin.ts - 上传流程

```typescript
/**
 * Upload a local file and return the media item for sendMessage.
 */
private async uploadMedia(filePath: string, mediaType: number, userId: string): Promise<WeChatMessageItem | null> {
  if (!this.apiClient) return null;

  try {
    // Read file
    const rawContent = fs.readFileSync(filePath);
    const rawSize = rawContent.length;
    const rawMd5 = this.apiClient.computeMd5(rawContent);

    // Generate AES key
    const { hex: aesKeyHex, buffer: aesKeyBuffer } = generateAesKey();

    // Encrypt content
    const encryptedContent = encryptAesEcb(rawContent, aesKeyBuffer);
    const encryptedSize = encryptedContent.length;

    // Generate filekey (random 16-byte hex)
    const filekey = crypto.randomBytes(16).toString('hex');

    // Get upload URL
    const uploadResp = await this.apiClient.getUploadUrl({
      filekey,
      media_type: mediaType,
      to_user_id: userId,
      rawsize: rawSize,
      rawfilemd5: rawMd5,
      filesize: encryptedSize,
      aeskey: aesKeyHex,
    });

    if (uploadResp.errcode || !uploadResp.upload_url) {
      console.error('[WeChatPlugin] getUploadUrl failed:', uploadResp.errmsg);
      return null;
    }

    // Upload to CDN
    const downloadParam = await this.apiClient.uploadToCdn(uploadResp.upload_url, encryptedContent);

    // Construct message item
    const item: WeChatMessageItem = { type: mediaTypeToItemType(mediaType) };

    if (mediaType === UploadMediaType.IMAGE) {
      item.image_item = {
        aeskey: aesKeyHex,
        media: { encrypt_query_param: downloadParam },
      };
    } else if (mediaType === UploadMediaType.FILE) {
      item.file_item = {
        media: { encrypt_query_param: downloadParam },
        file_name: path.basename(filePath),
        file_size: rawSize,
      };
    } else if (mediaType === UploadMediaType.VIDEO) {
      item.video_item = {
        media: { encrypt_query_param: downloadParam },
      };
    } else if (mediaType === UploadMediaType.VOICE) {
      item.voice_item = {
        media: { encrypt_query_param: downloadParam },
      };
    }

    return item;
  } catch (error) {
    console.error('[WeChatPlugin] uploadMedia failed:', error);
    return null;
  }
}

function mediaTypeToItemType(mediaType: number): number {
  switch (mediaType) {
    case UploadMediaType.IMAGE: return MessageItemType.IMAGE;
    case UploadMediaType.VIDEO: return MessageItemType.VIDEO;
    case UploadMediaType.FILE: return MessageItemType.FILE;
    case UploadMediaType.VOICE: return MessageItemType.VOICE;
    default: return MessageItemType.NONE;
  }
}
```

### 5. sendMessage 扩展

```typescript
// 在 WeChatPlugin.sendMessage() 中添加文件支持
async sendMessage(userId: string, content: IUnifiedOutgoingMessage): Promise<void> {
  if (!this.apiClient) return;

  const contextToken = this.tokenStore.get(this.accountId, userId);

  // 处理文件附件
  const items: WeChatMessageItem[] = [];

  if (content.imageUrl) {
    const item = await this.uploadMedia(content.imageUrl, UploadMediaType.IMAGE, userId);
    if (item) items.push(item);
  }

  if (content.fileUrl) {
    const item = await this.uploadMedia(content.fileUrl, UploadMediaType.FILE, userId);
    if (item) items.push(item);
  }

  if (content.text) {
    items.push({ type: MessageItemType.TEXT, text_item: { text: content.text } });
  }

  // 发送消息
  const payload = {
    msg: {
      to_user_id: userId,
      context_token: contextToken,
      item_list: items,
    },
  };

  await this.apiClient.sendMessage(payload);
}
```

## 文件清单

| 文件 | 改动 |
|------|------|
| `WeChatCrypto.ts` | 新增 `encryptAesEcb()`, `generateAesKey()` |
| `types.ts` | 新增 `IWeChatGetUploadUrlRequest`, `IWeChatGetUploadUrlResponse`, `UploadMediaType` |
| `WeChatApiClient.ts` | 新增 `getUploadUrl()`, `uploadToCdn()`, `computeMd5()` |
| `WeChatPlugin.ts` | 新增 `uploadMedia()`, 扩展 `sendMessage()` |
| `WeChatAdapter.ts` | 扩展 `toWeChatSendPayload()` 支持附件 |

## 风险评估

### 技术风险

1. **API 稳定性**: `getUploadUrl` 是逆向发现的端点，可能随 iLink Bot API 更新而变化
   - 缓解：添加错误处理和 fallback

2. **加密兼容性**: AES-128-ECB 加密必须与微信解密完全兼容
   - 缓解：已验证解密实现，加密使用相同算法

3. **文件大小限制**: CDN 上传可能有大小限制
   - 缓解：添加文件大小检查 (建议 < 10MB)

### 账号风险

1. **API 未公开**: 使用未公开的 API 端点可能导致账号受限
   - 缓解：添加用户确认提示，默认关闭上传功能

## 测试计划

1. **单元测试**
   - `encryptAesEcb()` 加密后能被 `decryptAesEcb()` 正确解密
   - `generateAesKey()` 生成正确的 16 字节密钥
   - `computeMd5()` 返回正确的 MD5 哈希

2. **集成测试**
   - 上传图片 → 发送消息 → 验证用户能收到
   - 上传文件 → 发送消息 → 验证文件名正确
   - 上传失败时 fallback 到文本消息

3. **端到端测试**
   - Agent 生成图片 → 上传 → 发送给用户
   - Agent 生成 PDF → 上传 → 发送给用户