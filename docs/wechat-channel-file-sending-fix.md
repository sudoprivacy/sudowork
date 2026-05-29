# WeChat Channel File Sending Fix

## 问题背景

从 openclaw-gateway 迁移到 scode 后，渠道客户端（微信、企业微信、钉钉、飞书、Telegram）无法正确接收 AI 生成的文件/图片。

## 发现的问题

### 问题 1: 文件发送功能缺失

**现象**: Agent 创建文件后，文件没有发送到微信用户。

**原因**: `AcpAgent` 缺少文件检测和发送逻辑。`OpenClawAgent` 有完整的文件检测机制，但迁移到 scode 后这个功能丢失了。

**解决方案**:
- 添加工作区文件快照跟踪机制
- 实现两种文件检测策略：
  - **Strategy 1**: 从 `SendUserMessage` 工具的 `attachments` 参数提取文件路径
  - **Strategy 2**: 检测用户意图关键词（"发我", "send me" 等），在 `write_file`/`edit_file` 工具完成时自动发送文件

### 问题 2: WeChat API `ret=-2` 错误

**现象**: 发送 docx 文件时收到 `ret=-2` 错误。

**原因**: 文件发送顺序问题。WeChat 需要先发送文本消息，再发送文件。

**解决方案**:
- 在 `ActionExecutor.ts` 中实现文件缓冲机制
- 文本消息立即发送，文件先缓冲
- 流结束后，先发送最终文本消息，再发送缓冲的文件

### 问题 3: Stream Timeout 导致消息丢失

**现象**: 微信只收到 "Response timed out. Please try again." 但 sudowork 应用显示会话正确返回。

**原因**: 原有的超时机制会在 5 分钟后直接清理流，导致后续消息丢失。

**解决方案**:
- 实现软/硬超时机制：
  - **软超时 (5分钟)**: 发送超时警告，但保持流活跃，等待后续消息
  - **硬超时 (10分钟)**: 强制清理流

### 问题 4: 中间文件被误发送

**现象**: Agent 执行过程中创建的临时文件（如 `temp.md`, `create_*.py`）被发送给用户。

**原因**: 文件发送逻辑没有过滤中间文件。

**解决方案**:
- 添加中间文件过滤逻辑：
  - `.md` 文件中包含 `temp`、`payload`、`draft` 的不发送
  - `.py` 脚本中包含 `create_`、`generate_`、`convert_` 的不发送

### 问题 5: 最终文本消息未发送

**现象**: 微信用户没有收到 Agent 的最终回复文本。

**原因**: `supportsEdit=false` 的平台（如 WeChat）在流结束时没有发送最终文本消息。

**解决方案**:
- 在 `ActionExecutor.ts` 中，对于 `supportsEdit=false` 的平台，在流结束时发送最终文本消息

## 修改的文件

### 1. `src/process/task/AcpAgent.ts`

**修改内容**:
- 添加 `lastUserMessage` 属性存储用户原始消息
- 在 `sendMessage` 中存储用户消息内容
- 在 `tool_call` 事件中存储工具调用元数据
- 在 `tool_call_update` 事件中：
  - 调用 `generateUserMessageFromToolCall` 显示工具结果（来自 dev 分支）
  - 检测 `SendUserMessage` 工具，发送附件文件
  - 检测 `write_file`/`edit_file` 工具，根据用户意图自动发送文件
- 添加 `sendFileToChannels` 方法发送文件到渠道客户端
- 添加 `refreshWorkspaceFileSnapshot` 和 `extractFilePathFromToolCall` 辅助方法

**关键代码**:
```typescript
// 存储用户消息
if (data.content) {
  this.lastUserMessage = data.content;
}

// 用户意图检测
const userWantsFileSent = /发我|发给我|发送给我|发到|发送到|发来|发过来|send me|send to me/i.test(userMessage);

// 中间文件过滤
const isDraftExtension = ext === '.md' && (filePath.includes('temp') || filePath.includes('payload') || filePath.includes('draft'));
const isIntermediateScript = ext === '.py' && (filePath.includes('create_') || filePath.includes('generate_') || filePath.includes('convert_'));
```

### 2. `src/channels/agent/ChannelMessageService.ts`

**修改内容**:
- 添加 `STREAM_HARD_TIMEOUT_MS` (10分钟) 硬超时
- 添加 `hardTimeoutTimer` 和 `timedOut` 字段到 `IStreamState`
- 软超时：发送警告，保持流活跃
- 硬超时：强制清理流

**关键代码**:
```typescript
// 软超时：发送警告，保持流活跃
const timeoutTimer = setTimeout(() => {
  if (staleStream && !staleStream.timedOut) {
    staleStream.timedOut = true;
    staleStream.callback({ type: 'tips', content: { type: 'error', content: 'Response timed out. Please try again.' } }, true);
    // 保持流活跃，不清理
  }
}, STREAM_TIMEOUT_MS);

// 硬超时：强制清理
const hardTimeoutTimer = setTimeout(() => {
  if (staleStream && !staleStream.draining) {
    this.activeStreams.delete(conversationId);
    staleStream.resolve(staleStream.msgId);
  }
}, STREAM_HARD_TIMEOUT_MS);
```

### 3. `src/channels/gateway/ActionExecutor.ts`

**修改内容**:
- 对于 `supportsEdit=false` 的平台（WeChat），缓冲文件而不是立即发送
- 流结束后，先发送最终文本消息，再发送缓冲的文件
- 添加调试日志

**关键代码**:
```typescript
// WeChat 文件缓冲
if (streamOutgoing.type === 'image' || streamOutgoing.type === 'file') {
  pendingFilesToSend.push(streamOutgoing);
}

// 流结束后发送
if (!supportsEdit && lastTextContent) {
  await context.sendMessage(finalMessage);  // 先发文本
}
for (const file of pendingFilesToSend) {
  await context.sendMessage(file);  // 再发文件
}
```

### 4. `src/channels/plugins/wechat/WeChatApiClient.ts`

**修改内容**:
- 添加 API 响应错误日志（检查 `ret` 和 `errcode`）

### 5. `src/channels/plugins/wechat/WeChatPlugin.ts`

**修改内容**:
- `sendMediaItem` 方法返回 `boolean` 表示是否成功
- 添加发送错误日志

## 合并冲突解决

PR #572 与 dev 分支合并时，`AcpAgent.ts` 发生冲突：

**冲突原因**: dev 分支添加了 `generateUserMessageFromToolCall` 方法调用，与我们的文件发送逻辑在同一位置。

**解决方案**: 合并两个功能：
1. 先调用 `generateUserMessageFromToolCall` 显示工具结果
2. 再执行文件发送逻辑

```typescript
// Generate user message for SendUserMessage/AskUserQuestion tool results
if (toolStatus === 'completed') {
  const userMessage = this.adapter.generateUserMessageFromToolCall(statusUpdate);
  if (userMessage) {
    this.emitMessage(userMessage);
  }
}

// Intercept file-creation tool calls: send generated files to channel clients
if (toolStatus === 'completed' && toolCallId) {
  // ... 文件发送逻辑
}
```

## 测试验证

测试场景：
1. 发送图片 + 文本 "将图片内容保存成一个word文档发我"
2. Agent 创建 docx 文件
3. 验证文件是否发送到微信

预期结果：
- 微信收到 Agent 的文本回复
- 微信收到生成的 docx 文件

## 相关 PR

- PR #572: https://github.com/sudoprivacy/sudowork/pull/572
