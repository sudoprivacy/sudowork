---
name: browser
description: "AI-native browser. Explore websites, discover page structure, take screenshots, and automate interactions."
---

# Browser

## Opening a URL in the right-side panel

When the user asks to open / preview / show a URL in the right-side browser
panel (e.g. "在右侧浏览器打开 https://example.com", "preview localhost:8769",
"看一下我刚启动的 dashboard"), run this immediately:

```bash
browser page_goto --url <URL>
```

The right-side BrowserPanel auto-syncs to the URL on this command — no extra
step needed. Do NOT first call `read_file`, `ListMcpResources`, or `ToolSearch`
to "explore what's available"; that just wastes turns. The dispatcher above is
the canonical entry point and is the only thing you need for the open-URL
flow.

Equivalent forms also auto-sync the right panel:

- `aidb tab_new --url=<URL>` (legacy dispatcher alias)
- `python -m ai_dev_browser.tools.page_goto --url "<URL>"` (raw Python)
- MCP: `sudowork-browser.browser_open(url=<URL>)` (when reachable as an MCP tool)

## CLI reference

```bash
browser --list
```

Every CLI tool has an identical Python function in `ai_dev_browser.core` — explore interactively with CLI, then script with the same functions:

```python
from ai_dev_browser.core import page_goto, click_by_text, page_screenshot
```
