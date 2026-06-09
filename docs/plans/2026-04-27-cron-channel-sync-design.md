# Design: Sync Cron Agent Responses to External Channels

## Context
Currently, agent responses triggered by cron jobs are only visible within the local application. When a cron job is bound to a conversation sourced from external channels (e.g., WeChat, Lark, Telegram), these responses are not synced back to the channel. This design aims to reuse the response routing logic from `conversationBridge` to enable cross-channel synchronization for cron-triggered agent messages.

## Objectives
- Extract channel response routing logic into a reusable component.
- Enable `CronService` to use this component to sync agent responses to external channels.
- Maintain consistent behavior across all channels (special handling for WeChat text accumulation).

## Architecture

### 1. New Component: `ChannelResponseRouter`
**Path:** `src/channels/agent/ChannelResponseRouter.ts`

This module will contain the logic previously embedded in `conversationBridge.ts`.

```typescript
export const CHANNEL_SOURCE_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']);

/**
 * Sets up a listener on channelEventBus to route agent responses back to the original channel.
 * Handles different channel capabilities (e.g., WeChat's lack of message edit support).
 */
export function setupChannelResponseRouting(conversation: TChatConversation): () => void {
  // Logic extracted from conversationBridge.ts
  // 1. Check if source is in CHANNEL_SOURCE_TYPES
  // 2. Subscribe to channelEventBus.onAgentMessage
  // 3. Filter by conversation_id
  // 4. Route 'content', 'file_send', and 'finish' (for WeChat) events
  // 5. Return cleanup function
}
```

### 2. Integration Points

#### `conversationBridge.ts`
- Remove the inline routing logic.
- Call `setupChannelResponseRouting(conversation)` before `task.sendMessage()`.

#### `CronService.ts`
- In `executeJob()`, after identifying/creating the `activeConversationId`, fetch the conversation object.
- Call `setupChannelResponseRouting(conversation)` before `task.sendMessage()`.

## Data Flow
1. **Trigger**: Cron job fires in `CronService`.
2. **Setup**: `CronService` calls `setupChannelResponseRouting`.
3. **Execution**: `task.sendMessage` starts agent processing.
4. **Event**: Agent emits content via `channelEventBus`.
5. **Route**: `ChannelResponseRouter` catches the event and calls the corresponding plugin's `sendMessage`.
6. **Cleanup**: On `finish` event or manual call, the listener is removed.

## Error Handling
- Routing failures (e.g., plugin not found, API error) should be logged but not crash the cron job execution.
- Ensure the listener is always cleaned up to prevent memory leaks.

## Testing Plan
- **Unit Test**: Mock `channelEventBus` and verify `ChannelResponseRouter` calls the correct plugin methods.
- **Manual Test (WeChat)**: Create a cron job bound to a WeChat conversation, trigger it, and verify the response is received in WeChat after completion.
- **Manual Test (Lark/Telegram)**: Verify streaming updates if supported by the channel.
