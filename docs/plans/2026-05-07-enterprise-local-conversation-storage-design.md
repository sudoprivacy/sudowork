# Design: Enterprise Mode Local Conversation Storage + On-Click Sync

## Context

企业模式下，会话历史存储采用"完全云端"模型：
- 会话元数据存储在本地 SQLite（用于侧边栏展示）
- 消息仅存储在 Moss Server，不持久化到本地
- 每次查看历史消息时，都需调用 `getSessionContext()` 从 Moss Server 拉取
- 离线状态下无法查看任何历史消息
- 如果 Moss Server 不可用，已查看过的会话也无法加载

## Objectives

1. 企业用户会话消息同时存储在本地 DB（Moss Server 已有留存，无需修改）
2. 企业用户新建会话保证生成的会话名称正确存储在本地会话表，确保历史列表展示正确
3. 企业用户点击具体历史会话时触发一次从 Moss Server 同步历史会话记录的操作（同步完成后校准本地会话记录）
4. 企业会话历史存储逻辑从完全云端，修改为本地存储 + 点击具体 session 时触发同步的模式

## Architecture

### 核心变更：从"完全云端"到"本地存储 + 点击同步"

**之前：**
```
点击历史会话 → 每次从 Moss Server API 拉取消息 → 显示
```

**之后：**
```
点击历史会话 → 先从本地 DB 读取（即时显示）→ 后台从 Moss Server 同步 → 更新本地 DB + 名称
```

### 1. 提取消息转换逻辑为可复用方法

**File:** `src/process/providers/RemoteConversationProvider.ts`

原 `getMessages()` 方法内联了约 270 行 Moss→TMessage 转换逻辑，提取为：

```typescript
private convertMossMessagesToTMessages(
  mossMessages: any[],
  conversationId: string,
  mossSessionId: string,
): { messages: TMessage[]; foundModel: string }
```

供 `getMessages()` 和新增的 `syncFromMossServer()` 复用。

### 2. 新增 `syncFromMossServer()` 方法

**File:** `src/process/providers/RemoteConversationProvider.ts`

```typescript
async syncFromMossServer(conversationId: string): Promise<{ syncedCount: number; nameUpdated: boolean }>
```

执行流程：
1. 从 DB 获取会话记录，提取 `mossSessionId`
2. 调用 `api.getSessionContext(mossSessionId)` 从 Moss Server 获取消息
3. 使用 `convertMossMessagesToTMessages()` 转换消息格式
4. 调用 `db.deleteConversationMessages()` 清除本地旧消息（避免重复）
5. 逐条 `db.insertMessage()` 写入转换后的消息
6. 若 `contextData.context.customTitle` 存在且与本地名称不同，更新 `conversation.name`
7. 更新 `extra.mossSessionUpdatedAt = Date.now()` 时间戳
8. 返回 `{ syncedCount, nameUpdated }`

### 3. 修改 `getMessages()` 为本地优先策略

**File:** `src/process/providers/RemoteConversationProvider.ts`

```typescript
async getMessages(conversationId: string, _page = 0, _pageSize = 10000): Promise<TMessage[]>
```

变更：
1. 先查询本地 DB：`db.getConversationMessages(conversationId, 0, 10000)`
2. 若本地有消息 → 直接返回（快速、支持离线）
3. 若本地无消息且 `mossSessionId` 存在 → 从 Moss Server 拉取并保存到本地，返回消息
4. 若 `mossSessionPending` 或无 `mossSessionId` → 返回空数组

### 4. 新增 IPC Bridge 端点

**File:** `src/common/ipcBridge.ts`

```typescript
syncMessages: bridge.buildProvider<
  IBridgeResponse<{ syncedCount: number; nameUpdated: boolean }>,
  { conversation_id: string }
>('conversation.sync-messages')
```

### 5. 注册同步处理器

**File:** `src/process/bridge/conversationBridge.ts`

```typescript
ipcBridge.conversation.syncMessages.provider(async ({ conversation_id }) => {
  const provider = getConversationProvider();
  if (provider.type !== 'remote' || !provider.syncFromMossServer) {
    return { success: true, data: { syncedCount: 0, nameUpdated: false } };
  }
  const result = await provider.syncFromMossServer(conversation_id);
  if (result.nameUpdated) {
    ipcBridge.database.conversationChanged.emit({ ... });
  }
  return { success: true, data: result };
});
```

### 6. 页面加载时触发同步（渲染进程）

**File:** `src/renderer/pages/conversation/index.tsx`

在会话数据通过 SWR 加载后，若为 `remote-agent` 类型且有 `mossSessionId`：

```typescript
useEffect(() => {
  if (!data || data.type !== 'remote-agent') return;
  const extra = data.extra as { mossSessionId?: string; mossSessionPending?: boolean };
  if (!extra?.mossSessionId || extra?.mossSessionPending) return;

  ipcBridge.conversation.syncMessages
    .invoke({ conversation_id: id! })
    .then((result) => {
      if (result.data?.nameUpdated) {
        emitter.emit('chat.history.refresh');
        void mutate();
      }
    })
    .catch(...);
}, [data?.id, data?.type]);
```

### 7. Provider 接口扩展

**File:** `src/process/providers/types.ts`

```typescript
export interface IConversationProvider {
  // ... existing methods

  /**
   * Sync messages from remote server to local DB (enterprise mode only)
   */
  syncFromMossServer?(conversationId: string): Promise<{ syncedCount: number; nameUpdated: boolean }>;
}
```

## Files Modified

| File | Change |
|------|--------|
| `src/process/providers/RemoteConversationProvider.ts` | 提取 `convertMossMessagesToTMessages()`，新增 `syncFromMossServer()`，修改 `getMessages()` 为本地优先 + Moss 不可用时仅日志，修改 `getConversation()` 直接返回本地记录不阻塞 |
| `src/process/providers/types.ts` | 新增 `syncFromMossServer?()` 到 `IConversationProvider` 接口 |
| `src/common/ipcBridge.ts` | 新增 `syncMessages` bridge 端点 |
| `src/process/bridge/conversationBridge.ts` | 注册 `syncMessages` 处理器 |
| `src/renderer/pages/conversation/index.tsx` | 页面加载时触发远程会话同步，同步完成后刷新消息列表 |
| `src/process/bridge/databaseBridge.ts` | 更新注释，反映本地优先策略 |
| `src/process/task/RemoteAgent.ts` | `handleStreamMessage()` 新增 `addOrUpdateMessage()` 持久化流式消息到本地 DB |

## Real-time Message Persistence

实时消息持久化通过主进程 + 渲染进程双路径完成：

**主进程路径（新增）：**
- `RemoteAgent.handleStreamMessage()` 在 IPC 转发后，调用 `addOrUpdateMessage()` 将消息写入本地 DB
- 覆盖消息类型：`content`/`user_content`/`acp_tool_call`/`error`
- 新增 `streamMsgToTMessage()` 方法将 `IResponseMessage` 转换为 `TMessage` 格式

**渲染进程路径（已有）：**
- `RemoteAgent` 通过 IPC `responseStream` 发送流式消息
- `AcpSendBox`（remote-agent 复用 AcpChat）接收消息并调用 `addOrUpdateMessageList`
- `useAddOrUpdateMessage` hook 批量通过 `ipcBridge.conversation.addMessage` 保存到本地 DB
- 与 AcpAgent/OpenClawAgent 的持久化管线一致

## Bugs Fixed During Implementation

### Bug 1: 点击历史会话白屏

**现象：** 点击企业历史会话后页面白屏，无内容展示。

**根因：** `RemoteConversationProvider.getConversation()` 在返回本地 DB 记录前，同步调用 Moss Server 的 `getSession()` + `resumeSession()` API 获取 `wsUrl`。这些网络请求阻塞了 SWR 数据加载，Moss Server 不可用或响应慢时，页面一直处于 `isLoading` 状态，导致白屏。

**修复：** `getConversation()` 改为直接返回本地 DB 记录，不再阻塞等待 Moss Server API。Moss Server 连接（resume/attach）延迟到用户实际发送消息时由 `RemoteAgent.initAgent()` 处理。

**File:** `src/process/providers/RemoteConversationProvider.ts` — `getConversation()` 方法

### Bug 2: 同步完成后历史消息不显示

**现象：** 点击历史会话后不再白屏，但会话历史消息列表为空。

**根因：** 两个问题叠加导致：
1. `RemoteAgent.handleStreamMessage()` 仅通过 IPC `responseStream` 转发消息到渲染进程，**未调用 `addOrUpdateMessage()` 将消息持久化到本地 DB**（对比 AcpAgent/OpenClawAgent 均有持久化调用）。因此实时消息只会存在于渲染进程内存中，刷新或切回后丢失。
2. `syncFromMossServer()` 完成后未触发消息列表刷新，本地 DB 已更新但 UI 未重新读取。

**修复：**
1. 在 `RemoteAgent.handleStreamMessage()` 中新增 `addOrUpdateMessage()` 调用，将 `content`/`user_content`/`acp_tool_call`/`error` 类型的流式消息实时写入本地 DB
2. 在 `conversation/index.tsx` 的 sync 回调中，当 `syncedCount > 0` 或 `nameUpdated` 时触发 `emitter.emit('chat.history.refresh')` + `mutate()` 刷新侧边栏和消息列表

**Files:**
- `src/process/task/RemoteAgent.ts` — `handleStreamMessage()` + 新增 `streamMsgToTMessage()` 转换方法
- `src/renderer/pages/conversation/index.tsx` — sync 回调中触发刷新

### Bug 3: Moss Server 不可用时 getMessages() 日志过于激进

**现象：** Moss Server 不可用时，`getMessages()` 的 `mainError` 日志大量输出，干扰排查。

**修复：** `getMessages()` 中 Moss Server API 调用用独立 try-catch 包裹，失败时仅用 `mainLog` 记录（而非 `mainError`），返回空数组不抛出异常。

**File:** `src/process/providers/RemoteConversationProvider.ts` — `getMessages()` 方法

## Verification

1. 新建企业会话 → 验证侧边栏历史显示正确名称
2. 发送消息 → 验证消息持久化到本地 DB
3. 关闭并重开应用 → 验证历史列表显示正确会话名称
4. 点击历史会话 → 验证先从本地 DB 加载消息，然后后台从 Moss Server 同步
5. 同步完成后验证本地消息与 Moss Server 消息一致，名称如有变更则更新
6. 离线测试：断开 Moss Server → 验证已查看过的会话仍可从本地 DB 加载消息
7. 验证非企业模式（ACP/OpenClaw）会话不受影响
