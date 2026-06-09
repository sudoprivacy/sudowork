# Cron Agent Response Channel Synchronization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable agent responses from cron jobs to be automatically sent back to external channels (WeChat, Lark, etc.) by extracting and reusing response routing logic.

**Architecture:** Create a shared `ChannelResponseRouter` component that can be used by both `conversationBridge` (for frontend messages) and `CronService` (for scheduled tasks).

**Tech Stack:** TypeScript, Node.js, EventBus, Electron (Main process)

---

### Task 1: Create ChannelResponseRouter Component

**Files:**
- Create: `src/channels/agent/ChannelResponseRouter.ts`

**Step 1: Write the implementation**
Extract the logic from `conversationBridge.ts`.

```typescript
import { channelEventBus } from './ChannelEventBus';
import { getChannelManager } from '../core/ChannelManager';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import type { TChatConversation } from '@/common/storage';

/** Channel source types that need response routing */
export const CHANNEL_SOURCE_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']);

/**
 * Sets up channel response routing for a conversation.
 * Returns a cleanup function.
 */
export function setupChannelResponseRouting(conversation: TChatConversation): () => void {
  const conversation_id = conversation.id;
  const channelSource = conversation.source;
  const channelChatId = conversation.channelChatId;

  if (!channelSource || !CHANNEL_SOURCE_TYPES.has(channelSource) || !channelChatId) {
    return () => {};
  }

  mainLog('ChannelResponseRouter', `Setting up routing for ${channelSource}, chatId=${channelChatId}`);

  const isWeChat = channelSource === 'wechat';
  let accumulatedText = '';
  const pendingFiles: Array<{ type: 'image' | 'file'; url: string; fileName?: string }> = [];

  const cleanup = channelEventBus.onAgentMessage((event) => {
    if (event.conversation_id !== conversation_id) return;

    if (event.type === 'content' || event.type === 'file_send') {
      if (isWeChat) {
        if (event.type === 'content' && typeof event.data === 'string') {
          accumulatedText += event.data;
        } else if (event.type === 'file_send') {
          const { filePath, fileName, fileType } = event.data as any;
          if (fileType === 'image' && filePath) {
            pendingFiles.push({ type: 'image', url: filePath });
          } else if (filePath && fileName) {
            pendingFiles.push({ type: 'file', url: filePath, fileName });
          }
        }
      } else {
        void (async () => {
          try {
            const plugin = getChannelManager().getPluginManager()?.getAllPlugins().find(p => p.type === channelSource);
            if (!plugin) return;

            if (event.type === 'file_send') {
              const { filePath, fileName, fileType } = event.data as any;
              if (fileType === 'image' && filePath) {
                await plugin.sendMessage(channelChatId, { type: 'image', imageUrl: filePath });
              } else if (filePath && fileName) {
                await plugin.sendMessage(channelChatId, { type: 'file', fileUrl: filePath, fileName });
              }
            } else if (event.type === 'content' && typeof event.data === 'string') {
              await plugin.sendMessage(channelChatId, { type: 'text', text: event.data, parseMode: 'HTML' });
            }
          } catch (err) {
            mainWarn('ChannelResponseRouter', 'Failed to route message:', err);
          }
        })();
      }
    }

    if (event.type === 'finish') {
      if (isWeChat) {
        void (async () => {
          try {
            const plugin = getChannelManager().getPluginManager()?.getAllPlugins().find(p => p.type === channelSource);
            if (!plugin) return;
            if (accumulatedText.trim()) {
              await plugin.sendMessage(channelChatId, { type: 'text', text: accumulatedText.trim(), parseMode: 'HTML' });
            }
            for (const file of pendingFiles) {
              await plugin.sendMessage(channelChatId, file.type === 'image' ? { type: 'image', imageUrl: file.url } : { type: 'file', fileUrl: file.url, fileName: file.fileName });
            }
          } catch (err) {
            mainWarn('ChannelResponseRouter', 'Failed to route WeChat content:', err);
          }
        })();
      }
      cleanup();
    }
  });

  return cleanup;
}
```

**Step 2: Commit**

```bash
git add src/channels/agent/ChannelResponseRouter.ts
git commit -m "feat: add ChannelResponseRouter to handle agent-to-channel message routing"
```

### Task 2: Refactor conversationBridge to use ChannelResponseRouter

**Files:**
- Modify: `src/process/bridge/conversationBridge.ts`

**Step 1: Update imports and replace inline logic**

```typescript
// Replace inline logic in sendMessage with:
const cleanup = setupChannelResponseRouting(conversation);
try {
  await task.sendMessage(payload);
} finally {
  // Listener self-cleans on 'finish', but we keep the cleanup reference
}
```

**Step 2: Commit**

```bash
git add src/process/bridge/conversationBridge.ts
git commit -m "refactor: use ChannelResponseRouter in conversationBridge"
```

### Task 3: Enable Response Syncing in CronService

**Files:**
- Modify: `src/process/services/cron/CronService.ts`

**Step 1: Update imports and modify executeJob**
Before `task.sendMessage`, fetch conversation and setup routing.

```typescript
// Inside executeJob, after task is built:
const convResult = getDatabase().getConversation(activeConversationId);
if (convResult.success && convResult.data) {
  setupChannelResponseRouting(convResult.data);
}
```

**Step 2: Commit**

```bash
git add src/process/services/cron/CronService.ts
git commit -m "feat: sync cron agent responses back to channels"
```

### Task 4: Verification

**Step 1: Manual Verification**
1. Start the app.
2. Ensure a WeChat channel is active.
3. Create a cron job bound to a WeChat conversation.
4. Wait for it to trigger or click "Run Now".
5. Verify Agent response appears in WeChat.

**Step 2: Commit (if any fixes needed)**
```bash
git commit -m "fix: address issues found during verification"
```
