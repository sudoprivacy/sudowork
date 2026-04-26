# Sudo Code (scode) E2E Test Coverage Plan

## Overview

This document tracks the end-to-end test coverage for the Sudo Code agent
running through the sudowork UI via ACP (Agent Control Protocol). Tests
live in `tests/e2e/cases/scode-*.yaml`.

## Feature Inventory

Features are grouped by category. Coverage status:
- **Covered** — has an e2e test case that exercises it
- **Gap** — not yet tested, should be
- **N/A** — not applicable in ACP/UI mode (feature gap or design constraint)

---

### 1. Core Conversation

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| Single-turn prompt | Covered | scode-basic-conversation | |
| Multi-turn context | Covered | scode-basic-conversation | Follow-up references prior turn |
| Streaming response | Covered | all cases | Implicit in every interaction |
| Graceful cancel mid-execution | Covered | scode-graceful-cancel | Stop during sleep, verify context preserved |
| Agent switching (Sudoclaw ↔ scode) | Covered | scode-agent-switch | 3 sessions across 2 agents |

### 2. Tool Usage — File Operations

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| read_file | Covered | scode-file-read-and-analysis | Reads package.json |
| write_file | Covered | scode-code-and-run | Writes Python script |
| edit_file | Covered | scode-edit-file | Write → edit text → read back verified |
| glob_search | Covered | scode-file-read-and-analysis | Finds .yaml files |
| grep_search | Covered | scode-file-read-and-analysis | Searches for AcpConnection |

### 3. Tool Usage — Execution

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| bash | Covered | scode-code-and-run, scode-graceful-cancel | Run script, echo, sleep |
| REPL (Python/JS subprocess) | Gap | — | Different from bash — persistent REPL session |
| PowerShell | N/A | — | Windows only |
| NotebookEdit (Jupyter) | Gap | — | Requires .ipynb file setup |

### 4. Tool Usage — Search & Web

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| WebSearch | Covered | scode-web-search | Searches current info, verifies results |
| WebFetch (URL → extract) | Covered | scode-web-fetch | Fetches httpbin.org/json, extracts keys |

### 5. Tool Usage — Code Intelligence

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| LSP goToDefinition | Gap | — | Requires language server setup |
| LSP findReferences | Gap | — | |
| LSP hover | Gap | — | |
| LSP documentSymbol | Gap | — | |
| ToolSearch | Gap | — | Search for tools by keyword |

### 6. Tool Usage — Planning & Structured

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| EnterPlanMode / ExitPlanMode | Covered | scode-planning-mode, scode-planning-and-iteration | Plan → implement → test → iterate |
| TodoWrite | Gap | — | Task list management |
| AskUserQuestion | Gap | — | Scode prompts user for clarification |
| StructuredOutput | Gap | — | Return structured data |
| Sleep | Gap | — | Low priority |

### 7. Tool Usage — Background & Parallel

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| Agent (sub-agents) | Gap | — | Launch parallel sub-agents |
| TaskCreate / TaskGet / TaskList | Gap | — | Background task management |
| Workers (boot, trust, prompt) | Gap | — | Worker lifecycle |
| Teams (parallel sub-agents) | Gap | — | Team coordination |
| CronCreate / CronDelete | Gap | — | Scheduled recurring tasks |

### 8. Git Workflow

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| /commit (generate + create) | Covered | scode-git-workflow | Init repo → write file → commit → verify log |
| /pr (draft/create PR) | Gap | — | High priority — core workflow |
| /diff (show changes) | Gap | — | |
| /issue (create GitHub issue) | Gap | — | |
| /review (code review) | Gap | — | |

### 9. Session Management

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| Session auto-save | Covered | scode-session-management | Implicit — session persists across turns |
| /resume (load saved session) | Gap | — | |
| /session list / switch / fork | Gap | — | |
| /export (session to markdown) | Gap | — | |
| /compact (compress history) | Gap | — | |

### 10. Configuration & Discovery

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| /model (switch model) | Covered | scode-slash-commands | Show current + switch verified |
| /permissions (switch mode) | Gap | — | read-only vs workspace-write vs danger |
| /auth (switch auth mode) | N/A | — | Managed by sudowork credential injection |
| /skills (list/invoke) | Gap | — | |
| /agents (list) | Gap | — | |
| /mcp (list/show servers) | Gap | — | |
| /plugins (manage) | Gap | — | |
| /config (inspect) | Gap | — | |

### 11. Diagnostics

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| /doctor | Covered | scode-slash-commands | Via slash command in ACP |
| /status | Covered | scode-slash-commands | Model, permissions, usage |
| /sandbox | Gap | — | Isolation status |
| /cost (token usage) | Covered | scode-slash-commands | Token counts |

### 12. Auth

| Feature | Status | Test Case | Notes |
|---------|--------|-----------|-------|
| Subscription auth (CC OAuth) | Covered | all cases | Implicit — uses injected CLAUDE_CODE_OAUTH_TOKEN |
| Proxy auth (sudorouter) | Gap | — | Via ANTHROPIC_API_KEY injection |
| API key auth | Gap | — | |
| scode login (CLI) | Covered | manual e2e | Tested outside UI |
| scode logout (CLI) | Covered | manual e2e | Tested outside UI |

---

## Coverage Summary

| Category | Covered | Gap | N/A | Total |
|----------|---------|-----|-----|-------|
| Core Conversation | 5 | 0 | 0 | 5 |
| File Operations | 5 | 0 | 0 | 5 |
| Execution | 1 | 2 | 1 | 4 |
| Search & Web | 2 | 0 | 0 | 2 |
| Code Intelligence | 0 | 5 | 0 | 5 |
| Planning & Structured | 1 | 4 | 0 | 5 |
| Background & Parallel | 0 | 5 | 0 | 5 |
| Git Workflow | 1 | 4 | 0 | 5 |
| Session Management | 1 | 4 | 0 | 5 |
| Config & Discovery | 1 | 5 | 1 | 7 |
| Diagnostics | 3 | 1 | 0 | 4 |
| Auth | 2 | 2 | 0 | 4 |
| **Total** | **22** | **32** | **2** | **56** |

**Current coverage: 22/54 testable features = ~41%**

Additionally, `scode-multi-tool-chain` covers the read → analyze → write → verify
cross-tool integration pattern that exercises multiple features in a single flow.

## Priority for Next Round

### P0 — Core Differentiators
1. Git workflow: `/commit` + `/pr` (scode's primary value proposition)
2. Planning mode: `/plan` then execute
3. edit_file: explicit text replacement verification

### P1 — High-Value Tools
4. WebFetch: fetch URL and extract info
5. Sub-agents: launch Agent tool for parallel work
6. Background tasks: TaskCreate + TaskGet lifecycle

### P2 — Session & Config
7. Session resume: send prompt → close → resume → verify context
8. Permission modes: read-only restrictions
9. /doctor diagnostics through UI

### P3 — Advanced
10. LSP code navigation
11. REPL persistent sessions
12. Cron scheduling
13. MCP/Skills/Plugins integration
