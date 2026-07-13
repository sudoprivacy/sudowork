# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sudowork 是一个基于 Electron 的桌面应用（productName 为 `sudowork`），为 AI CLI Agent 提供图形化、可远程访问的界面 —— 一个 "AgentOPS / 办公专家" 平台。它也可以无界面运行为 WebUI 服务器，通过网络以及 IM 渠道（Telegram / 飞书 Lark / 钉钉）访问。

## 规范来源

[AGENTS.md](AGENTS.md) 是编码规范的唯一权威来源（命名、TypeScript、React、样式、git 提交格式、测试流程）。写代码前请先阅读。以下几条最容易踩坑：

- **编辑 `.ts`/`.tsx` 后只 lint 改动的那个文件** —— 运行 `bunx eslint <路径> --fix`，**不要**用 `bun run lint:fix`。后者会对整个仓库 `eslint --fix`，把无关的历史遗留问题一并改掉，污染你的 diff。Prettier 在 CI 中强制执行，格式问题会阻塞合并。ESLint 行宽上限为 120；Prettier 的 `printWidth` 实质不限（700）。
- **运行 `bunx tsc --noEmit` 校验类型** —— 开启了 strict 模式，类型错误会阻塞合并。
- **绝不添加 AI 署名** 到 commit 或 PR（`Co-Authored-By`、"Generated with…"、任何 AI 落款）。这是硬性规则 —— 违反会污染 git 历史。
- **绝不硬编码面向用户的字符串** —— 使用 i18n key（`src/renderer/i18n/locales/*.json`）。
- **复杂逻辑才注释，简单改动不写** —— 不要为了模仿周围注释密度而堆注释；只在逻辑不直观、需要解释「为什么」时写。
- 提交信息：英文，格式 `<type>(<scope>): <subject>`（feat/fix/refactor/chore/docs/test/style/perf）。

## 常用命令

包管理器是 **bun**（`bun.lock`）；Node `>=22 <26`。大多数脚本通过 `bun run` 调用。

```bash
# 开发 / 运行
bun run start              # Electron 开发模式（先构建 hook，再执行 scripts/launch-dev.js）
bun run webui              # 无界面 WebUI 服务器（本地）
bun run webui:remote       # 允许网络访问的 WebUI 服务器
bun run resetpass          # 重置 WebUI 管理员密码

# 质量检查（提交前运行）
bun run check              # type:check + lint + format:check + vitest run（完整门禁）
bun run type:check         # bunx tsc --noEmit
bun run lint               # eslint --quiet
bun run lint:fix           # eslint --fix
bun run format             # prettier --write

# 测试（Vitest 4 —— 配置见 vitest.config.ts）
bun run test               # 全部测试
bun run test:watch
bun run test:coverage
bun run test:integration   # 仅 tests/integration
bunx vitest run path/to/file.test.ts          # 运行单个测试文件
bunx vitest run -t "测试名片段"                 # 按名称匹配运行
bun run test:e2e           # 通过 pytest 运行 E2E（tests/e2e/，Python）
```

两套 Vitest 环境：`node`（默认）和用于 `*.dom.test.ts` 文件的 `jsdom`。给某个功能区新增源文件时，记得同步加入 `vitest.config.ts` 的 `coverage.include`。

生产构建走 `scripts/build-with-builder.js`（如 `bun run build:mac`、`build:win`、`build:linux`）。这些命令会先下载内置二进制（nexus-vfs、scode、node、bdpan、mcporter）并构建 browser MCP。`cli:download` / `*:download` 系列脚本负责获取这些随附运行时。

## 架构

### 多进程模型（Electron）

三种进程，各有严格的 API 边界。跨进程调用 **只能** 通过 IPC 桥接 —— 不要直接互相访问。

- **主进程（Main）** —— `src/process/` 与 `src/index.ts`。应用逻辑、SQLite 数据库、各类服务、IPC 处理。无 DOM API。
- **渲染进程（Renderer）** —— `src/renderer/`。React 19 UI。无 Node.js API。
- **Worker 进程** —— 后台 AI 任务（别名 `@worker`），由主进程派生并监管。

路径别名（同时定义于 `electron.vite.config.ts` 和 `tsconfig.json`）：`@/*`→src、`@common/*`、`@process/*`、`@renderer/*`、`@worker/*`。

IPC：`src/preload.ts` 通过 `contextBridge` 暴露类型化 API；主进程侧处理器在 `src/process/bridge/`（authBridge、fsBridge、mcpBridge、modelBridge、webuiBridge…）；消息/类型定义在 `src/renderer/messages/`。新增一个 channel 意味着同时改动 preload 桥接与对应 bridge 处理器。

### Agent 层（`src/agent/`）

通过各自协议驱动外部 AI CLI Agent 的适配器。当前磁盘上真实存在的子目录为：

- `acp/` —— Agent Client Protocol 适配器（`AcpAdapter`、`AcpConnection`、`AcpDetector`）；自动检测已安装的 ACP agent。
- `codex/` —— Codex 集成（connection / core / handlers / messaging）。
- `sudoclaw/` —— Sudoclaw 网关：设备配对的远程 agent 连接（`SudoclawGatewayManager`、`SudoclawGatewayConnection`、设备认证/身份）。
- `remote/` —— 远程 WebSocket 连接（`MossWsConnection`）。

（注意：`project.md` 描述的是较旧的 `gemini/openclaw/nanobot` 结构 —— 以磁盘上的 `src/agent/` 为准。）

### Channels（`src/channels/`）

平台无关的框架，将 agent 能力通过 IM 平台暴露出去（Telegram 用 grammY、飞书 Lark 用 `@larksuiteoapi/node-sdk`、钉钉用 `dingtalk-stream`）。所有平台都归一化为统一消息协议（`IUnifiedIncomingMessage` / `IUnifiedOutgoingMessage`）。分层：`core/`（ChannelManager 单例、SessionManager 按会话隔离）→ `gateway/`（ActionExecutor 把消息路由到 Action，PluginManager 管理插件生命周期）→ `agent/`（事件总线 + 消息服务）→ `actions/`、`pairing/`（用户授权）、`plugins/`（各平台实现）。详见 [src/channels/ARCHITECTURE.md](src/channels/ARCHITECTURE.md)。

### WebUI 服务器（`src/webserver/`）

Express 5 + WebSocket，用于无界面 / 远程访问。`auth/` 中实现 JWT 认证（bcrypt 密码、Cookie `sudowork-session`、24 小时有效期）；路由在 `routes/`；实时通信在 `websocket/`。默认端口 25808；通过 `--webui`/`--remote`/`--port` 命令行参数、`sudowork_*` 环境变量，或 OS app-data 目录下的 `webui.config.json` 配置。详见 [WEBUI_GUIDE.md](docs/WEBUI_GUIDE.md) 与 [SERVER_DEPLOY_GUIDE.md](docs/SERVER_DEPLOY_GUIDE.md)。

### 扩展系统（`src/extensions/`）

沙箱化的扩展系统：loader/registry/lifecycle、依赖与引擎校验、路径安全、热重载、自定义 asset/UI 协议。扩展运行在 sandbox worker 中。

### 其他关键位置

- `src/process/database/` —— SQLite（better-sqlite3）：`schema.ts`、`migrations.ts`。存储账户、对话历史、cron 配置、MCP 服务器配置。
- `src/process/services/cron/` —— 基于 `croner` 的调度；`CronService` 引擎 + `CronBusyGuard`（防止同一任务并发执行）。
- `src/common/` —— 跨进程共享代码（MCP、ACP、审批流程、模型/API-key 管理、storage key、斜杠命令）。MCP 配置会同步到所有 agent。
- `src/shared/` —— 跨切面配置/类型（`i18n-config.json`、`runtime-versions.json`）。

## 常用 PM Skills

如果用户在当前项目里提出产品发现、需求分析、PRD、路线图、优先级、用户故事等工作，并且本机已安装 `pm-skills` marketplace，优先参考本地 skill 定义：`~/.claude/plugins/marketplaces/pm-skills/skills/<skill-name>/SKILL.md`。

推荐优先使用这 9 个高频 skill：

- `problem-statement` —— 先把问题定义清楚，再讨论方案。
- `jobs-to-be-done` —— 分析客户 jobs / pains / gains，适合需求发现与价值判断。
- `proto-persona` —— 用户分群和原型画像还不清晰时使用。
- `opportunity-solution-tree` —— 从 outcome → opportunity → solution → test 做结构化拆解。
- `prioritization-advisor` —— 需要在 RICE / ICE / Kano 等框架里选合适方法时使用。
- `prd-development` —— 输出结构化 PRD，串起问题、用户、方案、指标与边界。
- `roadmap-planning` —— 做阶段目标、优先级、依赖、排序与沟通时使用。
- `user-story` —— 写 user story 与 acceptance criteria 时使用。
- `product-strategy-session` —— 用户让你做更完整的产品策略梳理时使用。

这些 skill 目前不会自动出现在 Claude Code 的可调用 skill 列表里；当需求匹配时，直接按对应 `SKILL.md` 框架执行即可。

## 参考文档

- [docs/tech/architecture.md](docs/tech/architecture.md) —— IPC / WebUI / Cron 细节
- [docs/tech/nexus-integration-architecture.md](docs/tech/nexus-integration-architecture.md) —— Nexus VFS 集成
- [project.md](docs/project.md) —— 各平台安装/使用与 FAQ（部分模块清单已过时，请对照代码树核实）
- [CONTRIBUTING.md](CONTRIBUTING.md)、[CODE_STYLE.md](docs/CODE_STYLE.md)
