---
name: browser
description: 'Explore websites, take screenshots, and automate interactions. Windows: first call ToolSearch with query "PowerShell", then invoke the returned PowerShell tool for browser commands and skill lookup. macOS/Linux: use your shell execution tool.'
---

# Browser

On Windows, call `ToolSearch` with `{"query":"PowerShell"}` to load the
**PowerShell tool**, then call that tool with `{"command":"browser --list"}`.
PowerShell is a separate tool: passing `powershell ...` to the Bash tool still
requires Bash, which may be unavailable. Use PowerShell for file lookup too.
If PowerShell is already loaded, call it directly.

On macOS/Linux, run the following with your shell execution tool:

```text
browser --list
```

Use the listed tool names and `browser <tool> --help` for their parameters.
The catalog comes from the configured browser backend. Keep using this entry
point when scripting so discovery, invocation and result delivery stay aligned.

```text
browser browser_start
browser page_goto --help
```

Use the port returned by `browser_start` for subsequent calls. Browser actions
return JSON and a process exit code; read failure hints before deciding what to
do next. A failed action may already have had effects, so inspect its result
before repeating it. For visual inspection, capture with `page_screenshot` and
open the returned image path with your available image tool.
