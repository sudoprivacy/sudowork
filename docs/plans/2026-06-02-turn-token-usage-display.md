# Turn Token Usage Display

## Goal

After an ACP-based agent such as Sudo Code finishes a turn, show that turn's token usage below the assistant response in the chat transcript.

## Source Of Truth

Sudo Code returns per-turn token data through ACP `PromptResponse.result.usage`. The existing `AcpConnection` already extracts this as `AcpPromptResponseUsage` and sends it to `AcpAgent.onPromptUsage`.

This should be treated differently from `usage_update`:

- `PromptResponse.result.usage` is the per-turn usage to display below the response.
- `usage_update.used/size` is current context window utilization and remains the send-box context indicator source.

## Data Model

Assistant text messages carry optional usage metadata:

```ts
interface TurnTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number;
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
  thoughtTokens?: number | null;
  contextWindowTokens?: number | null;
  estimatedSessionTokens?: number | null;
}
```

The metadata lives on `IMessageText.content.tokenUsage` so it is persisted with the message and restored with the conversation history.

## Flow

1. `AcpConnection` receives the prompt response and extracts `result.usage`.
2. `AcpAgent.handlePromptUsage()` updates telemetry as before.
3. `AcpAgent` flushes any buffered assistant text and emits a content patch with the same `msg_id` as the latest assistant text message.
4. `transformMessage()` preserves `tokenUsage` from rich content payloads.
5. Message merge logic appends text chunks while shallow-merging metadata, so the usage patch updates the existing assistant message instead of creating a new bubble.
6. `MessageList` carries the latest assistant text usage into the turn action row.
7. `TurnActions` renders a compact muted usage badge and exposes detail fields in a tooltip.

## UI

The badge appears in the existing action row below the assistant answer, next to copy/share actions:

```text
12.4K tokens · in 10.8K / out 1.6K
```

When available, reasoning and cache details are shown in the tooltip to keep the transcript quiet. Context window usage is intentionally not shown here because the send box already has the context usage indicator.

## Fallback Behavior

If an agent does not provide per-turn usage, no token badge is shown. The UI does not estimate token usage from text length.
