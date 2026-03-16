# sudowork 项目说明文档

## 目录

1. [项目概述](#项目概述)
2. [技术架构](#技术架构)
3. [模块详解](#模块详解)
4. [平台使用说明](#平台使用说明)
5. [浏览器登录指南](#浏览器登录指南)
6. [常见问题](#常见问题)

---

## 项目概述

**sudowork** 是一个基于 Electron 的桌面应用程序，为 AI Agent 提供现代化的图形化界面。它支持多平台（macOS、Windows、Linux），并可通过 WebUI 模式在浏览器中访问。

### 核心特性

- **内置 AI Agent** - 开箱即用的 AI 助手，无需额外配置
- **多 Agent 模式** - 支持 Claude Code、Codex、Qwen Code 等 12+ 种 CLI Agent
- **远程访问** - 通过 WebUI + Telegram/Lark/钉钉 实现远程控制
- **定时任务** - Cron 系统支持 24/7 自动化任务
- **文件预览** - 支持 PDF、Word、Excel、PPT 等 10+ 种格式
- **多语言支持** - 中文、英文、日文、韩文等 6 种语言

### 版本信息

- 当前版本：1.8.26
- Electron 版本：37
- React 版本：19
- TypeScript 版本：5.8

---

## 技术架构

### 多进程模型

```
┌─────────────────────────────────────────────────────────────┐
│                        sudowork 应用                          │
├─────────────────┬─────────────────┬─────────────────────────┤
│   主进程         │   渲染进程       │   Worker 进程          │
│  (Main)         │  (Renderer)     │   (Worker)              │
│                 │                 │                         │
│ - 应用逻辑       │ - React UI     │ - 后台 AI 任务           │
│ - 数据库         │ - 用户界面      │ - Gemini 任务           │
│ - IPC 桥接       │ - 无可使用      │ - ACP 任务              │
│ - 系统服务       │   Node.js API  │ - Codex 任务            │
│                 │                 │ - OpenClaw 任务         │
└─────────────────┴─────────────────┴─────────────────────────┘
                          │
                          ▼
                  IPC 桥接 (preload.ts)
```

### 进程职责

| 进程类型 | 目录 | 职责 | 可用 API |
|---------|------|------|--------|
| **主进程** | `src/process/` | 应用逻辑、数据库、IPC | Node.js 全部 API |
| **渲染进程** | `src/renderer/` | 用户界面、交互 | 浏览器 API、DOM |
| **Worker 进程** | `src/worker/` | 后台 AI 任务 | Node.js API（受限） |

### 核心服务

```
src/
├── process/           # 主进程
│   ├── bridge/        # IPC 桥接层
│   ├── database/      # SQLite 数据库
│   ├── services/      # 系统服务
│   │   ├── cron/      # 定时任务
│   │   └── mcp/       # MCP 协议
│   └── task/          # 任务管理
├── renderer/          # 渲染进程 (React UI)
├── webserver/         # WebUI 服务器
│   ├── auth/          # 认证系统
│   ├── routes/        # API 路由
│   └── websocket/     # WebSocket 通信
└── worker/            # Worker 进程
```

---

## 模块详解

### 1. 主进程模块 (`src/process/`)

#### 1.1 初始化模块

| 文件 | 作用 |
|------|------|
| `index.ts` | 主进程入口，初始化 Channel 管理和扩展注册 |
| `initStorage.ts` | 初始化存储系统，包括数据库和配置 |
| `initBridge.ts` | 初始化 IPC 桥接 |
| `initAgent.ts` | 初始化 AI Agent 系统 |

#### 1.2 桥接模块 (`bridge/`)

| 文件 | 作用 |
|------|------|
| `index.ts` | IPC 桥接总入口 |
| `authBridge.ts` | 认证相关 IPC |
| `fsBridge.ts` | 文件系统操作 IPC |
| `mcpBridge.ts` | MCP 协议桥接 |
| `modelBridge.ts` | AI 模型管理桥接 |
| `webuiBridge.ts` | WebUI 相关桥接 |
| `windowControlsBridge.ts` | 窗口控制桥接 |
| `systemSettingsBridge.ts` | 系统设置桥接 |

#### 1.3 数据库模块 (`database/`)

| 文件 | 作用 |
|------|------|
| `index.ts` | 数据库初始化和管理 |
| `schema.ts` | 数据库 Schema 定义 |
| `migrations.ts` | 数据库迁移脚本 |
| `types.ts` | 数据库类型定义 |

使用 SQLite 存储：
- 用户账户信息
- 对话历史
- 定时任务配置
- MCP 服务器配置

#### 1.4 服务模块 (`services/`)

| 服务 | 目录 | 功能 |
|------|------|------|
| **Cron 服务** | `cron/` | 定时任务调度，支持 cron 表达式 |
| **MCP 服务** | `mcpServices/` | Model Context Protocol 支持 |
| **AutoUpdater** | `autoUpdaterService.ts` | 应用自动更新 |
| **Gemini 订阅** | `geminiSubscription.ts` | Google Gemini 服务集成 |

### 2. 渲染进程模块 (`src/renderer/`)

#### 2.1 核心组件

| 文件/目录 | 作用 |
|----------|------|
| `layout.tsx` | 主布局组件 |
| `router.tsx` | 路由配置 |
| `sider.tsx` | 侧边栏组件 |
| `index.tsx` | 渲染进程入口 |

#### 2.2 页面模块 (`pages/`)

| 页面 | 路径 | 功能 |
|------|------|------|
| **登录页** | `/login` | 用户登录界面 |
| **Guid 页** | `/guid` | AI 对话引导页（主页） |
| **对话页** | `/conversation` | 聊天对话界面 |
| **设置页** | `/settings` | 应用设置管理 |
| **Cron 页** | `/cron` | 定时任务管理 |

#### 2.3 功能组件

```
components/
├── base/              # 基础 UI 组件
├── SettingsModal/     # 设置弹窗
│   ├── contents/      # 设置内容
│   │   ├── ModelModalContent.tsx    # 模型配置
│   │   ├── AgentModalContent.tsx    # Agent 配置
│   │   ├── WebuiModalContent.tsx    # WebUI 配置
│   │   └── channels/                # 频道配置
│   └── index.tsx
├── Markdown.tsx       # Markdown 渲染
├── Diff2Html.tsx      # 代码差异对比
└── ThemeSwitcher.tsx  # 主题切换
```

#### 2.4 消息处理 (`messages/`)

处理不同类型的 AI 消息显示：

| 组件 | 功能 |
|------|------|
| `MessageList.tsx` | 消息列表渲染 |
| `MessageToolCall.tsx` | 工具调用消息 |
| `MessagePlan.tsx` | 计划消息 |
| `MessageAgentStatus.tsx` | Agent 状态显示 |

### 3. Web 服务器模块 (`src/webserver/`)

#### 3.1 认证系统 (`auth/`)

```
auth/
├── middleware/
│   ├── AuthMiddleware.ts      # 认证中间件
│   └── TokenMiddleware.ts     # Token 中间件
├── repository/
│   └── UserRepository.ts      # 用户数据仓库
└── service/
    └── AuthService.ts         # 认证服务
```

**认证流程**：
1. 用户输入用户名密码
2. 密码使用 bcrypt 加密存储
3. 登录成功生成 JWT Token
4. Token 存储在 Cookie 中（名称：`sudowork-session`）
5. Token 有效期：24 小时

#### 3.2 路由模块 (`routes/`)

| 路由文件 | 端点 | 功能 |
|---------|------|------|
| `authRoutes.ts` | `/login`, `/logout` | 认证相关 |
| `apiRoutes.ts` | `/api/*` | API 接口 |
| `staticRoutes.ts` | `/*` | 静态资源 |

#### 3.3 WebSocket 通信

| 文件 | 功能 |
|------|------|
| `WebSocketManager.ts` | WebSocket 连接管理 |
| `WebSocketHandler.ts` | WebSocket 消息处理 |

**WebSocket 特性**：
- 心跳检测：30 秒间隔
- 心跳超时：60 秒
- 自动重连机制

### 4. Agent 模块 (`src/agent/`)

#### 4.1 支持的 Agent

| Agent | 目录 | 状态 |
|-------|------|------|
| **内置 Agent** | `gemini/` | 开箱即用 |
| **Codex** | `codex/` | 自动检测 |
| **ACP** | `acp/` | 自动检测 |
| **OpenClaw** | `openclaw/` | 自动检测 |
| **Nanobot** | `nanobot/` | 自动检测 |

#### 4.2 OpenClaw Gateway

```
openclaw/
├── OpenClawGatewayManager.ts    # Gateway 管理
├── OpenClawGatewayConnection.ts # Gateway 连接
├── deviceAuthStore.ts           # 设备认证存储
├── deviceIdentity.ts            # 设备身份
└── types.ts                     # 类型定义
```

### 5. Worker 进程模块 (`src/worker/`)

每个 Worker 负责特定 AI 模型的后台任务：

| Worker 文件 | 负责任务 |
|------------|---------|
| `gemini.ts` | Google Gemini 任务 |
| `codex.ts` | Codex AI 任务 |
| `acp.ts` | ACP Agent 任务 |
| `nanobot.ts` | Nanobot 任务 |
| `openclaw-gateway.ts` | OpenClaw Gateway 任务 |

---

## 平台使用说明

### macOS

#### 系统要求

- macOS 10.15 或更高版本
- 4GB+ 内存推荐
- 500MB+ 可用存储空间

#### 安装方式

**方式 1：Homebrew（推荐）**

```bash
brew install sudowork
```

**方式 2：DMG 安装**

1. 从 [GitHub Releases](https://github.com/sudoprivacy/sudowork/releases) 下载 `.dmg` 文件
2. 双击打开 DMG
3. 将 sudowork 拖拽到 Applications 文件夹

#### 启动方式

```bash
# 普通模式
open -a sudowork

# WebUI 模式（浏览器访问）
/Applications/sudowork.app/Contents/MacOS/sudowork --webui

# WebUI 远程模式
/Applications/sudowork.app/Contents/MacOS/sudowork --webui --remote
```

#### 配置文件位置

```
~/Library/Application Support/sudowork/
├── webui.config.json    # WebUI 配置
├── database.sqlite      # 数据库
└── logs/                # 日志文件
```

---

### Windows

#### 系统要求

- Windows 10 或更高版本
- 4GB+ 内存推荐
- 500MB+ 可用存储空间

#### 安装方式

**方式 1：NSIS 安装程序（推荐）**

1. 从 GitHub Releases 下载 `.exe` 安装程序
2. 运行安装程序
3. 按照向导完成安装

**方式 2：便携版**

1. 下载 `.zip` 便携版
2. 解压到任意目录
3. 双击 `sudowork.exe` 运行

#### 启动方式

```cmd
# 普通模式
"A:\Program Files\sudowork\sudowork.exe"

# WebUI 模式
"A:\Program Files\sudowork\sudowork.exe" --webui

# WebUI 远程模式
"A:\Program Files\sudowork\sudowork.exe" --webui --remote

# 重置密码
"A:\Program Files\sudowork\sudowork.exe" --resetpass
```

#### 创建桌面快捷方式

1. 右键桌面 → 新建 → 快捷方式
2. 输入路径：`"C:\Program Files\sudowork\sudowork.exe" --webui`
3. 命名快捷方式为 "sudowork WebUI"

#### 配置文件位置

```
%APPDATA%\sudowork\
├── webui.config.json    # WebUI 配置
├── database.sqlite      # 数据库
└── logs/                # 日志文件
```

---

### Linux

#### 系统要求

- Ubuntu 18.04+ / Debian 10+ / Fedora 32+
- 4GB+ 内存推荐
- 500MB+ 可用存储空间

#### 安装方式

**方式 1：DEB 包（Debian/Ubuntu）**

```bash
# 下载并安装
wget https://github.com/sudoprivacy/sudowork/releases/download/vVERSION/sudowork_VERSION_amd64.deb
sudo apt install ./sudowork_*.deb
```

**方式 2：AppImage（通用）**

```bash
# 下载 AppImage
wget https://github.com/sudoprivacy/sudowork/releases/download/vVERSION/sudowork_VERSION_amd64.AppImage

# 添加执行权限
chmod +x sudowork-*.AppImage

# 运行
./sudowork-*.AppImage
```

#### 启动方式

```bash
# 普通模式
sudowork

# WebUI 模式
sudowork --webui

# WebUI 远程模式
sudowork --webui --remote

# 指定端口
sudowork --webui --port 8080
```

#### Systemd 服务（后台运行）

创建 `/etc/systemd/system/sudowork-webui.service`：

```ini
[Unit]
Description=sudowork WebUI Service
After=network.target

[Service]
Type=simple
User=your_username
ExecStart=/opt/sudowork/sudowork --webui --remote
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable sudowork-webui.service
sudo systemctl start sudowork-webui.service
```

#### 配置文件位置

```
~/.config/sudowork/
├── webui.config.json    # WebUI 配置
├── database.sqlite      # 数据库
└── logs/                # 日志文件
```

---

## 浏览器登录指南

### WebUI 模式启动

**重要**：WebUI 通过环境变量传递参数，而不是命令行参数。

#### 本地访问

```bash
# 使用 package.json 脚本
bun run webui

# 或使用环境变量
sudowork_WEBUI=1 electron-vite dev
```

#### 远程访问（允许网络访问）

```bash
# 使用 package.json 脚本
bun run webui:remote

# 或使用环境变量
sudowork_WEBUI=1 sudowork_ALLOW_REMOTE=true electron-vite dev
```

启动后，打开浏览器访问：`http://localhost:25808`

### 登录流程

1. **访问登录页面**

   打开浏览器，访问 `http://localhost:25808`

2. **输入凭证**

   - 默认用户名：`admin`
   - 首次使用需要设置密码（通过 `--resetpass` 命令）

3. **点击登录**

   登录成功后会：
   - 生成 JWT Token
   - 设置 Cookie（名称：`sudowork-session`）
   - 跳转到主页面（`/guid`）

4. **保持登录状态**

   - 勾选"记住我"会在本地存储加密的凭证
   - Token 有效期为 24 小时

### 密码管理

#### 重置管理员密码

```bash
# 使用 package.json 脚本
bun run resetpass

# 或使用环境变量
sudowork_RESET_PASS=1 electron-vite dev
```

命令执行后会：
1. 生成一个随机的 12 位密码
2. 在终端显示新密码
3. 使所有现有 Token 失效

**重要**：立即复制显示的新密码，刷新页面后使用新密码登录。

### 二维码登录（可选）

WebUI 支持二维码登录功能：

1. 在设置中启用 WebUI
2. 使用手机扫描二维码
3. 扫描后自动登录到 WebUI

### 安全配置

#### 环境变量

| 变量名 | 作用 | 示例 |
|--------|------|------|
| `sudowork_PORT` | 自定义端口 | `sudowork_PORT=8080` |
| `sudowork_ALLOW_REMOTE` | 允许远程访问 | `sudowork_ALLOW_REMOTE=true` |
| `sudowork_HOST` | 监听地址 | `sudowork_HOST=0.0.0.0` |
| `sudowork_HTTPS` | 启用 HTTPS | `sudowork_HTTPS=true` |

#### 用户配置文件

创建 `webui.config.json`：

**位置：**
- Windows: `%APPDATA%\sudowork\webui.config.json`
- macOS: `~/Library/Application Support/sudowork/webui.config.json`
- Linux: `~/.config/sudowork/webui.config.json`

**内容示例：**
```json
{
  "port": 8080,
  "allowRemote": true
}
```

### 故障排查

#### 无法访问页面

1. **检查服务状态**
   ```bash
   # 查看终端输出，确认"Server started"消息
   ```

2. **检查防火墙**
   ```bash
   # Linux
   sudo ufw allow 25808/tcp

   # Windows (PowerShell)
   netsh advfirewall firewall add rule name="sudowork WebUI" dir=in action=allow protocol=TCP localport=25808
   ```

3. **尝试其他浏览器**
   - Chrome、Firefox、Edge、Safari

#### Token 失效

如果登录后立即被登出：
1. 清除浏览器缓存和 Cookie
2. 使用 `--resetpass` 重置密码
3. 重新登录

#### 端口被占用

如果 25808 端口被占用，应用会自动尝试下一个可用端口。查看终端输出确认实际端口号。

---

## 常见问题

### Q: 默认用户名和密码是什么？

A: 默认用户名是 `admin`。首次使用时需要通过 `--resetpass` 命令设置密码。

### Q: 如何修改 WebUI 端口？

A: 有三种方式：
1. 命令行参数：`--port 8080`
2. 环境变量：`sudowork_PORT=8080`
3. 配置文件：`webui.config.json` 中设置 `"port": 8080`

### Q: 如何允许远程访问？

A: 使用 `--remote` 参数启动，或设置环境变量 `sudowork_ALLOW_REMOTE=true`。

### Q: 数据存储在哪里？

A: 所有数据存储在本地 SQLite 数据库中：
- Windows: `%APPDATA%\sudowork\`
- macOS: `~/Library/Application Support/sudowork/`
- Linux: `~/.config/sudowork/`

### Q: 支持哪些 AI 模型？

A: 支持 20+ AI 平台，包括：
- **官方平台**: Gemini、Anthropic (Claude)、OpenAI
- **云平台**: AWS Bedrock、New API
- **中国平台**: 通义千问、智谱、Kimi、文心一言、混元
- **本地模型**: Ollama、LM Studio

### Q: 如何配置 MCP 服务器？

A: 在设置页面 → MCP 管理 → 添加 MCP 服务器。配置后会自动同步到所有 Agent。

### Q: 定时任务如何配置？

A:
1. 进入对话页面
2. 创建一个对话
3. 在对话中配置定时任务
4. 支持 cron 表达式和预设频率（每日、每周、每月）

---

## 附录

### 命令参考

| 命令 | 作用 |
|------|------|
| `bun run webui` | 启动 WebUI 模式 |
| `bun run webui:remote` | 启动 WebUI 远程访问模式 |
| `bun run resetpass` | 重置管理员密码 |
| `bun run start` | 开发模式（带 GUI） |
| `bun run build` | 构建生产版本 |

**环境变量方式**（开发环境）:
| 环境变量 | 作用 |
|----------|------|
| `sudowork_WEBUI=1` | 启动 WebUI 模式 |
| `sudowork_ALLOW_REMOTE=true` | 允许远程访问 |
| `sudowork_PORT=8080` | 指定端口号 |
| `sudowork_RESET_PASS=1` | 重置密码模式 |

### 开发命令

```bash
# 开发环境
bun run start              # 启动开发环境
bun run webui              # 启动 WebUI 服务器

# 代码质量
bun run lint               # ESLint 检查
bun run lint:fix           # 自动修复
bun run format             # Prettier 格式化

# 测试
bun run test               # 运行所有测试
bun run test:watch         # 监视模式
bun run test:coverage      # 测试覆盖率
```

### 构建命令

```bash
# 构建所有平台
bun run build

# 构建特定平台
bun run dist:mac           # macOS
bun run dist:win           # Windows
bun run dist:linux         # Linux
```

### 相关文档

- [README.md](./readme.md) - 项目主文档
- [WEBUI_GUIDE.md](./WEBUI_GUIDE.md) - WebUI 详细指南
- [SERVER_DEPLOY_GUIDE.md](./SERVER_DEPLOY_GUIDE.md) - 服务器部署指南
- [docs/tech/architecture.md](docs/tech/architecture.md) - 技术架构文档

---

**文档版本**: 1.0
**最后更新**: 2026-03-13
**项目版本**: sudowork 1.8.26