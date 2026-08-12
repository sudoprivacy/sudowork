# Gemini 相关代码审计

> 审计日期：2026-08-12
>
> 本文记录 Sudowork 当前 Gemini 相关代码的实际用途、运行状态和清理边界。重点区分：
>
> 1. Gemini 作为独立 Agent；
> 2. Gemini 作为模型/API 协议；
> 3. Google OAuth 与 Gemini CLI 辅助能力；
> 4. 历史兼容代码和疑似死代码。

## 1. 结论

当前 Sudowork **没有把 Gemini 作为默认或可见的独立 Agent 使用**，主会话运行时是 Scode ACP：

```text
brand.defaultAgentId = gewu
→ presetAgentType = scode
→ 创建 type=acp 的 Conversation
→ AcpAgent / Scode ACP 运行时
```

但是，项目仍然保留以下 Gemini 相关代码，其中一部分有明确生产调用链，另一部分仅确认实现或 IPC 仍存在：

- SudoRouter 默认 Gemini 文本、视觉和图片模型；
- 通过 SudoRouter 凭据调用 Gemini-shaped API 的图片生成与图片编辑；
- Google OAuth 登录、状态查询和退出；
- Google Auth 虚拟模型 Provider UI；
- Gemini 原生模型发现和协议检测实现（当前生产调用链待核验）；
- Gemini 订阅状态占位查询（结果未被消费）；
- 对外部官方 Gemini CLI 的 MCP 配置管理；
- 旧 Gemini Conversation、Agent 类型和配置的兼容处理。

因此，不能把所有包含 `gemini` 的代码整体删除。正确边界是：

```text
Gemini 独立 Agent：已关闭，但仍有类型、工作区写入和历史兼容遗留
Gemini SudoRouter 模型：仍是默认文本、视觉和图片模型的一部分，需要保留
Gemini 原生 Provider 协议：实现仍存在，但当前生产调用链不明确，需要端到端核验
Google OAuth：登录和虚拟 Provider UI 仍存在，但未证实可供当前 Scode 会话执行模型
Gemini Subscription：存在凭据检查调用，但结果未被消费，属于疑似冗余链路
外部 Gemini CLI MCP：仍有运行链路，需要先确认产品需求
历史迁移：必须保留
疑似孤儿 Adapter：可优先做死代码核验
```

## 2. 当前主会话运行链路

### 2.1 默认 Assistant 使用 Scode

品牌配置指定默认 Assistant：

```text
brand.config.json
└── defaultAgentId: "gewu"
```

`gewu` 的预设配置明确使用 Scode：

```text
src/common/presets/assistantPresets.ts
└── id: 'gewu'
    └── presetAgentType: 'scode'
```

预设 Agent 的全局默认值也已经是 Scode：

```text
src/types/acpTypes.ts
└── DEFAULT_PRESET_AGENT_TYPE = 'scode'
```

### 2.2 Conversation 统一走 ACP

Guid 创建本地会话时使用：

```text
src/renderer/pages/guid/hooks/useGuidSend.ts
└── type: 'acp'
```

主进程统一交给 ACP Agent 创建：

```text
src/process/services/conversationService.ts
└── type === 'acp'
    └── createAcpAgent(params)
```

对于非 Gemini 后端，Guid 不会把旧的 Gemini UI Provider 传给 Conversation，而是让 ACP 后端自行解析模型：

```text
const isGeminiBackend = acpBackend === 'gemini';
model: isGeminiBackend ? currentModel : {};
```

因此正常的 `gewu → scode` 链路不依赖 Gemini 独立 Agent。

## 3. Gemini 独立 Agent 状态

### 3.1 后端已禁用

Gemini 后端仍保留在统一类型和配置表中，但明确禁用：

```text
src/types/acpTypes.ts
└── ACP_BACKENDS_ALL.gemini
    ├── cliCommand: 'gemini'
    ├── authRequired: true
    └── enabled: false
```

代码注释说明当前产品定位是：Gemini 通过模型平台/API Key 使用，而不是作为独立 Agent 后端。

### 3.2 UI 主动过滤

Renderer 的 Agent 可见列表会过滤 Gemini：

```text
src/renderer/shared/agents/availableAgents.ts
└── filterAvailableAgentsForUi()
    └── agent.backend !== 'gemini'
```

对应测试：

```text
tests/unit/availableAgents.test.ts
```

普通用户当前无法通过 Agent 选择器新建 Gemini CLI Conversation。

### 3.3 类型仍保留 Gemini

以下类型仍包含 Gemini：

```text
src/types/acpTypes.ts
├── PresetAgentType
├── AcpBackendAll
├── ACP_BACKENDS_ALL
└── AcpResumeStrategy 相关逻辑
```

这部分同时承担旧配置、旧 Conversation 和外部 Gemini CLI 的兼容职责，不能仅因为 UI 已隐藏就直接删除。

## 4. Gemini 模型/API 能力

### 4.1 模型列表与协议检测

`modelBridge` 仍支持 Gemini 原生协议：

```text
src/process/bridge/modelBridge.ts
```

主要能力包括：

- 从 `generativelanguage.googleapis.com/v1beta/models` 获取模型列表；
- 支持自定义 Gemini Base URL；
- 检测 Gemini API 协议；
- 测试 API Key 和模型可用性；
- 在检测到 Gemini 协议时提示切换 Provider 平台。

相关通用协议识别位于：

```text
src/common/utils/protocolDetector.ts
src/common/utils/platformAuthType.ts
```

这部分属于模型 Provider 能力，不等于 Gemini Agent。但当前仓库内未找到
`detectProtocol` 的明确生产调用方；模型设置页当前按 `custom` / OpenAI 兼容协议
路径获取模型列表。因此应将这部分标记为“实现仍存在、调用链待核验”，不能直接断言
“当前仍在使用”。

### 4.2 Scode/SudoRouter 中的 Gemini 模型

Scode/SudoRouter 的默认配置和同步逻辑仍使用 Gemini 模型 ID，例如：

```text
gemini-3-flash-preview
gemini-3.5-flash
gemini-3-pro-image
```

相关生产配置和同步主要位于：

```text
src/process/services/sudoclaw/
src/process/services/scode/
src/renderer/pages/settings/models/
src/common/storage.ts
src/common/sudoclawModelConfig.ts
src/common/imageGenerationModelConfig.ts
src/process/services/sudoclaw/SudoclawInstallService.ts
src/process/services/serviceManager/ServiceManager.ts
src/renderer/context/AuthContext.tsx
```

其中包括默认看图模型 `gemini-3.5-flash`、默认生图模型
`gemini-3.1-flash-image`，以及 Gemini 模型对应的 `google-generative-ai` API 类型和
视觉输入能力。大量测试中的 Gemini 字符串属于 Scode/SudoRouter 模型夹具，不代表
Gemini 独立 Agent 仍启用，例如：

```text
tests/unit/scodeConfig.test.ts
tests/unit/scodeProxyModels.test.ts
tests/unit/sudoclawModelConfig.test.ts
tests/unit/sudoclawRuntimeSync.test.ts
tests/unit/ScodeAcpConnector.test.ts
```

### 4.3 图片生成与编辑

Gemini 图片模型仍有直接生产实现：

```text
src/process/bridge/imageGenerationBridge.ts
```

当前支持的 Gemini 图片模型集合包括：

```text
gemini-3.1-flash-image
gemini-3-pro-image
gemini-2.5-flash-image
```

代码会调用 Gemini `generateContent` 接口，并处理：

- 文生图；
- 带输入图片的图片编辑；
- 图片尺寸和宽高比；
- Gemini `inlineData` 响应。

当前代码的凭据解析和回退逻辑围绕 SudoRouter 配置，不是任意 Gemini API Key Provider：

```text
src/process/bridge/imageGenerationBridge.ts
└── 读取 sudocode.json / sudoclaw.json 中的 SudoRouter 凭据
    └── 回退时只接受 SudoRouter Base URL 的 Provider
```

因此，只要产品仍支持 SudoRouter 上的 Gemini 图片模型，这条链路就必须保留。验证时
应测试 SudoRouter 路由，而不能泛化为任意 Gemini API Provider。

## 5. Google OAuth 与 Gemini 设置

### 5.1 设置页隐藏但路由存在

Gemini 设置页仍注册在路由中：

```text
src/renderer/router.tsx
└── /settings/gemini
```

页面实现：

```text
src/renderer/pages/settings/gemini/index.tsx
```

它当前没有进入 `SettingsSider` 的菜单白名单，所以侧栏不可见。非企业模式下用户
可以直接访问对应 Hash Route；企业模式不在允许路径中，直达时会被重定向。

页面支持：

- Google 登录；
- Google 登录状态查询；
- Google 退出；
- Proxy 配置；
- 按账号保存 `GOOGLE_CLOUD_PROJECT`；
- `gemini.config` 本地配置读写。

### 5.2 主进程 OAuth 链路仍初始化

Google OAuth IPC 定义：

```text
src/common/ipcBridge.ts
└── googleAuth.status/login/logout
```

主进程实现：

```text
src/process/bridge/authBridge.ts
```

Bridge 会随主进程 Bridge 集合初始化：

```text
src/process/bridge/index.ts
└── initAuthBridge()
```

底层依赖 `@office-ai/aioncli-core` 提供 OAuth Credential 路径、登录和缓存凭据管理。

### 5.3 Google Auth 虚拟 Provider

Renderer 会根据 Google 登录状态合成一个虚拟 Provider：

```text
src/renderer/hooks/useGeminiGoogleAuthModels.ts
src/renderer/hooks/useAvailableModels.ts
```

虚拟 Provider 的平台标识为：

```text
gemini-with-google-auth
```

稳定 Provider ID 定义为：

```text
src/common/constants.ts
└── GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini'
```

该 Provider 目前参与 Renderer 和渠道设置中的 Provider/模型选择 UI：

- 可用模型判定；
- Guid 模型列表与旧选择逻辑；
- 渠道模型 Provider 列表和模型选择。

但正常的 `gewu → scode` Conversation 创建不会把该 Provider 作为 Scode 会话参数传入。
渠道运行时也明确不支持 Google Auth Provider：如果用户在渠道设置中选择它，主进程
会尝试降级到有 API Key 的 Gemini Provider，最终 ACP 会话仍可能忽略该模型参数。

### 5.4 订阅状态查询

订阅状态服务：

```text
src/process/services/geminiSubscription.ts
```

IPC Bridge：

```text
src/process/bridge/geminiBridge.ts
src/common/ipcBridge.ts
```

Renderer 调用方：

```text
src/renderer/hooks/useGeminiGoogleAuthModels.ts
```

该服务只检查 OAuth Credential，并缓存查询结果。目前返回的信息较保守，无法在不触发完整登录流程的情况下可靠判断真实订阅等级；且订阅结果没有参与模型选项或 UI 分级，属于疑似冗余链路，是否保留应单独核验。

## 6. 外部官方 Gemini CLI 的 MCP 支持

项目仍保留对用户机器上官方 `gemini` CLI 的 MCP 配置管理：

```text
src/process/services/mcpServices/agents/GeminiMcpAgent.ts
```

它通过 Gemini CLI 的 MCP 子命令完成：

- 检测 MCP Server；
- 安装/同步 MCP Server；
- 删除 MCP Server；
- 测试 Transport；
- 读取可用 Tools。

`McpService` 会注册该实现：

```text
src/process/services/mcpServices/McpService.ts
└── ['gemini', new GeminiMcpAgent()]
```

同时，`McpService` 还会检测本机是否存在原生 `gemini` 命令，并在 MCP 管理流程中临时加入：

```text
backend: 'gemini'
cliPath: 'gemini'
```

这条链路不是 Gemini Conversation 运行时，但仍属于可执行的产品功能。若要删除，必须先决定“工具设置是否还需要同步外部 Gemini CLI 的 MCP 配置”。

## 7. 历史兼容代码

### 7.1 数据库迁移必须保留

旧版本数据库允许 `type='gemini'` 的 Conversation 和 Session。后续迁移将它们统一转换为 ACP：

```text
src/process/database/migrations.ts
```

核心迁移逻辑：

```text
旧 conversation.type = gemini
→ conversation.type = acp
→ extra.backend = gemini
```

并将旧 `assistant_sessions.agent_type='gemini'` 转为 `acp`。

迁移历史用于升级旧用户数据库，不应因当前 schema 已不使用 Gemini 类型而删除。

### 7.2 Resume 与旧会话兼容

以下测试仍覆盖 Gemini 输入下的通用 ACP Resume 策略：

```text
tests/unit/acpResumeStrategy.test.ts
```

测试只能证明 `gemini` 会落入通用默认 Resume 策略，不能证明官方 Gemini CLI 或历史会话
能够端到端恢复。如果历史数据库中仍可能存在已迁移为 `extra.backend='gemini'` 的会话，
数据库迁移必须保留；Resume 运行逻辑是否仍需保留，应通过真实旧会话进一步验证。

### 7.3 注释存在过时描述

`src/types/acpTypes.ts` 中部分注释仍描述：

```text
presetAgentType 缺失时默认 Gemini
```

但当前真实实现已经是：

```text
DEFAULT_PRESET_AGENT_TYPE = 'scode'
resolvePresetAgentBackend(undefined) = 'scode'
```

这些属于文档债务，后续可单独修正，不需要改变运行逻辑。

## 8. Gemini Agent 遗留与疑似孤儿代码

Gemini backend 虽然已禁用，但仍有专属工作区写入逻辑：

```text
src/process/task/presetRuntime.ts
└── backend === 'gemini' 时写入 .gemini/settings.json

src/process/task/AcpAgent.ts
└── backend === 'gemini' 时写入 GEMINI.md
```

如果目标是彻底下线 Gemini 独立 Agent，这两处应与类型和 Resume 兼容逻辑一起核验。
它们当前近似不可达，但不能与数据库迁移一并简单删除。

### 8.1 疑似孤儿 Adapter

以下 Adapter 链目前只发现内部互相引用，没有发现生产业务调用 `ClientFactory.createRotatingClient()`：

```text
src/common/ClientFactory.ts
src/common/adapters/GeminiRotatingClient.ts
src/common/adapters/OpenAI2GeminiConverter.ts
src/common/adapters/index.ts
```

依赖关系为：

```text
ClientFactory
→ GeminiRotatingClient
→ OpenAI2GeminiConverter
→ @google/genai
```

当前图片生成走 `imageGenerationBridge.ts` 的直接 HTTP 实现；Scode/SudoRouter 也不经过这套 Adapter。

因此，这组文件是优先级最高的死代码核验候选。删除前仍需执行：

1. 全仓导入/导出引用检查；
2. `knip` 检查；
3. Electron 主进程动态加载检查；
4. TypeScript 编译和相关测试；
5. 确认扩展 API 没有把 `common/adapters` 当作公开入口。

## 9. 疑似遗留构建流程

仓库仍包含 Gemini CLI 下载和发布脚本：

```text
scripts/download-gemini-cli.js
.github/workflows/download-resources.yml
```

Workflow 会构建并上传短期 GitHub Actions Artifact；只有显式设置 `create_release`
并提供 `tag_name` 时，才会发布多个平台的 `gemini-cli-*.tgz` Release Asset。

当前审计未在 Electron Builder 配置或生产安装服务中找到消费这些归档的引用。因此它们可能是旧的内置 Gemini CLI 打包流程残留。

在删除前需要确认：

- 是否有外部 CI/发布流程下载这些 Release Asset；
- 是否有未纳入当前仓库的部署脚本依赖该命名；
- 离线包是否曾通过约定路径而非代码引用读取该文件。

## 10. 依赖清理边界

### 10.1 `@google/genai`

当前只发现以下链路直接导入：

```text
GeminiRotatingClient.ts
```

如果确认整套 ClientFactory/Rotating Adapter 为死代码，可以一并评估删除 `@google/genai`。

Gemini 图片生成当前使用原生 `fetch`，不依赖 `@google/genai`，但它仍依赖 SudoRouter
配置和 Gemini-shaped `generateContent` 请求格式。

### 10.2 `@office-ai/aioncli-core`

不能因为下线 Gemini Agent 就直接删除该依赖。它仍被用于：

- Google OAuth；
- Gemini Subscription Credential 检查；
- MCP/OAuth 等通用能力；
- AuthType 和其他运行时工具。

必须按实际 Import 逐项迁移后才能评估删除。

## 11. 文件分类清单

### 11.1 当前需要保留

| 分类 | 主要文件 | 原因 |
|---|---|---|
| SudoRouter 默认模型 | `src/common/storage.ts`、`src/common/sudoclawModelConfig.ts` | Gemini 文本、视觉和图片模型仍是默认配置的一部分 |
| 模型同步 | `src/process/services/sudoclaw/`、`src/process/services/serviceManager/ServiceManager.ts` | 安装、登录和 Gateway 启动时同步 Gemini 模型配置 |
| 图片生成 | `src/process/bridge/imageGenerationBridge.ts` | 通过 SudoRouter 凭据调用 Gemini-shaped 图片模型生产链路 |
| Google OAuth | `src/process/bridge/authBridge.ts` | 登录、状态、退出仍初始化 |
| OAuth UI Hook | `src/renderer/hooks/useGeminiGoogleAuthModels.ts` | 生成 Google Auth 模型选项，但未证实被 Scode 执行链路消费 |
| 模型可用性 | `src/renderer/hooks/useAvailableModels.ts` | 虚拟 Provider 参与可用模型判定 |
| 外部 CLI MCP | `src/process/services/mcpServices/agents/GeminiMcpAgent.ts` | 工具设置仍可检测本机 Gemini CLI |
| 数据迁移 | `src/process/database/migrations.ts` | 旧用户数据库升级需要 |

### 11.2 实现存在但调用链待核验

| 分类 | 主要文件 | 当前判断 |
|---|---|---|
| Gemini 原生模型发现 | `src/process/bridge/modelBridge.ts` | IPC 和 Gemini 分支仍存在，但当前生产 UI 调用方不明确 |
| Gemini 协议检测 | `src/common/utils/protocolDetector.ts`、`modelBridge.ts` | 能力已注册，但未找到明确 Renderer 调用方 |
| Gemini Subscription | `src/process/bridge/geminiBridge.ts`、`src/process/services/geminiSubscription.ts` | 只检查缓存凭据，结果未参与模型分级或选项生成 |
| Gemini Resume | `src/types/acpTypes.ts`、`tests/unit/acpResumeStrategy.test.ts` | 仅验证通用默认策略，历史会话端到端恢复未验证 |

### 11.3 产品决策后可移除

| 分类 | 主要文件 | 删除前置条件 |
|---|---|---|
| Gemini 设置页 | `src/renderer/pages/settings/gemini/` | 决定不再支持 Google OAuth |
| Gemini Route | `src/renderer/router.tsx` 中 `/settings/gemini` | 同上 |
| Google Auth IPC | `authBridge.ts`、`ipcBridge.ts` | 无其他功能依赖 Google OAuth |
| Google Auth Provider | `useGeminiGoogleAuthModels.ts` 等 | Guid/渠道不再接受该 Provider |
| Gemini Subscription | `geminiBridge.ts`、`geminiSubscription.ts` | 确认不再需要 OAuth 凭据检查及其占位结果 |
| 外部 Gemini CLI MCP | `GeminiMcpAgent.ts`、`McpService.ts` 对应分支 | 工具设置明确不再同步该 CLI |
| Gemini Logo/i18n | `renderer/assets/logos/gemini.svg`、Gemini locale | 所有 UI/兼容展示均移除 |

### 11.4 优先核验的死代码候选

```text
src/common/ClientFactory.ts
src/common/adapters/GeminiRotatingClient.ts
src/common/adapters/OpenAI2GeminiConverter.ts
src/process/task/presetRuntime.ts 中 Gemini 配置写入分支
src/process/task/AcpAgent.ts 中 GEMINI.md 写入分支
scripts/download-gemini-cli.js
.github/workflows/download-resources.yml 中 Gemini CLI 任务
```

## 12. 建议的清理顺序

若后续目标是“彻底下线 Gemini 独立 Agent，但保留 SudoRouter 上的 Gemini 模型”，建议按以下顺序处理：

1. **清理疑似孤儿 Adapter**
   - 核验并删除 ClientFactory/GeminiRotatingClient/OpenAI2GeminiConverter；
   - 若无剩余引用，删除 `@google/genai`。

2. **清理遗留 Gemini CLI 打包流程**
   - 确认 Release Asset 无外部消费者；
   - 删除下载脚本与 Workflow 对应步骤。

3. **修正类型和注释债务**
   - 更新“缺失 presetAgentType 默认 Gemini”等过时注释；
   - 保留数据库迁移和必要兼容类型。

4. **先验证再决定 Google OAuth 产品能力**
   - 先确认 OAuth Provider 是否存在可用的端到端推理调用方；
   - 如果只保留 API Key/SudoRouter，则整条 OAuth 链可以作为独立任务删除；
   - 同时处理 Guid/渠道设置仍展示 OAuth Provider、但渠道运行时会降级或忽略的问题。

5. **单独决定外部 Gemini CLI MCP 支持**
   - 不应与 Gemini 模型支持绑定；
   - 删除时同步清理 `McpService` 的检测、注册、同步和删除分支。

## 13. 验证建议

任何 Gemini 清理任务至少应运行：

```bash
bunx tsc --noEmit
bun run test
bun run lint
```

并重点验证：

- Scode Assistant 可以创建和恢复 Conversation；
- SudoRouter 中 Gemini 文本/视觉模型仍可配置；
- Gemini 图片生成和图片编辑仍可调用；
- 若保留 Gemini 原生协议能力，验证模型发现和协议检测的真实调用方；
- 旧数据库可以从历史版本迁移；
- 工具设置中的 MCP 同步没有残留 Gemini 分支错误；
- 打包流程不再引用已删除资源。

## 14. 一句话理解

```text
当前项目不是“没有 Gemini”，而是“没有启用 Gemini 独立 Agent”。
Gemini 仍作为 SudoRouter 默认模型、图片模型和外部 CLI MCP 能力存在；Google OAuth
与原生 Gemini 协议代码仍在，但其当前生产调用链和实际可用性需要单独核验。
```
