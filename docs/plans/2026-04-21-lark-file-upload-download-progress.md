# Lark/Feishu Channel File Upload/Download Implementation Progress

> Last updated: 2026-04-21

## Overview

飞书渠道集成位于 `src/channels/plugins/lark/` 目录，使用飞书官方 SDK `@larksuiteoapi/node-sdk`。

## Implementation Status

### ✅ 已实现

#### 1. 消息接收 - 类型识别
- **文件**: [LarkAdapter.ts:204-247](src/channels/plugins/lark/LarkAdapter.ts#L204-L247)
- **功能**: 识别飞书推送的消息类型并提取文件信息
- **支持类型**:
  - `image`: 提取 `image_key`
  - `file`: 提取 `file_key`, `file_name`
  - `audio`: 提取 `file_key`, `duration`
- **状态**: 只提取 fileId，未实际下载文件

#### 2. 消息发送 - 类型定义
- **文件**: [LarkAdapter.ts:316](src/channels/plugins/lark/LarkAdapter.ts#L316)
- **定义**: `type LarkContentType = 'text' | 'interactive' | 'image' | 'file'`
- **状态**: 类型已定义，但转换逻辑未实现

#### 3. 统一消息接口
- **文件**: [src/channels/types.ts:327-339](src/channels/types.ts#L327-L339)
- **接口**: `IUnifiedOutgoingMessage` 包含 `imageUrl`, `fileUrl`, `fileName` 字段
- **状态**: 接口定义存在，但 LarkPlugin 未使用

### ❌ 未实现

#### 1. 文件下载（接收用户文件）

**需求**: 将飞书 CDN 上的文件下载到本地 workspace

**飞书 SDK API**:
```typescript
// LarkPlugin.ts 需添加
async downloadFile(fileKey: string): Promise<Buffer> {
  const response = await this.client.im.file.download({
    path: { file_key: fileKey },
  });
  return Buffer.from(response.data);
}

async downloadImage(imageKey: string): Promise<Buffer> {
  const response = await this.client.im.image.download({
    path: { image_key: imageKey },
  });
  return Buffer.from(response.data);
}
```

**待实现位置**: `LarkPlugin.ts` 添加下载方法

**流程**:
1. 收到 file/image 消息 → 提取 file_key/image_key
2. 调用 SDK download API → 获取文件内容
3. 保存到本地 `channel-media/lark/` 目录
4. 将本地路径写入 `_localPath` 字段

#### 2. 文件上传（发送文件给用户）

**需求**: Agent 生成文件后上传到飞书并发送给用户

**飞书 SDK API**:
```typescript
// LarkPlugin.ts 需添加
async uploadFile(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const response = await this.client.im.file.upload({
    data: {
      file_type: 'stream',
      file: fileBuffer,
    },
  });
  return response.data.file_key;
}

async uploadImage(imagePath: string): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath);
  const response = await this.client.im.image.upload({
    data: {
      image_type: 'message',
      image: imageBuffer,
    },
  });
  return response.data.image_key;
}
```

**待实现位置**:
- `LarkAdapter.ts:323-352` - 扩展 `toLarkSendParams()` 处理 image/file 类型
- `LarkPlugin.ts:190-243` - 扩展 `sendMessage()` 支持发送文件

**流程**:
1. Agent 生成文件 → 文件路径
2. 调用 SDK upload API → 获取 file_key/image_key
3. 构造消息 `{ file_key: ... }` 或 `{ image_key: ... }`
4. 调用 `im.message.create` 发送

## File Structure

```
src/channels/plugins/lark/
├── LarkPlugin.ts      # 主要插件类 - WebSocket 连接、消息收发
├── LarkAdapter.ts     # 消息格式转换 - incoming/outgoing
├── LarkCards.ts       # 卡片消息构建（如果有）
└── index.ts           # 导出
```

## Reference: Similar Implementations

### WeCom (企业微信) - 已完整实现
- **下载**: [WeComPlugin.ts:333-455](src/channels/plugins/wecom/WeComPlugin.ts#L333-L455) - `downloadMediaItems()`
- **流程**: CDN URL + AES key → download + decrypt → save to local
- **存储**: `channel-media/wecom/` 目录

### WeChat (个人微信) - 已完整实现下载
- **下载**: [WeChatPlugin.ts:236-275](src/channels/plugins/wechat/WeChatPlugin.ts#L236-L275) - `downloadMediaItems()`
- **流程**: CDN URL + AES key → download + decrypt → save to local
- **存储**: `channel-media/wechat/` 目录
- **上传**: ❌ 未实现（API 未公开）

## Next Steps

1. **Phase 1: 文件下载**
   - 在 `LarkPlugin.ts` 添加 `downloadFile()` 和 `downloadImage()` 方法
   - 在消息处理流程中调用下载并保存到本地
   - 更新 `_localPath` 字段供下游使用

2. **Phase 2: 文件上传**
   - 在 `LarkPlugin.ts` 添加 `uploadFile()` 和 `uploadImage()` 方法
   - 扩展 `toLarkSendParams()` 处理 `image`/`file` 类型
   - 扩展 `sendMessage()` 支持发送文件消息

3. **Phase 3: 集成测试**
   - 测试用户发送文件 → Agent 接收
   - 测试 Agent 生成文件 → 发送给用户