# Codex 相关代码审计与清理建议

> 审计日期：2026-08-13
>
> 本文记录 Sudowork 当前 Codex 相关代码的实际用途、运行状态、数据兼容风险和建议清理边界。本文重点区分：
>
> 1. Codex 作为 ACP Agent 后端；
> 2. 历史原生 Codex Conversation 实现；
> 3. Codex CLI 的 MCP 配置管理；
> 4. Codex 模型 ID 与通用 OpenAI Provider；
> 5. 历史 Codex 消息渲染和持久化兼容。

## 1. 结论

当前 Codex 的状态不是“已删除”，而是：

```text
普通 UI 和自动检测：已关闭
Codex ACP 运行时：完整保留，仍可被旧数据和内部调用启动
旧 src/agent/codex 实现：大部分已失去 Conversation 入口
Codex CLI MCP：实现仍注册，但普通设置流程通常不会触发
历史 Codex 消息：仍可能从数据库加载并由 Renderer 展示
Codex 模型 ID：属于通用模型能力，不能随 Agent 一起删除
```

默认 Assistant 和 Channel 都使用 Scode：

```text
DEFAULT_PRESET_AGENT_TYPE = 'scode'
CHANNEL_DEFAULT_AGENT_BACKEND = 'scode'
brand.defaultAgentId = gewu
```

Codex backend 仍注册在完整 ACP 配置中，但明确禁用：

```text
src/types/acpTypes.ts
└── ACP_BACKENDS_ALL.codex
    ├── cliCommand: 'codex'
    ├── defaultCliPath: npx @zed-industries/codex-acp@0.9.5
    ├── authRequired: true
    └── enabled: false
```

`enabled: false` 只会阻止普通自动检测，不会阻止旧 Conversation、Team、Cron、Channel 或直接 IPC 继续传入 `backend='codex'`。因此，不能仅删除类型和 Connector，必须先决定旧数据策略并收紧深层创建边界。

## 2. 当前 Codex ACP 运行链路

### 2.1 自动检测和普通 UI 已关闭

可检测 CLI 列表只包含启用的 backend：

```text
src/types/acpTypes.ts
└── generatePotentialAcpClis()
    └── config.enabled === true
```

由于 Codex 为 `enabled: false`，本机即使安装了 `codex` 命令，`AcpDetector` 的正常扫描也不会返回 Codex。

当前 Guid 主 Agent 选择也被锁定为 Scode：

```text
src/renderer/pages/guid/components/AssistantAgentDropdown.tsx
└── disabled = true
```

源码中仍有 Codex 选项，但正常用户无法切换：

```text
BUILTIN_AGENT_OPTIONS
└── { value: 'codex', label: 'Codex' }
```

企业模式下：

- Remote 模式固定使用 `remote-agent`；
- Local 模式固定使用 `scode`。

因此，当前普通 UI 不会新建 Codex Conversation。

### 2.2 深层创建边界仍接受 Codex

所有本地 Agent Conversation 统一使用：

```text
type = acp
extra.backend = 实际 Agent backend
```

相关文件：

```text
src/renderer/pages/conversation/utils/createConversationParams.ts
src/process/services/conversationService.ts
src/process/initAgent.ts
```

`ConversationService` 不检查 backend 是否启用或是否被 Detector 检测到。因此内部调用、扩展、测试或旧配置仍可创建：

```ts
{
  type: 'acp',
  extra: { backend: 'codex' },
}
```

### 2.3 已存在的 Codex Conversation 仍可运行

`WorkerManage` 会把所有 `type='acp'` Conversation 构造成 `AcpAgent`：

```text
src/process/WorkerManage.ts
└── conversation.type === 'acp'
    └── new AcpAgent({ ...conversation.extra })
```

`AcpAgent` 从完整的 `ACP_BACKENDS_ALL` 读取 backend 配置，不检查 `enabled`：

```text
src/process/task/AcpAgent.ts
└── ACP_BACKENDS_ALL[backend]
```

所以数据库中已有：

```json
{
  "type": "acp",
  "extra": {
    "backend": "codex"
  }
}
```

仍会尝试启动真实 Codex ACP 运行时。

## 3. Codex ACP Connector

### 3.1 当前实际 Conversation 使用 codex-acp

当前生产 Conversation 不使用旧 `src/agent/codex/CodexAgent`，而是：

```text
AcpAgent
→ AcpConnection
→ connectCodex()
→ npx @zed-industries/codex-acp@0.9.5
→ 本机 codex CLI
```

主要文件：

```text
src/types/acpTypes.ts
src/agent/acp/AcpConnection.ts
src/agent/acp/acpConnectors.ts
src/process/task/AcpAgent.ts
```

`prepareCodex()` 当前会：

- 要求 Node.js 20.10+；
- 检查 `codex --version`；
- 检查 `codex login status`；
- 检查 `CODEX_API_KEY`；
- 准备 `codex-acp` 的 npx 启动环境。

### 3.2 Session 和 Resume 仍完整实现

Codex 使用 ACP 标准 `session/load`：

```text
getAcpResumeStrategy('codex') = 'session-load'
```

相关持久化字段：

```text
extra.acpSessionId
extra.acpSessionUpdatedAt
extra.currentModelId
extra.sessionMode
```

`AcpConnection` 的注释明确描述 `codex-acp` 会从 rollout 恢复 Thread。因此旧 Codex Conversation 当前不只是“能打开”，而是仍会尝试恢复原 Codex Session。

### 3.3 模型发现和切换仍保留

Codex 模型信息来源包括：

1. ACP Session capabilities 中的 `models` / `configOptions`；
2. Renderer 的 Codex 默认模型回退列表。

默认列表位于：

```text
src/common/codex/codexModels.ts
```

当前包含例如：

```text
gpt-5.3-codex
gpt-5.4
gpt-5.2-codex
gpt-5.1-codex-max
gpt-5.1-codex-mini
```

Renderer 仍有 Codex 专属探测和缓存回退：

```text
src/renderer/pages/guid/hooks/useGuidAgentSelection.ts
src/renderer/components/AcpModelSelector.tsx
```

这些代码普通 UI 下基本不可达，但如果旧数据或内部调用产生 Codex backend，就会参与运行。

## 4. 仍可触发 Codex 的非 UI 路径

### 4.1 Team 是最明确的创建旁路

Team Assistant 合并逻辑会直接解析 Assistant 的 `presetAgentType`：

```text
src/process/services/team/assistantMerger.ts
└── resolvePresetAgentBackend(meta.presetAgentType)
```

如果安装的 Assistant 元数据包含：

```json
{
  "presetAgentType": "codex"
}
```

Team 可能将它展示并创建为真实 Codex Team Member。

另外，TeamService 判断裸 backend 是否已知时使用 `ACP_BACKENDS_ALL`，所以直接请求 `assistantId='codex'` 也可能被接受，即使 Codex 为禁用状态。

Team 创建后会：

```text
创建 type=acp Conversation
→ extra.backend=codex
→ new AcpAgent
→ connectCodex
```

### 4.2 Cron 中原始 Codex 任务仍可执行

带 `presetAssistantId` 的 Codex Assistant 通常会因 Detector 中没有 Codex而回退到 Scode。

但历史或直接写入的任务如果是：

```text
cron_jobs.agent_type = codex
preset_assistant_id = NULL
```

执行时不会经过 Assistant 可用性回退，仍可能创建 Codex ACP Conversation。

相关文件：

```text
src/process/services/cron/CronStore.ts
src/process/services/cron/CronService.ts
```

### 4.3 Channel 的旧 backend 配置仍可执行

Channel UI 当前只展示 Scode，但持久化类型仍允许任意 `AcpBackendAll`。

运行时读取：

```text
assistant.telegram.agent
assistant.lark.agent
assistant.dingtalk.agent
assistant.wechat.agent
assistant.wecom.agent
```

如果旧配置仍是 `backend='codex'`，Channel 会创建 Codex ACP Conversation。当前 Channel migration 只处理 `openclaw-gateway` 和 `gemini`，没有处理 Codex。

### 4.4 直接 MCP IPC 仍可调用 Codex CLI

MCP 设置正常情况下使用 Detector 返回的 Agent，所以通常不会传入 Codex。

但 MCP Bridge 信任调用方传入的 Agent 数组。直接调用时可传入：

```ts
{ backend: 'codex', name: 'Codex' }
```

从而执行 Codex CLI MCP 命令。

### 4.5 模型 Probe 是独立的 ACP 启动旁路

`probeModelInfo` 会先查询 Detector，但对 Codex 明确放宽 `cliPath` 检查：

```text
src/process/bridge/acpConversationBridge.ts
└── probeModelInfo({ backend: 'codex' })
    ├── Detector 中没有 Codex，也继续执行
    ├── new AcpConnection()
    ├── connection.connect('codex')
    └── connection.newSession()
```

因此它会直接走默认 npx Connector，启动 `@zed-industries/codex-acp@0.9.5`。删除 Codex 时必须单独拒绝该 IPC 参数，不能依赖 Detector 或 UI 不再展示 Codex。

## 5. Codex CLI MCP 配置管理

Codex MCP Adapter：

```text
src/process/services/mcpServices/agents/CodexMcpAgent.ts
```

注册位置：

```text
src/process/services/mcpServices/McpService.ts
└── ['codex', new CodexMcpAgent()]
```

支持：

- `codex mcp list`；
- `codex mcp add`；
- `codex mcp remove`；
- stdio；
- HTTP / streamable HTTP。

这条链路与 Codex Conversation 的 ACP Transport 不同。即使决定删除 Codex Agent，也需要单独决定是否继续允许“工具设置同步用户机器上的 Codex CLI MCP 配置”。

## 6. 历史原生 Codex 实现

### 6.1 目录仍完整存在

```text
src/agent/codex/
├── core/CodexAgent.ts
├── core/ApprovalStore.ts
├── core/ErrorService.ts
├── connection/CodexConnection.ts
├── handlers/CodexEventHandler.ts
├── handlers/CodexToolHandlers.ts
├── handlers/CodexSessionManager.ts
├── handlers/CodexFileOperationHandler.ts
├── messaging/CodexMessageProcessor.ts
├── messaging/CodexMessageEmitter.ts
└── index.ts
```

Barrel 注释已经说明旧 Codex Conversation type 被删除：

```text
CodexAgentManager removed — legacy Codex conversation type deleted
```

### 6.2 大部分代码只有内部互相引用

当前没有发现生产代码构造：

```text
new CodexAgent()
new CodexEventHandler()
new CodexSessionManager()
new CodexFileOperationHandler()
```

因此以下是一组强死代码候选：

```text
src/agent/codex/index.ts
src/agent/codex/core/CodexAgent.ts
src/agent/codex/core/ApprovalStore.ts
src/agent/codex/handlers/CodexEventHandler.ts
src/agent/codex/handlers/CodexToolHandlers.ts
src/agent/codex/handlers/CodexSessionManager.ts
src/agent/codex/handlers/CodexFileOperationHandler.ts
src/agent/codex/messaging/CodexMessageProcessor.ts
src/agent/codex/messaging/CodexMessageEmitter.ts
```

### 6.3 CodexConnection 仍被健康检查引用

旧 `CodexConnection` 不是完全孤立：

```text
src/process/bridge/acpConversationBridge.ts
└── checkAgentHealth
    └── new CodexConnection()
```

这个健康检查会启动旧的 Codex MCP Server：

```text
codex mcp-server
或 codex mcp serve
```

但真实 Conversation 使用的是 `codex-acp`。代码注释仍称 Codex“使用 MCP 而不是 ACP”，已经与实际运行架构不一致。

此外，当前仓库未找到 Renderer 对 `checkAgentHealth.invoke()` 的调用方。它属于“IPC 已注册、当前 UI 调用链不明确”的能力。

建议先把健康检查删除，或改为使用与真实 Conversation 相同的 `AcpConnection.connect('codex')`；完成后再删除：

```text
src/agent/codex/connection/CodexConnection.ts
src/agent/codex/core/ErrorService.ts
src/common/codex/types/errorTypes.ts
```

## 7. 历史 Codex 消息兼容

### 7.1 数据库迁移只转换 Conversation，不转换 Message

Migration v16 会：

```text
conversation.type = codex
→ conversation.type = acp
→ extra.backend = codex
```

但历史 Message 行不会被转换。

数据库加载 Message 时直接将存储值转换为 `TMessage`，所以旧数据中的以下类型仍可能进入 Renderer：

```text
codex_permission
codex_tool_call
```

### 7.2 codex_tool_call 仍有完整 Renderer 支持

共享类型和合并逻辑：

```text
src/common/chatLib.ts
src/renderer/messages/hooks.ts
```

Renderer：

```text
src/renderer/messages/MessageList.tsx
src/renderer/messages/codex/MessageCodexToolCall.tsx
src/renderer/messages/codex/ToolCallComponent/
```

它仍可显示历史：

- 命令执行；
- Patch；
- MCP Tool；
- Web Search；
- Turn Diff；
- 命令输出。

当前 ACP Codex 会生成 `acp_tool_call`，不会再生成 `codex_tool_call`。因此这套 Renderer 是历史兼容代码，不是当前 Codex ACP 运行时。

如果要删除，必须先决定：

1. 保留历史工具详情；
2. 将旧 Message 转换成通用/ACP 格式；
3. 或明确接受旧工具详情不再展示。

### 7.3 codex_permission 当前只作为兼容壳存在

`MessageList` 对 `codex_permission` 直接返回 `null`，因为当前确认 UI 已由通用 ACP 流程管理。

删除风险低于 `codex_tool_call`，但旧数据库行仍会存在。即使移除类型，也建议保留显式忽略或在 hydration 时归一化，避免显示“未知消息类型”。

### 7.4 codex_model_info 是旧信号

旧 Producer：

```text
src/agent/codex/handlers/CodexEventHandler.ts
```

当前 ACP Codex 使用：

```text
acp_model_info
```

`codex_model_info` 仍被 `AcpModelSelector` 监听，但当前仓库没有活跃 Producer。它是低风险的协调清理候选。

## 8. `src/common/codex` 不能整目录删除

### 8.1 当前仍使用的文件

```text
src/common/codex/codexModels.ts
```

用于 Guid 中 Codex ACP 模型列表回退。

### 8.2 PermissionType 中有跨 Agent 能力

```text
src/common/codex/types/permissionTypes.ts
```

其中：

```ts
PermissionType.CREDENTIAL_AUTOLOGIN = 'credential_autologin'
```

仍被：

```text
src/process/services/pwdLogin/pwdLoginService.ts
```

使用。它已经不是 Codex 专属能力。删除 `src/common/codex` 前，应先把这个字符串和类型迁移到中立的权限模块，并保持序列化值不变。

### 8.3 历史 Message Payload 类型仍被 chatLib 使用

`src/common/codex/types/eventData.ts` 中部分类型被 `CodexToolCallUpdate` 引用，用于反序列化和展示历史 Message。

因此，应拆分为：

```text
当前 ACP/通用能力
历史 Message 兼容 Payload
真正无引用的旧 Manager/Event 类型
```

而不是整个删除目录。

### 8.4 疑似孤儿 Common 代码

以下主要服务旧 `CodexToolHandlers` / `CodexEventHandler`：

```text
src/common/codex/utils/toolUtils.ts
src/common/codex/types/toolTypes.ts
src/common/codex/types/eventTypes.ts
src/common/codex/utils/permissionUtils.ts
src/common/codex/utils/index.ts
```

其中 `permissionUtils.ts` 要在迁移 `CREDENTIAL_AUTOLOGIN` 后再删除。

## 9. Codex Renderer 目录的特殊边界

### 9.1 历史工具 Renderer

以下只服务历史 `codex_tool_call`：

```text
src/renderer/messages/codex/MessageCodexToolCall.tsx
src/renderer/messages/codex/ToolCallComponent/
```

是否删除取决于历史数据策略。

### 9.2 MessageFileChanges 不是 Codex 专属

```text
src/renderer/messages/codex/MessageFileChanges.tsx
```

当前还被通用 WriteFile UI 使用：

```text
src/renderer/messages/MessageToolGroup.tsx
```

也被 MessageList 的文件汇总使用。因此它不能随 Codex Renderer 目录一起删除。

建议先移动到中立目录，例如：

```text
src/renderer/messages/MessageFileChanges.tsx
```

再决定是否删除剩余 Codex Renderer。

## 10. Codex i18n、Logo 和配置

### 10.1 Codex i18n 模块

仓库仍注册完整 Codex i18n 模块：

```text
src/renderer/i18n/locales/*/codex.json
src/shared/i18n-config.json
src/renderer/i18n/locales/*/index.ts
```

当前大部分 key 只被旧 Permission/Error 代码引用。清理时必须原子执行：

1. 删除最后的 key 调用；
2. 从 `i18n-config.json` 移除 `codex`；
3. 从所有 Locale index 移除 import/export；
4. 删除所有 `codex.json`；
5. 运行 `bun run i18n:types`。

### 10.2 Codex Logo

```text
src/renderer/assets/logos/codex.svg
src/renderer/utils/agentLogo.ts
```

Logo 仍可能用于：

- 历史 Conversation；
- Guid 静态 Agent 图标；
- Team / Agent 状态展示。

如果完全移除 Codex Agent，可在历史展示策略确定后再删除。

### 10.3 旧 codex.config

```text
src/common/storage.ts
└── codex.config
```

当前未发现读写方。现有 ACP 配置使用：

```text
acp.config.codex
acp.cachedModels.codex
```

`codex.config` 是低风险类型清理候选；旧持久化 JSON 可留在磁盘中被忽略，无需专门数据库 migration。

## 11. 历史数据库兼容

### 11.1 Migration v16 必须保留

历史 migration 负责把旧 `type='codex'` Conversation 转成 ACP。不能因后续删除 Codex Agent 而删除或改写历史 migration。

### 11.2 当前 Codex 持久化位置

可能存在 Codex 状态的地方包括：

```text
conversations.extra.backend
conversations.extra.cliPath
conversations.extra.acpSessionId
conversations.extra.currentModelId
cron_jobs.agent_type
team_members.backend
team_members.preset_agent_type
assistant.<channel>.agent.backend
assistant metadata presetAgentType
acp.config.codex
acp.cachedModels.codex
guid.lastSelectedAgent
```

其中 `assistant_sessions.agent_type` 不是可靠的 Codex 标记。当前 Channel 创建统一使用：

```text
assistant_sessions.agent_type = acp
实际 backend = 关联 Conversation 的 extra.backend
```

历史 schema 虽允许 `assistant_sessions.agent_type='codex'`，但当前运行路径不会再写入该值。新 migration 可以把遗留值归一化为 `acp`，但不能用它判断关联 Conversation 是否为 Codex。

### 11.3 完全移除 Codex Agent 时的两种策略

#### 策略 A：迁移到 Scode

参考 Gemini v30 migration：

```text
extra.backend = codex
→ extra.backend = scode
→ 删除 cliPath / acpSessionId / acpSessionUpdatedAt
```

同时迁移：

```text
cron_jobs.agent_type: codex → scode
team_members.backend: codex → scode
team_members.preset_agent_type: codex → scode
Channel agent backend: codex → scode
Assistant presetAgentType: codex → scode
```

优点：旧 Conversation 仍可继续发送。

缺点：无法真正恢复原 Codex Session，运行语义发生变化。

#### 策略 B：保留为只读历史 Conversation

保留 `backend='codex'` 作为历史标记，但：

- 不构造 Worker；
- 禁止发送和 Resume；
- 禁止 Cron 复用；
- 禁止 Team 恢复；
- 显示明确的“旧 Codex 会话，仅支持查看”状态；
- 保留历史 Message Renderer。

优点：历史语义更准确。

缺点：需要新增明确的只读 Conversation 状态和 UI。

### 11.4 推荐决策

推荐采用策略 A，将仍可能触发执行的配置迁移到 Scode，同时保留历史 Message 的只读展示能力：

```text
运行身份：codex → scode
历史消息：不改写，不丢弃
OpenAI/Codex 模型 ID：保留
```

原因：

- 当前产品没有通用的“只读 Conversation”状态；策略 B 会引入新的产品和状态机能力，范围明显大于清理任务；
- Scode 已是默认本地 Agent，现有 Gemini migration 已采用同类归一化方式；
- 历史 `codex_tool_call` 继续由兼容 Renderer 展示，不需要为下线运行时而破坏已存消息；
- 旧 Codex ACP Session 无法迁移到 Scode，应明确清除 Session 字段，避免错误 Resume。

### 11.5 持久化迁移矩阵

新增 migration 必须放在 `ALL_MIGRATIONS` 末尾；`migration_v16` 等历史 migration 原样保留。建议矩阵如下：

| 存储位置 | Codex 判定 | 迁移结果 | 备注 |
|---|---|---|---|
| `conversations` | `type='acp'` 且 JSON `extra.backend='codex'` | `extra.backend='scode'` | 保留 Conversation、Messages 和 workspace；模型字段按下一项处理 |
| Conversation Session 字段 | 同上 | 删除 `cliPath`、`acpSessionId`、`acpSessionUpdatedAt`、`sessionMode` | 防止把 Codex Session 交给 Scode Resume；`currentModelId` 是否删除见下项 |
| `conversations.model` / `extra.currentModelId` | Codex Conversation | 建议置空 | 避免把仅由 Codex ACP 宣告的模型强制传给 Scode；若已确认 Scode 支持，可另做白名单保留 |
| `cron_jobs.agent_type` | `codex` | `scode` | `preset_assistant_id` 仍需按 Assistant 元数据处理 |
| `team_members.backend` | `codex` | `scode` | 当前表确有该列 |
| `team_members.preset_agent_type` | `codex` | `scode` 或 `NULL` | 推荐 `scode`，保持成员身份可解释 |
| `assistant_sessions.agent_type` | 遗留值 `codex` | `acp` | 只归一化会话协议类型，不代表实际 backend |
| `assistant.<channel>.agent` | JSON `backend='codex'` | `backend='scode'` | 属于 `ProcessConfig`，不是 SQLite migration；保留仍有效的 Assistant ID/name，仅清理明确指向已删除 Codex Agent 的标识 |
| Assistant 元数据 | `presetAgentType='codex'` | `scode` | 覆盖 builtin/custom/upload/hub 的实际持久化来源；不要只改内存合并结果 |
| `acp.config.codex` | key 存在 | 删除 key | 可留到 Connector 删除批次执行 |
| `acp.cachedModels.codex` | key 存在 | 删除 key | 仅清除 Agent 探测缓存，不影响 Provider 模型配置 |
| `guid.lastSelectedAgent` | `codex` | `scode` | 防止旧 Renderer 状态回灌 |
| `messages.type` | `codex_tool_call` / `codex_permission` | 保留 | 继续走历史兼容渲染或显式忽略 |

数据库 migration 的 `down` 不应伪造已丢失的 Codex Session ID。可将结构回滚定义为 no-op，或只回滚可逆的 backend 字段；发布前必须接受“运行身份迁移不可完整逆转”这一事实，并依赖数据库备份做数据级回滚。

### 11.6 深层禁用门禁

数据 migration 只能处理启动时已知数据，不能阻止旧扩展、旧 Assistant 元数据或直接 IPC 再次传入 Codex。删除运行时前应先建立统一门禁：

1. 在 `src/types/acpTypes.ts` 提供独立的运行时执行策略，例如内置配置字段 `isRuntimeEnabled` 或等价 helper；Codex 设为不可执行。不要直接复用现有 `enabled`：它当前表示自动检测/UI 可见性，CodeBuddy 等 backend 也为 `false`，但仍有合法的 npx 直连路径。
2. `ConversationService.createConversation()` 对 `type='acp'` 的 backend 做最终校验。这是 UI、Channel、Cron 和 Team 共用的创建边界。
3. `WorkerManage.buildConversation()` 对持久化的禁用 backend 拒绝构造 Worker。这是已有 Conversation 恢复的最终边界，不能只依赖创建校验。
4. `probeModelInfo`、`checkAgentHealth` 和 MCP Bridge 在启动外部 CLI 前使用同一判断。它们不一定经过 ConversationService。
5. Team Assistant 列表和 `isKnownBackend()`、Cron/Channel 配置解析仍应提前过滤并给出领域内错误，便于定位旧数据；但这些不是最终安全边界。动态扩展/custom backend 应通过实际注册或解析结果判断，不能因不在静态表中而统一拒绝。

门禁应满足：

```text
禁用 backend 可以作为历史标记被读取
禁用 backend 不可创建 Conversation
禁用 backend 不可恢复 Worker
禁用 backend 不可通过 Probe / Health / MCP 启动进程
```

不要直接把 `normalizePresetAgentType('codex')` 改成 `scode` 作为唯一方案。该函数服务 Assistant、Channel 等预设选择，但无法覆盖直接构造 `extra.backend`、已持久化 Conversation、模型 Probe 和 MCP IPC。

## 12. 文件分类清单

### 12.1 当前运行能力，不能直接删除

| 分类 | 主要文件 | 原因 |
|---|---|---|
| Codex ACP backend | `src/types/acpTypes.ts` | 旧数据和内部调用仍可启动 Codex |
| Codex ACP Connector | `src/agent/acp/AcpConnection.ts`、`acpConnectors.ts` | 当前真实 Codex Conversation 运行时 |
| Codex ACP Agent | `src/process/task/AcpAgent.ts` | Session、Resume、模型切换和权限流 |
| Codex MCP | `src/process/services/mcpServices/agents/CodexMcpAgent.ts` | Codex CLI MCP 管理实现仍注册 |
| Codex 模型回退 | `src/common/codex/codexModels.ts` | Guid Codex 模型缓存回退 |
| 历史 Message 类型 | `src/common/chatLib.ts` | 旧数据库 Message 仍可加载 |
| 历史 Tool Renderer | `src/renderer/messages/codex/MessageCodexToolCall.tsx` | 保留旧工具详情展示 |
| 通用文件变更 UI | `src/renderer/messages/codex/MessageFileChanges.tsx` | 当前通用 WriteFile UI 仍使用 |
| 数据迁移 | `src/process/database/migrations.ts` | 旧用户数据库升级需要 |

### 12.2 优先核验的死代码候选

```text
src/agent/codex/index.ts
src/agent/codex/core/CodexAgent.ts
src/agent/codex/core/ApprovalStore.ts
src/agent/codex/handlers/CodexEventHandler.ts
src/agent/codex/handlers/CodexToolHandlers.ts
src/agent/codex/handlers/CodexSessionManager.ts
src/agent/codex/handlers/CodexFileOperationHandler.ts
src/agent/codex/messaging/CodexMessageProcessor.ts
src/agent/codex/messaging/CodexMessageEmitter.ts
src/common/codex/utils/toolUtils.ts
src/common/codex/types/toolTypes.ts
src/common/codex/types/eventTypes.ts
src/common/codex/utils/index.ts
src/common/storage.ts 中 codex.config
src/common/codex/codexModels.ts 中 DEFAULT_CODEX_MODEL_ID
```

### 12.3 先重构再删除

| 分类 | 文件 | 前置条件 |
|---|---|---|
| 旧健康检查 | `CodexConnection.ts`、`ErrorService.ts` | 删除健康检查或改用 ACP Probe |
| 权限类型 | `permissionTypes.ts` | 先迁移 `CREDENTIAL_AUTOLOGIN` 到中立模块 |
| Permission Utils | `permissionUtils.ts` | 先删除旧 EventHandler 并迁移通用权限值 |
| Event Payload | `eventData.ts` | 拆出历史 Message 所需 Payload |
| Codex i18n | `locales/*/codex.json` | 删除最后 key 调用并同步 i18n 配置 |
| Codex Logo | `codex.svg` | 先决定历史 Conversation 图标策略 |
| MessageFileChanges | `messages/codex/MessageFileChanges.tsx` | 先移动到中立目录 |

### 12.4 产品决策后才能删除

```text
codex_tool_call 类型、合并逻辑和 Renderer
codex_permission 兼容分支
Codex ACP backend / Connector
CodexMcpAgent
Codex 模型探测、缓存和选择 UI
```

## 13. 分阶段清理计划

目标是“移除 Codex 独立 Agent 运行时，但保留 OpenAI/Codex 模型 ID 和历史消息可读性”。每个批次应为独立提交，前一批通过门禁后再进入下一批。

### 批次 1：建立禁用边界

改动：

- 增加统一 backend 运行时可用性判断；
- 在 ConversationService 和 WorkerManage 增加最终门禁；
- Team、Cron、Channel 在各自入口拒绝或归一化 Codex；
- `probeModelInfo`、`checkAgentHealth` 和 MCP Bridge 拒绝 Codex；
- 补充 `conversationService.test.ts`、Team、Cron、Channel 和 Bridge 单元测试。

完成条件：任何新参数或旧持久化数据都不能启动 Codex/codex-acp 进程；历史 Conversation 和 Message 仍可读取。

回滚条件：Scode 或其他 `enabled: true` backend 无法创建/恢复；自定义 Agent 被误判为禁用；Channel/Team/Cron 正常路径回归。

### 批次 2：迁移持久化运行身份

改动：

- 新增末尾数据库 migration，按 11.5 的矩阵迁移 Conversation、Cron、Team 和遗留 Channel Session 协议值；
- 新增 `ProcessConfig` 一次性 migration，处理各 Channel Agent、ACP Codex 配置、缓存和 Guid 选择；
- 迁移实际 Assistant 元数据中的 `presetAgentType='codex'`；
- 不修改历史 Message 行和 `migration_v16`。

完成条件：升级后的数据库与配置中不存在可执行 Codex backend；旧 Conversation 可作为 Scode Conversation 打开并发送；旧工具消息保持可读。

回滚条件：migration 丢失 Message、workspace、Assistant 资源或 Team 关系；升级非幂等；从旧数据库启动失败。数据级回滚使用升级前数据库/配置备份，不依赖恢复 Codex Session 字段。

### 批次 3：删除旧原生 Codex 实现

改动：

- 删除无生产构造入口的 `CodexAgent`、Handlers、Messaging 和 ApprovalStore；
- 删除或改写 `checkAgentHealth` 的 Codex 特殊分支后，再删除 `CodexConnection`、`ErrorService` 和相关旧类型；
- 删除只服务旧 Producer 的 Tool Registry、Event 类型和 Utils。

完成条件：`src/agent/codex/` 无生产引用；ACP 通用健康检查不受影响；历史 Message Renderer 编译通过。

回滚条件：仍有非测试调用依赖 `CodexConnection`；删除的 Common 类型仍参与历史 Message hydration。

### 批次 4：中立化共享与历史兼容代码

改动：

- 把 `CREDENTIAL_AUTOLOGIN` 迁移到中立权限模块，保持值 `'credential_autologin'`；
- 把 `MessageFileChanges.tsx` 移到通用 Message 目录并更新调用方；
- 把历史 `codex_tool_call` 所需 Payload 类型移到明确的 legacy 模块；
- 保留 `codex_tool_call` Renderer，保留对 `codex_permission` 的显式忽略。

完成条件：通用 WriteFile UI 和密码自动登录不再依赖 `src/common/codex`；历史 Codex 工具详情仍可展示。

回滚条件：历史消息无法反序列化或展示；文件变更汇总、工具组或自动登录权限出现回归。

### 批次 5：删除 Codex ACP 与 MCP 运行时

改动：

- 删除 `ACP_BACKENDS_ALL.codex`、`AcpBackendAll` 的 Codex 成员和 Codex Resume 策略；
- 删除 `connectCodex()`、`prepareCodex()`、`CODEX_ACP_*` 常量和依赖启动配置；
- 删除 `CodexMcpAgent` 注册与实现；
- 删除 Codex Agent 模型 Probe、缓存回退和 Guid 静态选项；
- 保持 OpenAI-compatible Provider 的 `gpt-*-codex` 模型支持。

完成条件：生产包中不存在 Codex CLI 或 `@zed-industries/codex-acp` 启动路径；MCP 设置不会调用 Codex CLI；Provider 模型配置仍可使用 Codex 命名模型。

回滚条件：通用 ACP Connector 分支被误删；其他 Agent 的 Resume、模型列表或 MCP 同步失败。

### 批次 6：清理命名与资源残留

改动：

- 删除 Codex Agent Logo、Option、emoji、`codex.config` 和无引用类型；
- 删除 Codex i18n 调用后，再原子移除所有 Locale 的 `codex.json`、index 注册和 `i18n-config.json` 模块；
- 仅在历史 Renderer 已迁移到 legacy/中立目录后删除空的 Codex 目录。

完成条件：源码中的 `codex` 命中仅剩历史消息兼容、数据库历史 migration、OpenAI/Codex 模型 ID 和必要文档。

回滚条件：历史 Conversation 图标/消息出现未知状态；i18n 类型生成或任一 Locale 构建失败。

## 14. 验收门禁

### 14.1 每批通用检查

```bash
bunx eslint <本批改动的 .ts/.tsx 文件> --fix
bunx tsc --noEmit
bun run test
```

涉及 i18n 的批次额外执行：

```bash
bun run i18n:types
```

### 14.2 必须新增或更新的测试

| 测试层 | 场景 | 预期 |
|---|---|---|
| ConversationService | `type='acp', backend='codex'` | 创建失败，不写数据库，不注册 Worker |
| WorkerManage | 已持久化 `extra.backend='codex'` | 不构造 `AcpAgent`，不启动 Connector |
| Backend 判断 | Codex 运行时策略为禁用 | 可识别为历史值，不可执行；不误伤仅关闭自动检测的其他 backend |
| Team | `assistantId='codex'` 或 Assistant 元数据为 Codex | 不创建 Member Conversation；migration 后使用 Scode |
| Cron | `agent_type='codex'` 且无 preset Assistant | migration 前被门禁阻止，migration 后以 Scode 执行 |
| Channel | 保存配置为 `backend='codex'` | migration 后创建 Scode Conversation，Session 类型仍为 `acp` |
| Model Probe | `probeModelInfo('codex')` | 在构造 `AcpConnection` 前返回禁用错误 |
| Health | `checkAgentHealth('codex')` | 不构造旧 `CodexConnection` |
| MCP | 直接传入 Codex Agent | 不执行 `codex mcp ...` |
| Database migration | v15 旧 `type='codex'` 数据升级到最新 | 先经 v16 转 ACP，再经新 migration 转 Scode；Message 数量不变 |
| Database migration | 已是最新或重复启动 | migration 幂等，JSON 字段稳定 |
| 历史消息 | `codex_tool_call` / `turn_diff` | hydration 和 Renderer 保持可读 |
| 共享 UI | WriteFile / 文件汇总 | 移动 `MessageFileChanges` 后行为不变 |
| Provider 模型 | `gpt-*-codex` 自定义模型 | 仍可保存、选择和发送 |

### 14.3 发布前数据校验

使用脱敏的旧版本数据库副本执行完整升级，并核对：

```text
Conversation 总数不变
Message 总数不变
extra.backend='codex' 数量 = 0
cron_jobs.agent_type='codex' 数量 = 0
team_members.backend='codex' 数量 = 0
team_members.preset_agent_type='codex' 数量 = 0
assistant_sessions.agent_type='codex' 数量 = 0
旧 codex_tool_call 数量不变
```

同时对用户配置做结构化读取校验，不用全文字符串替换 JSON：所有 Channel backend、Assistant `presetAgentType`、`guid.lastSelectedAgent` 均不再指向 Codex，`acp.config.codex` 和 `acp.cachedModels.codex` 已移除。

### 14.4 进程级验收

测试期间监听子进程启动，执行以下入口：旧 Conversation 打开/发送、Team 创建、Cron 执行、Channel 首条消息、Model Probe、Health Check、MCP 同步。任一入口都不得出现：

```text
codex
codex mcp-server
codex mcp serve
npx @zed-industries/codex-acp
```

Scode Conversation 创建、恢复、模型切换和 MCP 同步必须保持正常。

## 15. 一句话理解

```text
Codex 当前不是默认或可见 Agent，但 ACP 运行时并未真正下线。
旧 Conversation、Team、Cron、Channel 和直接 IPC 仍可能启动 Codex；同时历史 Codex
消息渲染和通用文件变更 UI 与旧实现混在同一命名空间，后续必须分层清理，不能按目录整删。
```
