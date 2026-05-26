# 上下文超限恢复方案

## 背景

当前项目在 ACP 对话中会持久化并复用底层模型 session，例如 `extra.acpSessionId`。当该 session 的历史上下文超过模型处理限制后，后续消息仍然继续发送到同一个已超限 session，因此用户无论再输入什么，都会反复收到“对话内容过长，超出模型处理限制”。

相关位置：

- `src/process/task/AcpAgent.ts`：ACP session 恢复与 prompt 发送错误处理
- `src/process/bridge/conversationBridge.ts`：通用发送入口
- `src/process/task/acp/AcpPersistence.ts`：context usage 持久化
- `src/process/utils/llmErrorTranslation.ts`：LLM 错误翻译

## 目标

1. 超限后不再重复向旧 `acpSessionId` 发送消息。
2. 在对话中给用户明确的恢复按钮。
3. 用户无需手动总结，点击“压缩并继续”即可恢复。
4. 保留 UI 聊天记录，但底层模型 session 可以重建。
5. 支持接近上限时提前预警。

## 非目标

1. 不删除用户历史聊天记录。
2. 不要求用户手动复制、总结、粘贴上下文。
3. 不尝试在已经超限的旧 session 内完成摘要。

## 用户流程

正常对话时，系统持续监听 `acp_context_usage`。

当接近上限时，在对话中插入系统动作卡片：

```text
当前对话上下文接近模型上限，继续发送可能失败。

[压缩后继续] [新会话继续] [继续当前会话]
```

此时不阻断发送。

当模型已经返回 context overflow 错误时，插入阻断卡片：

```text
当前模型会话已超过上下文限制，无法继续向原会话发送消息。

你可以压缩历史后继续，或开启一个空白模型上下文继续。

[压缩并继续] [开启空白新会话]
```

此时禁用普通发送，只允许用户执行恢复动作。

## 超限判断

超限判断分三层：

1. 服务端错误，作为最终判定。
2. `acp_context_usage`，用于提前预警。
3. 发送前估算，用于防止明显会失败的请求继续发送。

服务端错误命中以下模式时，直接判定为已超限：

```text
context_length_exceeded
maximum context length
context length
token limit
prompt is too long
input is too long
too many tokens
exceeds the context
超出模型处理限制
```

`acp_context_usage` 判断规则：

```ts
used / size >= 0.85 -> near_limit
used / size >= 0.95 -> critical
```

发送前估算：

```ts
projectedUsed = used + estimatedNextInputTokens + reservedOutputTokens;
```

如果 `projectedUsed >= size`，可以发送前阻断并提示恢复。

如果 `size = 0`，使用模型名查询 context window 兜底，例如现有的 `getModelContextLimit`。

## 状态模型

在 `TChatConversation.extra` 增加：

```ts
contextRecovery?: {
  status: 'normal' | 'near_limit' | 'critical' | 'overflowed' | 'compressing' | 'compressed' | 'failed';
  failedSessionId?: string;
  recoveredSessionId?: string;
  failedAt?: number;
  recoveredAt?: number;
  summaryMessageId?: string;
  lastFailedMsgId?: string;
  error?: string;
}
```

状态含义：

- `normal`：正常发送。
- `near_limit`：接近上限，只提示。
- `critical`：强提示压缩。
- `overflowed`：已超限，阻断普通发送。
- `compressing`：正在压缩，禁用输入。
- `compressed`：已压缩并切换到新 session。
- `failed`：恢复失败，可允许用户选择空白新会话。

## 后端设计

新增错误判断工具，例如 `src/process/utils/contextOverflow.ts`：

```ts
export function isContextOverflowError(message: string): boolean {
  const text = message.toLowerCase();
  return [
    'context_length_exceeded',
    'maximum context length',
    'context length',
    'token limit',
    'prompt is too long',
    'input is too long',
    'too many tokens',
    'exceeds the context',
    '超出模型处理限制',
  ].some((pattern) => text.includes(pattern));
}
```

在 `AcpAgent.sendToConnection` 的错误处理中识别：

```ts
if (isContextOverflowError(errorMsg)) {
  await this.markContextOverflow(data.msg_id, errorMsg);
  this.emitContextRecoveryCard('overflowed');
  return {
    success: false,
    error: createAcpError(AcpErrorType.UNKNOWN, errorMsg, false),
  };
}
```

关键点：这里不能只翻译错误，必须持久化 `contextRecovery.status = 'overflowed'`。

## 发送阻断

在 `conversationBridge.sendMessage` 或 `AcpAgent.sendMessage` 开头检查：

```ts
if (conversation.extra?.contextRecovery?.status === 'overflowed') {
  return {
    success: false,
    msg: 'context_overflow_requires_recovery',
  };
}
```

这样可以避免继续打到同一个已失败 session。

## 恢复 IPC

新增接口：

```ts
conversation.recoverContext({
  conversation_id: string;
  strategy: 'compress' | 'fresh';
});
```

### fresh 流程

1. 查询 conversation。
2. 清空 `extra.acpSessionId`。
3. 清空或重置 `contextRecovery`。
4. `WorkerManage.kill(conversation_id)`。
5. 下一次发送重新创建底层 session。

### compress 流程

1. 设置 `status = 'compressing'`。
2. 从数据库读取当前 conversation messages。
3. 生成结构化摘要。
4. 保存一条“上下文已压缩”的系统消息。
5. 清空旧 `extra.acpSessionId`。
6. `WorkerManage.kill(conversation_id)`。
7. 重建 task，创建新 ACP session。
8. 将摘要作为新 session 的首条上下文注入。
9. 设置 `status = 'compressed'`，保存新 session id。

## 摘要生成策略

不能让已超限的旧 session 总结自己。摘要应基于本地数据库消息生成。

摘要格式建议：

```md
# 压缩后的上下文摘要

## 用户目标
...

## 已完成事项
...

## 关键决策
...

## 当前状态
...

## 涉及文件
...

## 最近对话
...

## 下一步
...
```

注入新 session 的首条 prompt：

```md
以下是此前对话的压缩摘要。请把它作为当前会话上下文继续工作，不要要求用户重复说明。

<compressed_context>
...
</compressed_context>
```

优先实现本地规则摘要兜底：

- 保留最近 8-12 轮原文。
- 长工具输出只保留摘要和结果。
- 保留文件路径、命令、错误、关键决策。
- 超长文本截断。

后续再接入模型分块摘要，提高质量。

## 前端设计

新增消息类型，例如：

```ts
type: 'context_recovery'
data: {
  reason: 'near_limit' | 'critical' | 'overflowed';
  used?: number;
  size?: number;
  actions: Array<{
    id: 'compress' | 'fresh' | 'dismiss';
    label: string;
  }>;
}
```

Renderer 渲染为系统动作卡片。按钮由应用生成，不由模型生成。

按钮行为：

- `压缩并继续`：调用 `conversation.recoverContext({ strategy: 'compress' })`
- `开启空白新会话`：调用 `conversation.recoverContext({ strategy: 'fresh' })`
- `继续当前会话`：仅隐藏 near limit 提示，不改变 session

发送框状态：

- `near_limit`：不禁用。
- `critical`：不禁用，但强提示。
- `overflowed`：禁用普通发送。
- `compressing`：禁用发送，显示处理中。
- `compressed`：恢复发送。

## 落地顺序

1. 增加 `isContextOverflowError`。
2. 在 ACP 错误处理里标记 `overflowed`。
3. 超限后阻断普通发送，避免重复失败。
4. 增加 `context_recovery` UI 卡片和按钮。
5. 实现 `fresh` 恢复，先解决核心问题。
6. 实现本地规则摘要的 `compress` 恢复。
7. 基于 `acp_context_usage` 增加 85%/95% 预警。
8. 后续接入模型分块摘要。

## 测试要点

1. 模拟 context overflow 错误后，conversation 被标记为 `overflowed`。
2. `overflowed` 状态下再次发送不会调用旧 session。
3. 点击 `开启空白新会话` 后，`acpSessionId` 被清空，下一次发送创建新 session。
4. 点击 `压缩并继续` 后，新 session 收到摘要上下文。
5. UI 历史不丢失。
6. 页面刷新后仍能显示恢复状态。
7. `near_limit` 只提示，不阻断发送。
