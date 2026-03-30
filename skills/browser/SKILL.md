---
name: browser
description: "AI-native browser. Explore websites, discover page structure, take screenshots, and automate interactions."
---

# Browser

Each tool is invoked as `python3 -m ai_dev_browser.tools.<tool_name>`. Run with `--help` for usage.

## Available tools

**Browser lifecycle:** browser_start, browser_stop, browser_list
**Navigation:** page_goto, page_reload, page_wait, page_wait_url, tab_new, tab_close, tab_list, tab_switch
**Interaction:** click_by_text, click_by_ref, type_by_text, type_by_ref, mouse_click, mouse_move, mouse_drag, scroll, focus_by_ref
**Observation:** page_screenshot, page_info, page_html, find, element_wait, js_exec
**Window:** window_focus, window_resize, window_state
**Data:** cookies_list, cookies_save, cookies_load, storage_get, storage_set, download_file, download_path
**Utility:** cdp_send, cf_verify, login_interactive, page_handle_dialog

## Headless by default

The browser starts in **headless** mode by default. This is faster and works without a display.

Switch to headful (`browser_start --no-headless`) only when:
- You need to visually debug a failing interaction
- The user explicitly asks to see the browser
- A site blocks headless browsers

When unsure, stay headless. Ask the user before switching to headful.
