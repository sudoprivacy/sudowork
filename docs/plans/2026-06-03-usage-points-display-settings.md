# Usage Points Display Settings

## Data Sources

- Per-turn token usage comes from `IMessageText.content.tokenUsage` and stays persisted with chat messages.
- User center dashboard data comes from `/api/v1/user/dashboard`; `usage_today.tokens` is the primary source for today's points, and `usage_today.cost_points` is only a fallback when tokens are absent.
- Weekly model and points charts share one `/api/v1/user/model-usage-stats` request. Model usage uses `total_tokens` directly, and points usage converts the same `total_tokens` values.

## Config Key

- `system.showTokenUsageBadges` stores whether token and points badges below assistant turns are visible.
- The default is `false` when the key is missing.
- The setting is exposed through `ipcBridge.systemSettings` so settings changes can be broadcast to active renderer views.

## UI Behavior

- Settings -> System adds a switch for showing per-turn token and points usage.
- Turning the switch off hides only the turn action badge UI. It does not modify message `tokenUsage`, telemetry, or persistence.
- User center today's consumed points are calculated from `usage_today.tokens / 500` when tokens exist.
- User center adds a daily points chart above the model usage chart, using the same selected date range and the same fetched model usage data.

## Test Scope

- Unit test the shared token-to-points helper and fallback behavior.
- Run TypeScript type checking for IPC, renderer props, and chart data changes.
- Run lint after edits and run the relevant Vitest unit test plus the full test suite before commit.
