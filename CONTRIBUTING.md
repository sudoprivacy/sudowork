# 贡献指南

本文档描述了项目的分支管理策略、版本发布流程和命名规范。

---

## 分支管理策略

### 分支类型

| 分支类型 | 命名 | 说明 | 保护状态 |
|---------|------|------|---------|
| **主分支** | `main` | 生产环境代码，始终保持可发布状态 | 受保护 |
| **开发分支** | `dev` | 日常开发集成分支 | 受保护 |
| **功能分支** | `feature-{name}` | 新功能开发 | 非保护 |
| **修复分支** | `fix-{name}` | Bug 修复 | 非保护 |
| **维护分支** | `release-v{X.Y}` | 版本维护，用于 Hotfix | 受保护 |

### 分支命名规范

```
feature-{功能名称}     # 功能分支，如 feature-user-auth
fix-{问题描述}         # 修复分支，如 fix-login-crash
release-v{大版本号}    # 维护分支，如 release-v1.2
```

**注意**：分支名称统一使用 `-`（短横线）作为分隔符。

---

## 开发工作流

### 日常开发

```
┌─────────────────────────────────────────────────────────────┐
│  1. 从 dev 创建功能分支                                      │
│     git checkout dev                                        │
│     git checkout -b feature-xxx                             │
│                                                              │
│  2. 开发完成后提交代码                                        │
│     git add .                                               │
│     git commit -m "feat: add xxx feature"                   │
│                                                              │
│  3. 推送并创建 PR 到 dev 分支                                 │
│     git push origin feature-xxx                             │
│                                                              │
│  4. PR 合并后删除功能分支                                     │
└─────────────────────────────────────────────────────────────┘
```

### 提交信息规范

```
type(scope): description

# 类型：
# feat     - 新功能
# fix      - Bug 修复
# docs     - 文档更新
# style    - 代码格式调整
# refactor - 代码重构
# test     - 测试相关
# chore    - 构建/工具变动

# 示例：
feat: 添加用户登录功能
fix(auth): 修复 token 过期问题
docs: 更新部署文档
```

---

## 版本发布流程

### 发布阶段概览

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   开发阶段    │ -> │   Nightly    │ -> │  Candidate   │ -> │   正式发布    │ -> │   Hotfix     │
│              │    │              │    │              │    │              │    │   (可选)     │
│  dev 分支    │    │  每日构建    │    │  人工审批    │    │  v* 标签     │    │  紧急修复    │
│  手动触发    │    │  通知 QA     │    │  RC 标签     │    │  上传 COS    │    │  同步回流    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

### 阶段详解

#### 1. 开发阶段

| 项目 | 说明 |
|------|------|
| **触发方式** | 手动触发 `build-and-release.yml` workflow |
| **输入参数** | branch: `dev`, skip_code_quality: 可选 |
| **构建平台** | mac-arm64, mac-x64, windows-x64, windows-arm64 |
| **生成标签** | `dev-{commit}` |
| **产物位置** | GitHub Pre-release |
| **COS 上传** | ❌ 不上传 |

#### 2. Nightly 阶段

| 项目 | 说明 |
|------|------|
| **触发方式** | 定时触发（北京时间 18:00）或手动触发 |
| **构建分支** | `main` |
| **构建平台** | mac-arm64, windows-x64（可配置） |
| **生成标签** | `nightly-{date}-{commit}`，如 `nightly-2026-04-01-abc123` |
| **产物位置** | GitHub Pre-release |
| **COS 上传** | ❌ 不上传 |
| **通知** | 飞书通知 QA 团队 |

#### 3. Candidate 阶段

| 项目 | 说明 |
|------|------|
| **触发方式** | 手动触发 `candidate-promotion.yml` |
| **输入参数** | nightly_tag, target_version |
| **流程步骤** | 回归测试 → 人工审批 → 打 RC 标签 → 合并 dev 到 main → 打正式标签 |
| **生成标签** | RC: `v{version}-rc`，正式: `v{version}` |
| **审批环境** | `candidate-approval` Environment |

#### 4. 正式发布

| 项目 | 说明 |
|------|------|
| **触发方式** | Push `v*` 标签（如 `v1.2.0`） |
| **构建平台** | mac-arm64, windows-x64 |
| **生成标签** | `v{version}` |
| **产物位置** | GitHub Release（正式版） |
| **COS 上传** | ✅ 上传到 `sudowork/release/latest/` |
| **维护分支** | 自动创建 `release-v{X.Y}` |

#### 5. Hotfix 阶段

| 项目 | 说明 |
|------|------|
| **触发方式** | Push 到 `release-v{X.Y}` 分支 |
| **流程步骤** | 构建 → 自动打 tag → 正式发布 → 创建同步 PR |
| **生成标签** | `v{version}.{patch+1}` |
| **COS 上传** | ✅ 上传 |
| **同步回流** | PR 到 `main` 和 `dev` |

---

## 标签命名规范

### 标签类型

| 标签类型 | 格式 | 示例 | 用途 |
|---------|------|------|------|
| **开发构建** | `dev-{commit}` | `dev-a1b2c3d` | 开发阶段验证构建 |
| **Nightly** | `nightly-{date}-{commit}` | `nightly-2026-04-01-abc123` | 每日构建测试版 |
| **RC** | `v{version}-rc` | `v1.2.0-rc` | Candidate 预发布 |
| **正式版** | `v{version}` | `v1.2.0` | 正式发布 |
| **Hotfix** | `v{version}.{patch}` | `v1.2.1` | 紧急修复版本 |

### 版本号规则

```
v{MAJOR}.{MINOR}.{PATCH}

MAJOR - 重大版本变更（不兼容的 API 变更）
MINOR - 次版本号（向下兼容的功能新增）
PATCH - 补丁版本（向下兼容的问题修复）
```

**示例**：
- `v1.0.0` - 首个正式版本
- `v1.1.0` - 新增功能
- `v1.1.1` - Bug 修复
- `v1.1.2` - Hotfix 修复

---

## CI/CD Workflows

### Workflow 文件

| 文件 | 用途 | 触发方式 |
|------|------|---------|
| `build-and-release.yml` | 开发构建 & 正式发布 | 手动触发 / Tag 推送 |
| `build-nightly.yml` | 每日构建 | 定时 / 手动 |
| `candidate-promotion.yml` | Candidate 晋升 | 手动触发 |
| `hotfix.yml` | Hotfix 流程 | Push 到 release-* 分支 |
| `pr-checks.yml` | PR 检查 | PR 到 dev/main |
| `_build-reusable.yml` | 构建复用模块 | 被其他 workflow 调用 |

### 快速操作指南

#### 手动触发开发构建

```yaml
# GitHub Actions → Build and Release → Run workflow
branch: dev
skip_code_quality: false
```

#### 手动触发 Nightly 构建

```yaml
# GitHub Actions → Nightly Build Release → Run workflow
branch: main
platform: all
skip_code_quality: true
```

#### 手动触发 Candidate 流程

```yaml
# GitHub Actions → Candidate Promotion → Run workflow
nightly_tag: nightly-2026-04-01-abc123
target_version: 1.2.0
```

#### 创建 Hotfix

```bash
# 1. 切换到维护分支
git checkout release-v1.2

# 2. 添加修复提交
git add .
git commit -m "fix: critical bug fix"

# 3. 推送触发 hotfix workflow
git push origin release-v1.2
```

---

## 子模块依赖管理

### ai-dev-browser

[ai-dev-browser](https://github.com/sudoprivacy/ai-dev-browser) 是浏览器自动化核心库，作为 git submodule 位于 `vendor/ai-dev-browser`。

**版本策略**：pin 到 release tag，不追踪 master。

| 项目 | 说明 |
|------|------|
| **当前版本** | v0.2.0 |
| **路径** | `vendor/ai-dev-browser` |
| **更新方式** | 手动 checkout tag，或通过 GitHub Actions workflow |

#### 手动更新

```bash
cd vendor/ai-dev-browser
git fetch origin --tags
git checkout v0.3.0            # 替换为目标版本
cd ../..
git add vendor/ai-dev-browser
git commit -m "chore(deps): update ai-dev-browser to v0.3.0"
```

#### 通过 GitHub Actions 更新

```yaml
# GitHub Actions → Update ai-dev-browser → Run workflow
tag: v0.3.0
```

会自动创建 PR 到 dev 分支，CI 通过后合并即可。

#### v0.2.0 关键变更

- `find` 重命名为 `page_find`，`scroll` 重命名为 `page_scroll`
- `mouse_click`/`mouse_move`/`mouse_drag` 新增 `--screenshot` 参数，传截图路径自动换算坐标
- `page_screenshot` 默认 `max_long_edge=1280`（之前 1568），`max_total_pixels=1,150,000`
- 新增环境变量 `AI_DEV_BROWSER_PORT`、`AI_DEV_BROWSER_HEADLESS`、`AI_DEV_BROWSER_REDIRECT`
- nodriver 已完全移除，依赖改为 websockets

#### Sudowork 侧的封装

Sudowork 通过 `tests/e2e/ops/` 对 ai-dev-browser API 进行二次封装，对齐 [W3C WebDriver Actions API](https://w3c.github.io/webdriver/#actions)。Doctor QA agent 使用 `python tests/e2e/run_op.py` 作为唯一的浏览器交互入口。

---

## CI/CD Workflows

### Workflow 文件

| 文件 | 用途 | 触发方式 |
|------|------|---------|
| `build-and-release.yml` | 开发构建 & 正式发布 | 手动触发 / Tag 推送 |
| `build-nightly.yml` | 每日构建 | 定时 / 手动 |
| `candidate-promotion.yml` | Candidate 晋升 | 手动触发 |
| `hotfix.yml` | Hotfix 流程 | Push 到 release-* 分支 |
| `pr-checks.yml` | PR 检查 | PR 到 dev/main |
| `update-ai-dev-browser.yml` | 更新 ai-dev-browser submodule | 手动触发 |
| `_build-reusable.yml` | 构建复用模块 | 被其他 workflow 调用 |
