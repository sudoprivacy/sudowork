# 本地开发与构建指南

## 环境要求

| 工具 | 版本 | 安装方式 |
|------|------|---------|
| **Node.js** | ≥22 <26 | [nvm](https://github.com/nvm-sh/nvm): `nvm install 22` |
| **pnpm** | ≥9 | `npm install -g pnpm` |
| **Python** | ≥3.11 | macOS 自带，或 `brew install python` |
| **python-setuptools** | — | `brew install python-setuptools`（node-gyp 依赖） |
| **Xcode Command Line Tools** | — | `xcode-select --install`（macOS，原生模块编译需要） |

> **可选**：安装 [bun](https://bun.sh) 可使用 `bun run start` 等快捷命令。没有 bun 也可以用下面的手动命令。

---

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

`postinstall` 会自动完成：
- 下载 Electron 二进制
- 重建 `better-sqlite3` 原生模块（prebuild-install）
- 初始化 husky Git hooks

### 2. 启动开发服务器

```bash
# 方式一：使用 bun（需要先安装 bun）
bun run start

# 方式二：手动启动
node scripts/build-hook.js          # 构建安全拦截钩子
node scripts/launch-dev.js start    # 启动 electron-vite dev server
```

启动后会看到：
```
dev server running for the electron renderer process at:
  ➜  Local:   http://127.0.0.1:5173/
```

Electron 窗口会自动打开，renderer 支持 HMR 热更新。

### 3. 关闭开发服务器

```bash
# 方式一：终端按 Ctrl+C

# 方式二：远程关闭（通过 Chrome DevTools Protocol）
node scripts/launch-dev.js stop
```

### 4. CLI 工具（运行时依赖）

App 运行依赖 5 个 CLI 工具（Node.js、Sudoclaw、Nexus、Claude Code、bdpan）。有两种模式：

**模式 A：按需下载（模拟真实用户）**

不预下载任何工具，直接启动 app。首次进入主页面时会弹出下载进度框，自动从远程下载。
适合测试首次安装体验。

```bash
# 清除已安装的运行时（模拟全新用户）
rm -rf ~/.nexus

# 启动 dev
node scripts/launch-dev.js start
```

**模式 B：预下载到本地（日常开发）**

提前下载工具到 `resources/` 目录，启动时直接使用本地资源，无需等待下载。

```bash
# 下载所有 CLI 工具到 resources/
pnpm run cli:download

# 也可单独下载
pnpm run node:download       # Node.js 运行时
pnpm run openclaw:download   # Sudoclaw/OpenClaw
pnpm run nexus:download      # Nexus
pnpm run claude:download     # Claude Code CLI
pnpm run bdpan:download      # bdpan CLI

# 强制重新下载（覆盖已有文件）
pnpm run cli:download:force
```

---

## 构建打包

### macOS

```bash
# ARM64（Apple Silicon）
pnpm run build:mac:arm64

# x64（Intel Mac）
pnpm run build:mac:x64

# 同时构建 ARM64 + x64
pnpm run build:mac
```

产物在 `out/` 目录：
- `out/Sudowork-{version}-mac-arm64.dmg`
- `out/Sudowork-{version}-mac-arm64.zip`

### Windows

```bash
# 自动检测架构
pnpm run build:win

# 指定架构
pnpm run build:win:x64
pnpm run build:win:arm64
```

产物：
- `out/Sudowork-{version}-win-x64.exe`（NSIS 安装包）
- `out/Sudowork-{version}-win-x64.zip`

### Linux

```bash
pnpm run build:linux
```

> **注意**：构建脚本不再自动下载 CLI 工具。CLI 工具已改为用户首次启动时按需下载，不打包进安装包。如果需要在安装包中内置 CLI 工具（离线场景），构建前手动执行 `pnpm run cli:download`。

---

## 项目结构

```
sudowork/
├── src/
│   ├── index.ts                    # Electron 主入口
│   ├── process/                    # 主进程逻辑
│   │   ├── services/               # 服务层
│   │   │   ├── serviceManager/     # 启动编排（RuntimeInstaller）
│   │   │   ├── claudeCli/          # Node.js 运行时 & Claude Code
│   │   │   ├── sudoclaw/           # Sudoclaw 安装与管理
│   │   │   ├── nexus/              # Nexus 服务
│   │   │   ├── bdpan/              # bdpan 安装
│   │   │   └── download/           # 通用远程下载工具
│   │   └── bridge/                 # IPC 通信桥接
│   ├── renderer/                   # 渲染进程（React）
│   │   ├── main.tsx                # 应用入口组件
│   │   ├── router.tsx              # 路由配置
│   │   ├── context/                # React Context（Auth、Init 等）
│   │   ├── components/             # 通用组件
│   │   └── pages/                  # 页面
│   ├── preload/                    # 预加载脚本
│   ├── shared/                     # 主进程/渲染进程共享
│   │   └── runtime-versions.json   # CLI 工具版本集中管理
│   └── common/                     # IPC 类型定义
├── scripts/                        # 构建 & 下载脚本
├── resources/                      # 构建资源（图标、CLI 工具等）
├── hook/                           # 安全拦截钩子（Node + Python）
├── electron-builder.yml            # 打包配置
├── electron.vite.config.ts         # Vite 构建配置
└── package.json
```

---

## 运行时架构

```
App 启动
  │
  ├─ 主进程: ServiceManager.startup()（异步，不阻塞 UI）
  │   └─ RuntimeInstaller.ensureAll()
  │       ├─ 检查 CLI 工具是否已安装（~/.nexus/）
  │       ├─ 未安装 → 从远程下载（静默后台进行）
  │       ├─ 安装完成 → 启动 Sudoclaw gateway + Nexus 服务
  │       └─ 全部就绪 → 广播 phase='ready'
  │
  └─ 渲染进程: 直接显示登录/注册页面
       │
       └─ 用户登录成功 → 进入主页面
            ├─ 如果 CLI 工具已就绪 → 正常使用
            └─ 如果未就绪 → 弹出进度框，完成后自动关闭
```

CLI 工具安装路径：`~/.nexus/`

| 工具 | 安装位置 |
|------|---------|
| Node.js | `~/.nexus/node/node-v{version}-{os}-{arch}/` |
| Sudoclaw | `~/.nexus/sudoclaw/cli/package/` |
| Nexus | `~/.nexus/` 下 nexus 二进制 |
| Claude Code | `~/.nexus/cli/claude/` |
| bdpan | `~/.local/bin/bdpan` |

---

## 常用命令速查

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装依赖 + Electron + 原生模块重建 |
| `node scripts/launch-dev.js start` | 启动开发服务器 |
| `node scripts/launch-dev.js stop` | 关闭开发服务器 |
| `pnpm run cli:download` | 预下载 CLI 工具到 resources/ |
| `pnpm run build:mac:arm64` | 构建 macOS ARM64 安装包 |
| `pnpm run build:win` | 构建 Windows 安装包 |
| `pnpm run build:linux` | 构建 Linux 安装包 |
| `pnpm run lint` | ESLint 检查 |
| `pnpm run lint:fix` | ESLint 自动修复 |
| `pnpm run format` | Prettier 格式化 |
| `pnpm run type:check` | TypeScript 类型检查 |
| `pnpm run test` | 运行测试 |
| `pnpm run test:watch` | 监听模式测试 |
| `pnpm run test:coverage` | 测试覆盖率 |
| `pnpm run clean` | 清理构建产物 |

---

## 常见问题

### `Error: Electron uninstall`

Electron 二进制未下载。执行：

```bash
node node_modules/electron/install.js
```

### `ModuleNotFoundError: No module named 'distutils'`

Python 3.12+ 移除了 distutils。安装 setuptools：

```bash
brew install python-setuptools
```

### `C++20 or later required` 编译错误

原生模块在尝试从源码编译。确保 `postinstall` 使用 prebuild-install（下载预编译二进制）而非 node-gyp 源码编译。执行：

```bash
pnpm install --ignore-scripts
npx electron-rebuild --only better-sqlite3 --force --arch arm64 --electron-version 40.8.3
```

### 首次启动时 CLI 工具下载失败

网络问题（如 nodejs.org 在国内访问慢）。手动预下载：

```bash
pnpm run cli:download
```

然后重启 app，会优先使用本地资源。
