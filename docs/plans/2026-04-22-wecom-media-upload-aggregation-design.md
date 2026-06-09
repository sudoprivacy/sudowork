# 企业微信媒体上传与消息聚合设计

**日期**: 2026-04-22
**状态**: 已实现
**作者**: Claude Code

---

## 1. 背景

当前 sudowork 企业微信实现仅支持：
- 用户发送媒体文件 → agent下载并解密
- agent发送文本/markdown回复

**缺失功能**：
1. agent无法主动发送图片、文件等媒体给用户
2. 用户发送图文混合消息时触发多次重复回复

## 2. 问题分析

### 2.1 媒体发送缺失

企微长连接模式需要通过 WebSocket 分片上传临时素材，获取 `media_id` 后才能发送媒体消息。当前实现未包含此流程。

**参考实现**：wecom-openclaw-plugin-main 使用三步上传流程：
1. `aibot_upload_media_init` - 初始化上传，获取 upload_id
2. `aibot_upload_media_chunk` - 分片上传（Base64编码）
3. `aibot_upload_media_finish` - 完成上传，获取 media_id

### 2.2 消息重复回复

**现象**：用户发送图文混合消息时，企微分别发送多个 WebSocket 回调（不同 msgId），每个回调都触发一次 AI 响应。

**原因**：当前去重逻辑仅检查 msgId，企微的多回调模式导致：
- text回调(msgId=A) → emitMessage → AI响应
- image回调(msgId=B) → emitMessage → AI响应
- 用户收到两条回复

## 3. 设计方案

### 3.1 媒体上传模块 (WeComUploader.ts)

新增独立模块处理分片上传：

```typescript
// 核心参数
const CHUNK_SIZE = 512 * 1024;  // 512KB (Base64编码前)
const MAX_CHUNKS = 100;         // 最大分片数（对应50MB）
const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,      // 10MB
  voice: 2 * 1024 * 1024,       // 2MB (仅支持AMR)
  video: 10 * 1024 * 1024,      // 10MB (仅支持MP4)
  file: 20 * 1024 * 1024        // 20MB
};

// 上传流程
export async function uploadMedia(ws: WebSocket, buffer: Buffer, options: {
  type: 'image' | 'voice' | 'video' | 'file';
  filename: string;
}): Promise<string> {
  // 1. 初始化
  const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
  const initResult = await sendCommand(ws, {
    cmd: 'aibot_upload_media_init',
    body: {
      type: options.type,
      filename: options.filename,
      total_size: buffer.length,
      total_chunks: totalChunks
    }
  });

  // 2. 分片上传
  for (let i = 0; i < totalChunks; i++) {
    const chunk = buffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await sendCommand(ws, {
      cmd: 'aibot_upload_media_chunk',
      body: {
        upload_id: initResult.upload_id,
        chunk_index: i,
        base64_data: chunk.toString('base64')
      }
    });
  }

  // 3. 完成
  const finishResult = await sendCommand(ws, {
    cmd: 'aibot_upload_media_finish',
    body: { upload_id: initResult.upload_id }
  });

  return finishResult.media_id;
}
```

### 3.2 媒体发送集成 (WeComPlugin.ts)

扩展 `sendMessage` 方法支持媒体：

```typescript
async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
  // 检测媒体附件
  const hasMedia = message.imageUrl || message.fileUrl;

  if (hasMedia) {
    // 1. 加载媒体文件
    const mediaUrl = message.imageUrl || message.fileUrl!;
    const mediaBuffer = await loadMediaFromUrl(mediaUrl);

    // 2. 检测类型并验证大小
    const detectedType = detectMediaType(mediaBuffer);
    const sizeCheck = validateSize(mediaBuffer.length, detectedType);

    if (sizeCheck.shouldReject) {
      throw new Error(sizeCheck.rejectReason);
    }

    // 3. 上传获取 media_id
    const mediaId = await uploadMedia(this.ws, mediaBuffer, {
      type: sizeCheck.finalType,
      filename: extractFilename(mediaUrl)
    });

    // 4. 发送媒体消息
    const reqId = this.generateReqId();
    this.send({
      cmd: 'aibot_send_msg',
      headers: { req_id: reqId },
      body: {
        chatid: chatId,
        chat_type: parseChatType(chatId),
        msgtype: sizeCheck.finalType,
        [sizeCheck.finalType]: { media_id: mediaId }
      }
    });

    // 5. 如有文本，再发送文本消息
    if (message.text) {
      await this.sendTextMessage(chatId, message.text);
    }

    return `media_${reqId}`;
  }

  // 现有文本发送逻辑...
}
```

### 3.3 消息聚合窗口 (MessageAggregator.ts)

新增聚合管理器处理多回调：

```typescript
// 聚合窗口配置
const AGGREGATION_WINDOW_MS = 800;  // 800ms等待窗口
const MAX_QUEUE_SIZE = 10;          // 单队列最大消息数

// 职责
export class MessageAggregator {
  private queues: Map<string, AggregationQueue> = new Map();

  // 判断是否应该聚合等待
  shouldAggregate(userId: string, chatId: string): boolean {
    const key = `${userId}:${chatId}`;
    const queue = this.queues.get(key);
    return queue && !queue.isExpired();
  }

  // 添加消息到聚合队列
  addToQueue(userId: string, chatId: string, msg: WeComMsgCallback): void {
    const key = `${userId}:${chatId}`;
    let queue = this.queues.get(key);
    if (!queue) {
      queue = new AggregationQueue(AGGREGATION_WINDOW_MS);
      this.queues.set(key, queue);
    }
    queue.add(msg);
  }

  // 等待聚合完成并返回合并消息
  async waitForComplete(userId: string, chatId: string): Promise<WeComMsgCallback | null> {
    const key = `${userId}:${chatId}`;
    const queue = this.queues.get(key);
    if (!queue) return null;

    await queue.waitForWindowClose();
    const merged = queue.mergeAndClear();
    this.queues.delete(key);
    return merged;
  }
}

// 合并逻辑
class AggregationQueue {
  mergeAndClear(): WeComMsgCallback {
    const messages = this.messages;

    // 合并文本
    const textParts = messages
      .filter(m => m.msgtype === 'text' || m.msgtype === 'mixed')
      .map(m => extractText(m))
      .filter(t => t);

    // 合并图片
    const images = messages
      .filter(m => m.msgtype === 'image' || m.msgtype === 'mixed')
      .map(m => extractImage(m))
      .filter(i => i);

    // 构造合并消息
    if (images.length > 0) {
      return {
        msgid: `merged_${Date.now()}`,
        msgtype: 'mixed',
        from: messages[0].from,
        chatid: messages[0].chatid,
        chattype: messages[0].chattype,
        mixed: {
          msg_item: [
            ...textParts.map(t => ({ type: 'text', text: { content: t } })),
            ...images.map(i => ({ type: 'image', image: { url: i.url, aeskey: i.aeskey } }))
          ]
        }
      };
    }

    // 仅文本
    return {
      ...messages[0],
      msgid: `merged_${Date.now()}`,
      text: { content: textParts.join('\n') }
    };
  }
}
```

### 3.4 WeComPlugin 集成

修改消息处理流程：

```typescript
private messageAggregator = new MessageAggregator();

private async handleMsgCallback(msg: Record<string, unknown>): Promise<void> {
  const body = msg.body as WeComMsgCallback;
  const userId = body.from?.userid;
  const chatId = encodeChatId(body);

  // 检查聚合状态
  if (this.messageAggregator.shouldAggregate(userId, chatId)) {
    // 加入队列等待合并
    this.messageAggregator.addToQueue(userId, chatId, body);
    return;
  }

  // 检查是否已在等待中
  const key = `${userId}:${chatId}`;
  const isWaiting = this.waitingForAggregate.has(key);

  if (!isWaiting) {
    // 首条消息：启动聚合窗口
    this.messageAggregator.addToQueue(userId, chatId, body);
    this.waitingForAggregate.set(key, true);

    // 异步等待聚合完成
    setTimeout(async () => {
      const merged = await this.messageAggregator.waitForComplete(userId, chatId);
      this.waitingForAggregate.delete(key);

      if (merged) {
        await this.processMergedMessage(merged);
      }
    }, AGGREGATION_WINDOW_MS);
  }
}
```

## 4. 架构概览

```
用户发送图文混合
    ↓
企微 WebSocket → 多个回调 (text + image)
    ↓
WeComPlugin.handleMsgCallback
    ↓
MessageAggregator 聚合 (800ms窗口)
    ↓
合并为单个 mixed 消息
    ↓
emitMessage (一次) → ActionExecutor
    ↓
AI生成响应 (可能含文本+图片)
    ↓
sendMessage → WeComUploader.uploadMedia (如有图片)
    ↓
aibot_send_msg 发送媒体 + 文本
    ↓
用户收到完整回复
```

## 5. 文件结构

```
src/channels/plugins/wecom/
├── WeComPlugin.ts        # 修改：集成聚合和媒体发送
├── WeComAdapter.ts       # 现有：消息格式转换
├── WeComCrypto.ts        # 现有：媒体下载解密
├── WeComUploader.ts      # 新增：分片上传实现
├── WeComMediaUtils.ts    # 新增：媒体类型检测、大小验证
└── MessageAggregator.ts  # 新增：消息聚合管理
```

## 6. 约束与限制

### 6.1 媒体大小限制
- 图片：10MB (PNG/JPG/GIF)
- 语音：2MB (仅AMR格式)
- 视频：10MB (仅MP4格式)
- 文件：20MB (任意格式)

### 6.2 分片上传约束
- 分片大小：512KB (Base64编码前)
- 最大分片数：100
- 单个文件最大：50MB (实际受类型限制)

### 6.3 消息聚合约束
- 聚合窗口：800ms
- 仅聚合同一用户、同一会话的消息
- 窗口过期后立即处理

## 7. 测试要点

1. **媒体上传测试**
   - 各种格式图片上传
   - 大文件分片上传
   - 超限文件拒绝

2. **媒体发送测试**
   - agent发送图片给用户
   - agent发送文件给用户
   - 文本+图片组合发送

3. **消息聚合测试**
   - 单独发送文本 → 正常处理
   - 单独发送图片 → 正常处理
   - 快速发送图文 → 合并为一条
   - 连续发送多条独立消息 → 各自处理

## 8. 实现优先级

1. **P0**: 媒体上传功能（核心功能）
2. **P0**: 媒体发送集成
3. **P1**: 消息聚合窗口（解决重复回复）
4. **P2**: 媒体类型自动检测与降级