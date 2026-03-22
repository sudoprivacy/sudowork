# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Package Manager**: Use `bun` for all operations.

**Prerequisites**: Node.js >= 22, Python 3.11+ (for native modules).

```bash
# Setup
bun install                          # Install dependencies
bun run postinstall                  # Rebuild native modules (better-sqlite3)

# Development
bun run start                        # Start dev environment (Electron + Vite)
bun run webui                        # Start WebUI server only
bun run webui:remote                 # WebUI with remote access enabled

# Code Quality (run before commit)
bun run lint                         # ESLint check
bun run lint:fix                     # Auto-fix ESLint issues
bun run format                       # Prettier format
bun run format:check                 # Check formatting without fixing
bun run type:check                   # TypeScript type check

# Testing
bun run test                         # Run all tests (Vitest)
bun run test:watch                   # Watch mode
bun run test:coverage                # Coverage report
bun run test:integration             # Integration tests only
bun run test:e2e                     # E2E tests (Playwright)
```

**Pre-commit hooks**: Managed by `pre-commit`/`prek`. Install with `prek install`. Runs TypeScript, ESLint, Prettier, and i18n checks on staged files.

## Architecture Overview

**Three-process Electron architecture** with strict separation:

```
src/
├── process/          # Main process - Node.js APIs, database, IPC
├── renderer/         # Renderer process - React 19 UI, browser APIs only
├── worker/           # Worker processes - Background AI agent tasks
├── webserver/        # WebUI server - Express + WebSocket
├── agent/            # AI Agent engines (Gemini, ACP, Codex, OpenClaw)
├── channels/         # Remote access (Telegram, Lark, DingTalk plugins)
├── extensions/       # Extension system (RFC-001)
└── common/           # Shared utilities, adapters, types
```

**Path aliases**: `@/*`, `@process/*`, `@renderer/*`, `@worker/*`, `@mcp/*`

**Cross-process communication**: All IPC goes through `src/preload.ts` bridge. Main process (`src/process/`) cannot use DOM APIs; renderer (`src/renderer/`) cannot use Node.js APIs.

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Database** | `src/process/database/` | SQLite schema, migrations, types |
| **IPC Bridges** | `src/process/bridge/` | Auth, fs, mcp, model, webui |
| **Services** | `src/process/services/` | Cron scheduler, MCP, auto-updater |
| **Task Managers** | `src/process/task/` | AI Agent lifecycle management |
| **Channels** | `src/channels/` | Telegram, Lark, DingTalk adapters |
| **WebUI Auth** | `src/webserver/auth/` | JWT authentication, sessions |
| **Renderer Pages** | `src/renderer/pages/` | /login, /conversation, /settings, /cron |
| **i18n** | `src/renderer/i18n/` | Translation files (6+ languages) |
| **Assistants** | `assistant/` | Built-in assistant definitions (markdown) |

## Tech Stack

- **Electron 40** + **electron-vite 5** - Multi-process desktop app
- **React 19** + **TypeScript 5.8** (strict mode)
- **Vitest 4** - Testing (node environment default, jsdom for `*.dom.test.ts`)
- **Arco Design 2** + **UnoCSS 66** - UI components and styling
- **Better-SQLite3** - Local database
- **Zod** - Runtime validation at boundaries
- **Express 5** + **WebSocket** - WebUI server
- **Croner** - Scheduled task system
- **Grammy** - Telegram bot framework
- **MCP SDK** - Model Context Protocol integration

## Code Conventions

**Naming**:
- Components: PascalCase (`Button.tsx`)
- Utilities: camelCase (`formatDate.ts`)
- Constants: UPPER_SNAKE_CASE
- Unused params: prefix with `_`

**TypeScript**: Prefer `type` over `interface`. Strict mode enabled. Path aliases: `@/*`, `@process/*`, `@renderer/*`, `@worker/*`

**React**: Functional components only. Hooks use `use*` prefix. Event handlers use `on*` prefix. Props types: `${ComponentName}Props`

**Styling**: UnoCSS atomic classes preferred. Component-specific styles use `*.module.css`. Use Arco Design semantic colors.

**i18n**: All user-facing text must use i18n keys from `src/renderer/i18n/locales/*.json` — never hardcode strings. Translation files: English, Chinese ( Simplified/Traditional), Japanese, Korean, Turkish, Spanish, Portuguese.

**Comments**: English only for code comments. JSDoc for function documentation.

**Prettier**: Single quotes, trailing commas, 2-space indentation. Run `bun run format` after editing.

## Testing

**Test files**: `*.test.ts`

**Test environments**:
- `node` (default) - Main process, utilities, services
- `jsdom` - Files named `*.dom.test.ts` (React components/hooks)

**Test structure**:
- `tests/unit/` - Individual functions, utilities, components
- `tests/integration/` - IPC, database, service interactions
- `tests/e2e/` - End-to-end tests (Playwright)

**Workflow**:
- Run `bun run test` before every commit
- New features must include tests
- Update affected tests when modifying logic
- Coverage thresholds: 30% lines/statements, 10% branches, 35% functions

## Git Conventions

**Commit format**: `<type>(<scope>): <subject>` in English

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`, `build`, `ci`, `revert`

Examples:
```
feat(cron): implement scheduled task system
fix(webui): correct modal z-index issue
chore: remove debug console.log statements
```

**NO AI SIGNATURES**: Never add "Co-Authored-By: AI" or "Generated with AI" to commits or PRs. → **AI SIGNATURE REQUIRED**: Always add "Co-Authored-By: AI" to commits.

**Pre-commit hooks**: Install with `prek install`. Auto-runs TypeScript, ESLint, Prettier, and i18n validation on staged files.

## AI Agent System

**Built-in agents** in `src/agent/`:
- `gemini/` - Google Gemini (default, zero setup via OAuth or API key)
- `acp/` - Multi-agent protocol (Claude Code, Qwen Code auto-detection)
- `codex/` - Codex CLI
- `openclaw/` - OpenClaw Gateway
- `nanobot/` - Nanobot integration

**20+ supported platforms**: Gemini, Anthropic, OpenAI, AWS Bedrock, Dashscope (Qwen), Zhipu, Moonshot (Kimi), Qianfan (Baidu), Hunyuan (Tencent), DeepSeek, MiniMax, OpenRouter, SiliconFlow, xAI, Ollama, LM Studio, etc.

**Multi-Agent Mode**: Auto-detects installed CLI agents (Claude Code, Codex, Qwen Code, Goose AI, OpenClaw, Augment Code, iFlow CLI, CodeBuddy, Kimi CLI, OpenCode, Factory Droid, GitHub Copilot, Qoder CLI, Mistral Vibe, Nanobot).

**MCP (Model Context Protocol)**: Configure MCP tools once in `src/process/services/mcp/`, automatically sync to all agents.

## WebUI Authentication

Default user: `admin`. Password reset via `bun run resetpass`. JWT tokens stored in `sudowork-session` cookie (24h expiry). Data stored in SQLite at platform-specific locations (`~/Library/Application Support/sudowork/` on macOS).

**Remote Access**: Configure in Settings → WebUI → Channel. Supports Telegram, Lark (Feishu), DingTalk bots.

**Cron System**: Located in `src/process/services/cron/`. Tasks bound to conversations, maintain context history. Uses `croner` library with `CronBusyGuard` to prevent concurrent execution.

**Assistants**: Markdown-defined assistants in `assistant/`. Built-in: Cowork, PPTX Generator, PDF to PPT, 3D Game, UI/UX Pro Max, Planning with Files, HUMAN 3.0 Coach, Social Job Publisher, moltbook, Beautiful Mermaid, Story Roleplay.

**Extensions**: Extension system in `src/extensions/` (RFC-001). Custom extensions loaded from `extensions/` directory.

## Sudoclaw (OpenClaw) Installation Principles

**Core Principle**: Sudoclaw CLI must work on a clean machine without any system Node.js installation. New users on macOS/Windows/Linux should have a zero-friction installation experience.

**Requirements**:
- **No system Node.js dependency** — Sudoclaw uses the bundled Node.js runtime from `resources/node-darwin-arm64.tar.gz` (or platform equivalent)
- **Bundled npm** — npm install runs via bundled Node.js, not system npm
- **Platform-specific bindings** — `@snazzah/davey` native bindings must be installed for the correct platform/arch at runtime
- **Silent installation** — Downloads from OSS and installs to `~/.nexus/.sudoclaw` on first run
- **Self-contained** — All dependencies (Node.js, npm, OpenClaw package) are bundled or downloaded at build time

**Implementation**: See `src/process/services/sudoclaw/SudoclawInstallService.ts` — uses `getNodeBinaryPath()` to access bundled Node.js, never invokes system `node` or `npm`.
