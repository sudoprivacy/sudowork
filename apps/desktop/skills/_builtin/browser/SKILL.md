---
name: browser
description: 'Explore websites, take screenshots, and automate interactions. On Windows, first call ToolSearch with query "PowerShell", then invoke the returned PowerShell tool for browser commands and skill lookup. If the host has no ToolSearch, use its native Windows shell tool. On macOS/Linux use your shell execution tool.'
---

# Browser

On Windows, call `ToolSearch` with `{"query":"PowerShell"}` to load the
**PowerShell tool**, then call that tool with `{"command":"browser --list"}`.
PowerShell is a separate tool: passing `powershell ...` to the Bash tool still
requires Bash, which may be unavailable. Use PowerShell for file lookup too.
If PowerShell is already loaded, call it directly.

For a host without `ToolSearch`, use its native execution tool configured for
Windows PowerShell to run `browser --list` and subsequent browser commands.

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

## Choose the browser and its visibility

Use the tool catalog and launch help to check the host's actual capabilities.
Choose headless or headful from the task, user preference and site compatibility;
always pass that choice explicitly when the shared browser requires it.
Standalone/CDP is suitable for isolated local automation. Extension connects to
a configured Chrome profile and is useful for existing logins and compatibility.
In a cloud workspace, both transports operate the cloud Chrome. A cloud profile
does not inherit the user's local cookies or device identity. Never silently
switch transport, profile or machine after a failure.

The shared BrowserPanel and Open viewer show the same browser and profile as
your tools. Headless still supports a page view. A headful cloud browser can
also expose its complete Chrome window through the authenticated viewer.
Connecting to an already running personal Chrome cannot change its launch mode.

## Work with the user in the same session

When login, verification or another user action is needed, explain what is
needed through your agent's normal conversation or native question/options.
Use the existing conversation interrupt and normal chat or native answers.
Do not invent separate takeover/return buttons or a custom question interface.
For example: "Please sign in using the shared browser and tell me when ready."
The shared remote page uses the same interrupt when the user starts interacting;
its initiating gesture is discarded until the task stops and a fresh frame arrives.
For native Chrome outside the panel, ask the user to interrupt in the conversation
before editing; arbitrary OS input is not automatically detected.

The host acknowledges the tool/input barrier and transfers browser ownership.
Conversation intent must pass this host transition; a prompt cannot bypass it.
While human control
is held, wait; do not use another tool, shell, connection or browser to continue.
The user may sign in directly on the VM's isolated persistent profile. Do not
ask them to send passwords, cookies or verification codes in the conversation.

A fresh user message or supported native answer continues through the existing
conversation after the host drains input and observes the browser. It does not
create a second synthetic model turn. Read what the user said, freshly observe
the current page and control epochs, and continue from that actual state.
Discard old coordinates and unfinished input plans. Reconnecting, closing the
viewer and idle timeouts never return ownership by themselves.
