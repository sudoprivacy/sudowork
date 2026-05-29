# 任务终止机制分析与设计

## 问题描述

用户在对话过程中主动点击终止任务后，任务继续执行，计时不停止。需要实现：
1. 用户主动终止后，服务端能够收到通知并停止 agent 执行
2. 返回"请求已被用户终止"的提示

## 当前架构分析

### 1. 前端终止流程

**触发点**: [AcpSendBox.tsx:731-738](src/renderer/pages/conversation/acp/AcpSendBox.tsx#L731-L738)

```typescript
const handleStop = async (): Promise<void> => {
  try {
    await ipcBridge.conversation.stop.invoke({ conversation_id });
  } finally {
    resetState(); // 重置 UI 状态
  }
};
```

### 2. 后端处理流程

**Bridge 层**: [conversationBridge.ts:825-833](src/process/bridge/conversationBridge.ts#L825-L833)

```typescript
ipcBridge.conversation.stop.provider(async ({ conversation_id }) => {
  const task = WorkerManage.getTaskById(conversation_id);
  if (!task) return { success: true, msg: 'conversation not found' };
  if (task.type !== 'acp' && task.type !== 'openclaw-gateway' && task.type !== 'remote-agent') {
    return { success: false, msg: 'not support' };
  }
  await task.stop();
  return { success: true };
});
```

### 3. Agent 的 stop 实现

#### AcpAgent ([AcpAgent.ts:1081-1148](src/process/task/AcpAgent.ts#L1081-L1148))

```typescript
async stop(): Promise<void> {
  // 1. Telemetry 记录用户取消
  endConversationUserCancel(this.conversation_id);

  // 2. 刷新缓冲的流文本
  this.streamTextBuffer.flushAll();

  // 3. 拒绝所有待处理的权限请求
  for (const [callId, pending] of this.pendingPermissions) {
    pending.reject(new Error('Cancelled'));
  }

  // 4. 清除确认 UI
  // 5. 调用 connection.cancel() 发送 ACP 协议取消指令
  result = await this.connection.cancel();

  // 6. 根据结果处理:
  //    - 'cancelled': session 存活，finish 已通过 onEndTurn 发送
  //    - 'abandoned': 超时未响应，发送 finish
  //    - 'disconnected': 进程被杀死，清理并发送 finish
}
```

#### RemoteAgent ([RemoteAgent.ts:303-306](src/process/task/RemoteAgent.ts#L303-L306))

```typescript
async stop(): Promise<void> {
  this.connection?.sendInterrupt(); // 发送 WebSocket 中断消息
  this.emitFinishMessage(); // 立即发送 finish 消息
}
```

### 4. Moss Server WebSocket 中断机制

**MossWsConnection**: [MossWsConnection.ts:519-526](src/agent/remote/MossWsConnection.ts#L519-L526)

```typescript
sendInterrupt(): void {
  if (this.state !== 'connected' || !this.ws) return;
  this.ws.send(JSON.stringify({
    type: 'control_request',
    request_id: uuid(36),
    request: { subtype: 'interrupt' },
  }));
}
```

### 5. 前端状态管理

**状态变量**:
- `running`: 是否正在运行
- `aiProcessing`: AI 是否正在处理

**状态重置时机**:
- 收到 `finish` 消息时
- 用户点击停止按钮后调用 `resetState()`

## 问题根因分析

### 可能的问题点

1. **RemoteAgent 的 stop 过于简单**
   - 只发送 interrupt 消息，没有等待服务端确认
   - 立即发送 finish，但服务端可能还在执行

2. **服务端（Moss Server）未正确处理 interrupt**
   - Moss Server 可能没有正确响应 `control_request` 类型的 interrupt 消息
   - 或者 interrupt 消息格式不符合服务端预期

3. **前端状态与后端状态不同步**
   - 前端调用 stop 后立即 resetState()
   - 但后端可能还在继续执行任务

4. **缺少终止确认机制**
   - 当前实现是"发送后即认为成功"
   - 没有等待服务端确认终止

## 解决方案设计

### 核心需求

1. **终止确认机制**：等待服务端确认终止，确保双方状态一致
2. **用户终止提示**：返回"请求已被用户终止"的明确提示消息

### 方案一：增强终止确认机制（推荐）

#### 1. 修改 RemoteAgent.stop()

```typescript
async stop(): Promise<void> {
  // 1. 发送中断请求
  const interruptId = uuid(36);
  this.connection?.sendInterrupt(interruptId);

  // 2. 等待服务端确认（带超时）
  const confirmed = await this.waitForInterruptConfirmation(interruptId, 5000);

  if (!confirmed) {
    // 3. 超时后强制断开连接
    mainWarn('RemoteAgent', 'Interrupt confirmation timeout, forcing disconnect');
    this.connection?.disconnect();
  }

  // 4. 发送用户终止提示消息
  this.emitUserCancelledMessage();

  // 5. 发送 finish 消息
  this.emitFinishMessage();
}

/**
 * 发送用户终止提示消息
 */
private emitUserCancelledMessage(): void {
  ipcBridge.conversation.responseStream.emit({
    type: 'tips',
    conversation_id: this.conversation_id,
    msg_id: uuid(36),
    data: {
      type: 'info',
      content: '请求已被用户终止',
    },
  });
}
```

#### 2. 修改 AcpAgent.stop()

```typescript
async stop(): Promise<void> {
  // 1. Telemetry 记录用户取消
  endConversationUserCancel(this.conversation_id);

  // 2. 刷新缓冲的流文本
  this.streamTextBuffer.flushAll();

  // 3. 拒绝所有待处理的权限请求
  for (const [callId, pending] of this.pendingPermissions) {
    pending.reject(new Error('Cancelled'));
  }
  this.pendingPermissions.clear();
  this.permissionRequestMeta.clear();

  // 4. 清除确认 UI
  for (const confirmation of this.confirmations) {
    ipcBridge.conversation.confirmation.remove.emit({
      conversation_id: this.conversation_id,
      id: confirmation.id,
    });
  }
  this.confirmations = [];

  // 5. 调用 connection.cancel() 发送 ACP 协议取消指令
  let result: 'cancelled' | 'abandoned' | 'disconnected';
  try {
    result = await this.connection.cancel();
  } catch {
    await this.connection.disconnect();
    result = 'disconnected';
  }

  this.status = 'finished';

  // 6. 发送用户终止提示消息（新增）
  this.emitUserCancelledMessage();

  // 7. 根据结果发送 finish
  if (result === 'disconnected') {
    this.emitStatusMessage('disconnected');
    this.approvalStore.clear();
    this.bootstrap = undefined;
    this.handleStreamEvent({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    });
    return;
  }

  if (result === 'abandoned') {
    void this.handleSignalEvent({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    });
    return;
  }

  // result === 'cancelled': finish 已通过 onEndTurn 发送
}

/**
 * 发送用户终止提示消息（新增方法）
 */
private emitUserCancelledMessage(): void {
  const message: TMessage = {
    id: uuid(),
    conversation_id: this.conversation_id,
    type: 'tips',
    position: 'center',
    createdAt: Date.now(),
    content: {
      content: '请求已被用户终止',
      type: 'info',
    },
  };
  this.emitMessage(message);
}
```

### 方案二：服务端轮询检查终止状态

#### 1. 添加终止状态存储

```typescript
// 在 WorkerManage 或全局状态中
const cancelledConversations = new Set<string>();

function markConversationCancelled(conversationId: string): void {
  cancelledConversations.add(conversationId);
}

function isConversationCancelled(conversationId: string): boolean {
  return cancelledConversations.has(conversationId);
}
```

#### 2. Agent 执行时检查终止状态

在 AcpAgent 或 RemoteAgent 的消息处理循环中：

```typescript
// 定期检查是否被终止
if (isConversationCancelled(this.conversation_id)) {
  this.emitUserCancelledMessage();
  this.emitFinishMessage();
  return;
}
```

### 方案三：WebSocket 心跳检测终止

#### 1. 添加终止心跳机制

```typescript
// 前端定期发送心跳
setInterval(() => {
  if (running) {
    ws.send(JSON.stringify({ type: 'heartbeat', conversation_id }));
  }
}, 1000);

// 服务端检测心跳超时
// 如果超过 2 秒没有收到心跳，认为用户已终止
```

---

## 用户终止提示消息设计

### 消息格式

用户终止提示使用 `tips` 类型的消息，格式如下：

```typescript
{
  type: 'tips',
  conversation_id: string,
  msg_id: string,
  data: {
    type: 'info',  // 使用 info 类型，区别于 error
    content: '请求已被用户终止',
  },
}
```

### 消息发送时机

1. **RemoteAgent**: 在 `stop()` 方法中，发送 interrupt 后、发送 finish 前
2. **AcpAgent**: 在 `stop()` 方法中，调用 `connection.cancel()` 后、发送 finish 前
3. **OpenClawAgent**: 同样需要在 `stop()` 方法中添加

### 消息显示效果

- 在聊天界面中以提示卡片形式显示
- 使用信息提示样式（非错误样式）
- 显示文本："请求已被用户终止"

### 国际化支持

需要添加 i18n 翻译 key：

```json
{
  "conversation.userCancelled": "请求已被用户终止",
  "conversation.userCancelled.en": "Request cancelled by user"
}
```

---

## MossWsConnection 中断确认机制

### 修改 MossWsConnection

```typescript
// 添加待确认中断请求存储
private pendingInterrupts = new Map<string, {
  sentAt: number;
  resolved: boolean;
  resolve: (confirmed: boolean) => void;
}>();

sendInterrupt(requestId?: string): void {
  if (this.state !== 'connected' || !this.ws) return;
  const id = requestId || uuid(36);
  this.ws.send(JSON.stringify({
    type: 'control_request',
    request_id: id,
    request: { subtype: 'interrupt' },
  }));

  // 存储待确认的中断请求
  this.pendingInterrupts.set(id, {
    sentAt: Date.now(),
    resolved: false,
    resolve: () => {}, // 占位，实际由 waitForInterruptConfirmation 设置
  });
}

/**
 * 等待中断确认
 * @param requestId 中断请求 ID
 * @param timeoutMs 超时时间（毫秒）
 */
waitForInterruptConfirmation(requestId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const pending = this.pendingInterrupts.get(requestId);
    if (!pending) {
      resolve(false);
      return;
    }

    // 设置超时
    const timeout = setTimeout(() => {
      this.pendingInterrupts.delete(requestId);
      resolve(false);
    }, timeoutMs);

    // 更新 resolve 函数
    pending.resolve = (confirmed: boolean) => {
      clearTimeout(timeout);
      this.pendingInterrupts.delete(requestId);
      resolve(confirmed);
    };
  });
}

// 处理服务端响应
private handleControlResponse(msg: any): void {
  if (msg.type === 'control_response' && msg.response?.subtype === 'interrupt_ack') {
    const requestId = msg.request_id;
    const pending = this.pendingInterrupts.get(requestId);
    if (pending) {
      pending.resolved = true;
      pending.resolve(true);
    }
  }
}
```

### 修改 handleMessage 添加 control_response 处理

```typescript
private processParsedMessage(msg: any): void {
  // 添加 control_response 处理
  if (msg.type === 'control_response') {
    this.handleControlResponse(msg);
    return;
  }

  // ... 其他消息处理
}
```

## 推荐方案

**推荐方案一**，原因：

1. **明确确认机制**：等待服务端确认终止，确保双方状态一致
2. **超时保护**：如果服务端无响应，强制断开连接
3. **用户友好提示**：发送明确的终止提示消息
4. **最小改动**：只需修改 RemoteAgent 和 MossWsConnection

## 实现步骤

### Phase 1: 添加用户终止提示消息

1. **RemoteAgent**: 添加 `emitUserCancelledMessage()` 方法
2. **AcpAgent**: 添加 `emitUserCancelledMessage()` 方法
3. **OpenClawAgent**: 添加 `emitUserCancelledMessage()` 方法
4. 在各 Agent 的 `stop()` 方法中调用该方法

### Phase 2: 增强终止确认机制

1. 修改 `MossWsConnection.sendInterrupt()` 支持确认机制
2. 添加 `MossWsConnection.waitForInterruptConfirmation()` 方法
3. 在 `handleMessage()` 中处理 `control_response`
4. 修改 `RemoteAgent.stop()` 添加终止确认等待

### Phase 3: 前端状态优化

1. 在 `handleStop()` 中等待后端确认后再 `resetState()`
2. 显示终止中的加载状态
3. 终止成功后显示提示

### Phase 4: 国际化支持

1. 添加 i18n 翻译 key `conversation.userCancelled`
2. 在消息内容中使用 i18n

## 测试用例

1. **正常终止**：用户点击停止 → 服务端确认 → 显示"请求已被用户终止"提示 → UI 状态重置
2. **超时终止**：用户点击停止 → 服务端无响应（5秒超时）→ 强制断开 → 显示"请求已被用户终止"提示
3. **网络断开**：用户点击停止 → 网络已断开 → 直接显示"请求已被用户终止"提示
4. **重复终止**：用户连续点击停止 → 只处理第一次 → 只显示一条终止提示
5. **ACP Agent 终止**：验证 AcpAgent 的 stop 流程正确发送终止提示
6. **Remote Agent 终止**：验证 RemoteAgent 的 stop 流程正确发送终止提示
7. **OpenClaw Agent 终止**：验证 OpenClawAgent 的 stop 流程正确发送终止提示

## 相关文件

- [src/renderer/pages/conversation/acp/AcpSendBox.tsx](src/renderer/pages/conversation/acp/AcpSendBox.tsx) - 前端终止触发
- [src/process/bridge/conversationBridge.ts](src/process/bridge/conversationBridge.ts) - IPC Bridge
- [src/process/task/RemoteAgent.ts](src/process/task/RemoteAgent.ts) - Remote Agent
- [src/process/task/AcpAgent.ts](src/process/task/AcpAgent.ts) - ACP Agent
- [src/agent/remote/MossWsConnection.ts](src/agent/remote/MossWsConnection.ts) - Moss WebSocket 连接
