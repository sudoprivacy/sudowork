---
name: browser
description: "AI-native browser. Explore websites, discover page structure, take screenshots, and automate interactions."
---

# Browser

## Quick Start

```bash
# Run any tool (auto-bootstraps on first use, only needs curl)
~/sudowork/vendor/ai-dev-browser/adb <tool> [args]

# List all available tools
~/sudowork/vendor/ai-dev-browser/adb --list

# Tool-specific help
~/sudowork/vendor/ai-dev-browser/adb browser-start --help
```

Tool names accept both hyphens (`page-find`) and underscores (`page_find`).

## Interact with the host app

No extra flags needed — commands target the host app by default:

```bash
adb take_screenshot
adb page_info
```

## Browse the web

Start a standalone browser first, then use `--port` to target it:

```bash
# 1. Start browser (once per session)
adb browser-start
# → {"port": 9350, ...}

# 2. Navigate (--port points to the standalone browser)
adb page_goto --port 9350 --url https://example.com
# → {"url": "...", "target_id": "ABC123", ...}

# 3. Subsequent commands reuse the target_id
adb click_by_text --port 9350 --target ABC123 --text "Login"
adb page_info --port 9350 --target ABC123
```

## `--target` (optional)

Use `--target` for multi-tab scenarios. Omit it to use the active tab.

| Value | Behavior |
|-------|----------|
| `tab` | Create a new tab, returns its `target_id` |
| `<target_id>` | Reuse an existing tab by its ID |
