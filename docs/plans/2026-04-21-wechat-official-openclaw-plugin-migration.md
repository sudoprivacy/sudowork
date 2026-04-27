# 个人微信改用官方 OpenClaw 插件改造方案

> Date: 2026-04-21

## 背景

当前 Sudowork 使用自己实现的 `WeChatPlugin`，通过 iLink Bot HTTP API 接收和发送消息。
改用腾讯官方 `@tencent/openclaw-weixin` 插件后，消息流经 OpenClaw Gateway，可获得文件上传能力。

## 架构对比

### 当前架构 (WeChatPlugin)

```
微信 → iLink Bot API (HTTP) → Sudowork WeChatPlugin → ChannelManager → Agent
                                  ↑
                                  └── 自己处理 CDN 下载 + AES 解密
```

### 目标架构 (官方 OpenClaw 微信插件)

```
微信 → OpenClaw Gateway (WebSocket) → Sudowork OpenClawAgent → Agent
         ↑
         └── @tencent/openclaw-weixin 插件处理文件上传下载
```

---

## 需要改造的组件

### 1. 消息接收层

**当前**: `WeChatPlugin` HTTP 长轮询
**目标**: 通过 `OpenClawAgent` 接收微信消息

**改造内容**:

| 模块 | 当前 | 改造后 |
|------|------|--------|
| 入口 | `WeChatPlugin.pollLoop()` | `OpenClawAgent.handleEvent()` |
| API | HTTP `/ilink/bot/getupdates` | OpenClaw WebSocket `chat` event |
| 格式转换 | `WeChatAdapter.toUnifiedIncomingMessage()` | 新增 OpenClaw 微信消息适配器 |

**需要新增的代码**:

```typescript
// 新增: OpenClawWeChatAdapter.ts
// 将 OpenClaw 微信插件的消息格式转换为 IUnifiedIncomingMessage

export function toUnifiedIncomingMessage(openclawWeixinMessage: unknown): IUnifiedIncomingMessage | null {
  // OpenClaw 微信插件的消息格式需要适配
  // 可能包含: text, image, file, video 等类型
  // attachments 可能有本地路径（OpenClaw 已处理下载）
}
```

**改造点**:
- [ChannelManager.ts:57](src/channels/core/ChannelManager.ts#L57) - 注册插件方式可能需要调整
- [OpenClawAgent.ts:732-760](src/process/task/OpenClawAgent.ts#L732-L760) - `handleEvent()` 需要识别微信消息类型

---

### 2. 消息发送层

**当前**: `WeChatPlugin.sendMessage()` → iLink HTTP API
**目标**: 通过 `OpenClawAgent.chatSend()` 发送消息

**改造内容**:

| 模块 | 当前 | 改造后 |
|------|------|--------|
| 入口 | `WeChatPlugin.sendMessage()` | `OpenClawGatewayConnection.chatSend()` |
| API | HTTP `/ilink/bot/sendmessage` | OpenClaw WebSocket `chat` request |
| 文件发送 | ❌ 不支持 | ✅ 通过 `attachments` 参数支持 |

**OpenClaw Gateway 支持的 attachments**:

```typescript
// src/agent/openclaw/types.ts:139-147
export interface ChatSendParams {
  sessionKey: string;
  message: string;
  thinking?: string;
  deliver?: boolean;
  attachments?: unknown[];  // ← 文件附件支持
  timeoutMs?: number;
  idempotencyKey: string;
}
```

**改造点**:
- [ChannelMessageService.ts](src/channels/agent/ChannelMessageService.ts) - 发送消息时需要调用 OpenClaw Agent
- 需要将 `IUnifiedOutgoingMessage` 中的 `imageUrl`, `fileUrl` 转换为 OpenClaw attachments 格式

---

### 3. 文件处理

**当前**: Sudowork 自己处理
**目标**: OpenClaw 插件处理

| 功能 | 当前 | 改造后 |
|------|------|--------|
| 文件下载 | `WeChatApiClient.downloadMedia()` + AES 解密 | OpenClaw 插件自动处理 |
| 文件存储 | `channel-media/wechat/` | OpenClaw workspace |
| 文件路径 | `_localPath` 字段 | OpenClaw attachments 中携带 |
| 文件上传 | ❌ 不支持 | ✅ OpenClaw 插件处理 |

**改造点**:
- 移除 `WeChatCrypto.ts` 的 AES 解密逻辑（不再需要）
- 移除 `WeChatApiClient.downloadMedia()` 方法
- 依赖 OpenClaw 提供的文件路径

---

### 4. 配置/登录流程

**当前**: 扫码登录获取 `bot_token` + `account_id`
**目标**: 通过 OpenClaw 插件配置

**当前流程** ([WeChatConfigForm.tsx](src/renderer/components/SettingsModal/contents/WeChatConfigForm.tsx)):
```
用户点击连接 → WeChatApiClient.startQrLogin() → 显示二维码 → 扫码确认 
→ 获取 bot_token → channel.enablePlugin() → 启动 WeChatPlugin
```

**改造后流程**:
```
用户点击连接 → 调用 OpenClaw weixin-installer → openclaw plugins install
→ 扫码连接 → 微信插件启动 → Sudowork 监听 OpenClaw 事件
```

**改造点**:
- [WeChatConfigForm.tsx](src/renderer/components/SettingsModal/contents/WeChatConfigForm.tsx) - UI 改为调用 OpenClaw 安装命令
- 配置存储从 sudowork 数据库改为 OpenClaw 配置文件

---

### 5. 会话管理

**当前**: WeChatPlugin 维护 `context_token`
**目标**: OpenClaw Gateway 管理 session

| 模块 | 当前 | 改造后 |
|------|------|--------|
| 会话标识 | `context_token` (per user) | `sessionKey` (OpenClaw) |
| 用户映射 | WeChatPlugin 内部 | OpenClaw session → Sudowork conversation |
| 会话恢复 | `WeChatContextTokenStore` | `OpenClawGatewayConnection.sessionsResolve()` |

---

## 改造工作量评估

### 高优先级（核心功能）

| 任务 | 工作量 | 文件 |
|------|--------|------|
| OpenClaw 微信消息适配器 | 中 | 新增 `OpenClawWeChatAdapter.ts` |
| ChannelManager 集成调整 | 小 | `ChannelManager.ts` |
| 消息发送改造 | 中 | `ChannelMessageService.ts` |
| 配置 UI 改造 | 中 | `WeChatConfigForm.tsx` |

### 中优先级（辅助功能）

| 任务 | 工作量 | 文件 |
|------|--------|------|
| 会话映射改造 | 中 | `SessionManager.ts` |
| 文件附件处理 | 中 | `ChatSendParams` attachments |
| 用户授权流程 | 小 | `PairingService.ts` |

### 低优先级（可移除）

| 任务 | 工作量 | 文件 |
|------|--------|------|
| 移除 WeChatPlugin | 小 | `WeChatPlugin.ts` |
| 移除 iLink API Client | 小 | `WeChatApiClient.ts` |
| 移除 AES 解密 | 小 | `WeChatCrypto.ts` |

---

## 关键依赖

### OpenClaw 版本要求
- 需要 OpenClaw >= 2026.3.0
- 需要安装 `@tencent/openclaw-weixin` 插件

### Sudowork OpenClawAgent
- 已有实现: `src/process/task/OpenClawAgent.ts`
- 需要扩展支持微信消息类型识别

---

## 实施步骤

### Phase 1: 消息接收改造
1. 创建 `OpenClawWeChatAdapter.ts` 适配 OpenClaw 微信消息格式
2. 在 `OpenClawAgent.handleEvent()` 中识别微信消息
3. 将微信消息转换为 `IUnifiedIncomingMessage`
4. 通过 `channelEventBus` 发送给 ChannelManager

### Phase 2: 消息发送改造
1. 扩展 `ChannelMessageService` 支持发送到 OpenClaw Agent
2. 将 `IUnifiedOutgoingMessage.fileUrl` 转换为 OpenClaw attachments
3. 调用 `OpenClawGatewayConnection.chatSend()` 发送消息

### Phase 3: 配置 UI 改造
1. 修改 `WeChatConfigForm.tsx` 调用 OpenClaw 安装命令
2. 移除 iLink Bot API 相关的登录流程
3. 显示 OpenClaw 微信插件状态

### Phase 4: 清理旧代码
1. 移除 `WeChatPlugin.ts`, `WeChatApiClient.ts`, `WeChatCrypto.ts`
2. 更新 `ChannelManager.ts` 注册逻辑

---

## 风险与注意事项

1. **消息格式差异**: OpenClaw 微信插件的消息格式可能与 iLink API 不同，需要适配
2. **会话映射**: 需要建立 OpenClaw sessionKey ↔ Sudowork conversationId 的映射
3. **用户授权**: Pairing 流程可能需要调整
4. **文件路径**: OpenClaw 处理的文件路径需要正确传递给 Agent
5. **向后兼容**: 需要考虑是否保留旧版 WeChatPlugin 作为备选