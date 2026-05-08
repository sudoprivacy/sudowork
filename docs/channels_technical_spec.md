# Sudowork Channels 核心技术规格文档

## 1. 简介
Channels 是 Sudowork 的多平台助手框架，旨在通过统一的消息协议将 AI 能力集成到 IM 平台（Telegram, Lark, DingTalk, WeChat, WeCom）。

## 2. 目录结构与功能
- `core/`: 核心编排（ChannelManager, SessionManager）。
- `gateway/`: 网关层（ActionExecutor, PluginManager），处理路由与插件生命周期。
- `plugins/`: 平台插件实现。
- `adapters/`: 协议适配器（平台原生 ↔ 统一格式）。
- `agent/`: AI 集成层（EventBus, MessageService）。
- `actions/`: 业务逻辑处理器。
- `pairing/`: 授权配对系统。

## 3. 统一消息协议 (Unified Protocol)

### 3.1 IUnifiedIncomingMessage
```typescript
interface IUnifiedIncomingMessage {
  id: string;           // 消息唯一标识
  platform: string;     // 平台标识
  chatId: string;       // 隔离标识 (user:xxx / group:xxx)
  user: IUnifiedUser;   // 用户信息
  content: {
    type: string;       // text, photo, document, action, etc.
    text: string;
    attachments?: IUnifiedAttachment[];
  };
  action?: IMessageAction; // 交互按钮触发的动作
}
```

### 3.2 IUnifiedOutgoingMessage
```typescript
interface IUnifiedOutgoingMessage {
  type: 'text' | 'image' | 'file' | 'buttons';
  text?: string;
  buttons?: IActionButton[][]; // 矩阵式按钮
  parseMode?: 'Markdown' | 'HTML';
}
```

## 4. 平台适配详情

### 4.1 Telegram (grammY)
- **模式**: Long Polling。
- **消息长度**: 4096 字符。
- **流式实现**: 通过不断 `editMessageText` 更新同一条消息。

### 4.2 飞书 Lark (@larksuiteoapi/node-sdk)
- **模式**: WebSocket。
- **特性**: 使用 **Interactive Cards**。所有文字回复都在卡片中更新，以支持流式显示。
- **去重**: 必须处理飞书重复推送的事件。

### 4.3 钉钉 DingTalk (dingtalk-stream)
- **模式**: WebSocket Stream。
- **特性**: 使用 **AI Card**。通过 `streaming` 接口增量写入内容。

### 4.4 微信 WeChat (iLink)
- **模式**: Long Polling。
- **多媒体**: 微信多媒体文件采用 AES-ECB 加密，下载后需解密。
- **合并**: 微信经常将文字和图片拆分为两个包，系统会在 5 秒内尝试合并。

### 4.5 企业微信 WeCom
- **模式**: 官方 AI Bot WebSocket 协议。
- **流式**: 支持 `aibot_respond_msg` 流式分片发送。
- **多媒体**: 使用 AES-256-CBC 对文件进行加解密。

## 5. 核心逻辑流程

### 5.1 配对审批 (Pairing)
1. 匿名用户发送消息 → 触发 `PairingService` 生成配对码。
2. 内部通过 `channelBridge` 推送到 Sudowork UI。
3. 本地用户点击“审批” → 创建 `assistant_users` 记录。

### 5.2 消息处理 (ActionExecutor)
1. 接收 `IUnifiedIncomingMessage`。
2. 授权检查（是否已配对）。
3. 会话获取/创建（`userId:chatId` 复合键）。
4. 调用 `ChannelMessageService` 将消息转交给对应的 Agent。
5. 监听 `ChannelEventBus` 的流式输出。

### 5.3 流式节流 (Throttle)
- 设定 500ms 计时器。
- 只有在计时器到期或流结束时，才真正调用平台 API 进行消息编辑，防止触发平台频率限制。

## 6. 迁移要点
1. **数据库**: 确保迁移所有 `assistant_*` 开头的表。
2. **凭据加密**: 迁移 `utils/credentialCrypto.ts` 及其依赖，确保配置数据可读。
3. **EventBus**: 这是一个内存单例，如果跨进程迁移，需要考虑使用 Redis Pub/Sub 或类似的外部总线。
