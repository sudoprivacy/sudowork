# SudoClaw User Guide

## What is SudoClaw?

SudoClaw is Sudowork's built-in AI agent framework powered by OpenClaw. It provides an integrated assistant experience with multi-model support, workspace management, and automated cost controls.

## Enabling SudoClaw

SudoClaw is automatically installed and started when you launch Sudowork. You can check its status in **Settings > Copilot**.

### Manual Installation

If SudoClaw is not installed, navigate to **Settings > About** and click "Install SudoClaw".

## Configuration

SudoClaw stores its configuration at `~/.nexus/sudoclaw/sudoclaw.json`. You can edit settings through the UI or by modifying this file directly.

### Model Configuration

Configure AI model providers in the Copilot settings:

```json
{
  "models": {
    "providers": {
      "sudorouter": {
        "baseUrl": "https://hk.sudorouter.ai",
        "apiKey": "your-api-key",
        "models": [
          { "id": "gemini-3-flash-preview", "name": "Gemini 3 Flash" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "sudorouter/gemini-3-flash-preview" },
      "workspace": "~/.nexus/sudoclaw/workspace"
    }
  }
}
```

### Gateway Settings

The local gateway runs on port `17863` by default. This is configurable:

```json
{
  "gateway": {
    "port": 17863,
    "mode": "local",
    "auth": { "mode": "none" }
  }
}
```

## Cost Controls

SudoClaw enforces automatic rate limits and budget controls to prevent runaway usage:

### Tick Rate Limits

| Limit | Value | Description |
|-------|-------|-------------|
| Hourly | 30 ticks/hour | Maximum API calls per hour |
| Daily | 200 ticks/day | Maximum API calls per day |
| Min sleep | 1 minute | Minimum interval between ticks |
| Default sleep | 5 minutes | Default interval between ticks |

### Budget Enforcement

- **80% Warning**: When 160 of 200 daily ticks are used, a warning notification appears
- **100% Hard-Stop**: When all 200 daily ticks are exhausted, all API calls are paused until midnight

Budget counters reset daily at midnight (local time) and hourly at the top of each hour.

### Adaptive Throttling

As you approach limits, SudoClaw automatically increases the sleep interval between ticks:

| Budget Usage | Sleep Multiplier |
|-------------|-----------------|
| 0–79% | 1x (default 5 min) |
| 80–89% | 2x (10 min) |
| 90–99% | 3x (15 min) |
| 100% | Paused until reset |

## Edge Case Handling

### App Sleep/Resume Detection

When your laptop goes to sleep or the app is suspended:

1. SudoClaw monitors "ping gaps" — if no heartbeat is received for 60+ seconds, it detects a suspension
2. Upon wake, SudoClaw automatically force-reconnects to the gateway
3. Active sessions are preserved and resumed

No user action is required. You may see a brief "Reconnecting..." status after waking your laptop.

### Network Loss

When the API or gateway becomes unreachable:

1. **Graceful degradation**: SudoClaw enters "degraded" mode and queues retry attempts
2. **Exponential backoff**: Retries start at 1 second and back off to a maximum of 2 minutes
3. **Jitter**: Random variation prevents multiple clients from retrying simultaneously
4. **Health probing**: Background probes check gateway health every 10 seconds
5. **Auto-recovery**: When connectivity returns, SudoClaw automatically reconnects

Error types are classified for appropriate retry behavior:

| Error Type | Behavior |
|-----------|----------|
| Network transient (ECONNREFUSED, timeout) | Retry with backoff |
| Rate limited (429) | Retry after server-specified delay |
| Model error (overloaded, 503) | Retry with 30s delay |
| Auth error (401, 403) | No retry — check API key |
| Unknown | Retry with backoff |

### Model Errors

If the AI model returns an error:
- **Overloaded/Unavailable (503)**: Automatically retried after 30 seconds
- **Rate Limited (429)**: Respects the server's retry-after header
- **Authentication (401/403)**: Stops retrying — check your API key in Settings

## Memory Log Lifecycle

SudoClaw manages memory logs (conversation history, agent traces) automatically:

### Auto-Archival

- Logs older than **3 months** are automatically moved to the archive directory
- Archived logs are **compressed** with gzip to save disk space
- The archival process runs once daily

### Size Limits

| Metric | Limit | Action |
|--------|-------|--------|
| Active logs directory | 500 MB | Warning logged |
| Single log file | 50 MB | Warning logged |

### Manual Management

You can trigger a manual archive cycle through the UI or view current statistics:

- **Active log files**: Count and total size of current logs
- **Archived files**: Count and total size of compressed archives
- **Last archive**: When the last archival ran and how many files were processed

### Log Storage Locations

| Type | Path |
|------|------|
| Active logs | `~/.nexus/logs/` |
| Archived logs | `~/.nexus/logs/archive/` |
| Sudoclaw config | `~/.nexus/sudoclaw/sudoclaw.json` |
| Workspace data | `~/.nexus/sudoclaw/workspace/` |

## Troubleshooting

### SudoClaw won't start

1. Check if the gateway is running: **Settings > Copilot > Test Connection**
2. Try restarting the gateway: **Settings > Copilot > Restart Gateway**
3. If problems persist, try reinstalling: **Settings > About > Reinstall SudoClaw**

### "Budget exceeded" message

Your daily tick limit has been reached. Options:
- Wait until midnight for the counter to reset
- Check your usage in the Copilot settings panel

### "Connection lost" or "Reconnecting..."

This usually resolves automatically within a few seconds. If it persists:
1. Check your internet connection
2. Verify your API key is valid
3. Try restarting the gateway

### Slow responses

If responses are slower than usual:
- You may be approaching your hourly rate limit (adaptive throttling increases sleep intervals)
- The AI model may be experiencing high load (check model status)
- Try switching to a different model in Settings
