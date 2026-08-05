# 系统提示词设置设计方案

## 1. 背景

当前品牌默认 Assistant 由 `brand.config.json` 指定：

```json
{
  "defaultAgentId": "gewu"
}
```

`gewu` 在 `src/common/presets/assistantPresets.ts` 中映射到：

```text
assistant/gewu/gewu.md
```

该 Markdown 文件是 Gewu 的主体系统提示词。创建本地 ACP 会话后，系统将主体提示词、品牌身份、运行时指令及用户请求拼接，并通过 ACP `session/prompt` 发送给 SCode。

目前主体提示词随项目和安装包发布，用户无法在应用内查看或修改。

## 2. 目标

在设置侧栏新增“系统提示词”入口，允许用户：

1. 查看当前品牌默认 Assistant 实际使用的主体系统提示词。
2. 直接编辑主体系统提示词。
3. 保存为本地覆盖值。
4. 让保存后新建的会话使用该覆盖值。

## 3. 已确认范围

### 3.1 编辑范围

页面只编辑 **主体系统提示词**，即当前 `assistant/gewu/gewu.md` 所代表的规则内容。

以下运行时动态内容不在页面中展示或编辑：

- 品牌身份覆盖，例如“你的身份是：格物AI”。
- Skills 索引、Skill 路径和本轮选择信息。
- Workspace、drafts 和输出约定。
- Team governance。
- Dify 增强内容。
- Assistant runtime appendix、脚本路径等运行时信息。

这些内容继续由现有运行时流程自动拼装。

### 3.2 生效范围

保存后的提示词会被新建会话立即使用。已有会话不会主动重建 SCode 上下文，也不会在下一条消息中重新注入完整主体提示词；当应用重启或该会话的 Agent 运行实例因切换模型、reset、断线恢复、上下文恢复等原因重建后，也会读取并使用最新提示词。

这样可以复用现有的 Agent 初始化流程，避免增加提示词版本比较、会话广播和一次性重注入逻辑。

### 3.3 不在本期实现

- 不提供“恢复项目默认提示词”。
- 不支持编辑非品牌默认 Assistant。
- 不提供 Markdown 预览。
- 不提供版本历史、差异对比或撤销。
- 不提供自动保存。
- 不把动态拼装后的完整 ACP prompt 暴露给用户。
- 不引入新的编辑器或存储依赖。

## 4. 设计原则

### 4.1 不修改安装包资源

不能直接修改：

```text
assistant/gewu/gewu.md
```

开发环境中的源码文件可能可写，但生产环境资源可能位于 `app.asar` 或随安装包发布，不适合作为用户配置存储；应用升级也可能覆盖资源文件。

因此，内置 Markdown 仅作为默认值，本功能通过现有 `ProcessConfig` 保存用户覆盖值。

### 4.2 只作用于当前品牌默认 Assistant

提示词覆盖必须与 `brand.config.json.defaultAgentId` 绑定，不能使用匿名全局字符串。

如果未来品牌默认 Assistant 从 `gewu` 改为其他 ID，旧覆盖值不能错误套用到新 Assistant。

### 4.3 主进程负责可信校验

Renderer 只提交提示词文本，不提交或决定 Assistant ID。主进程从 `brand.config.json` 解析当前 `defaultAgentId`，并在保存时再次校验内容非空。

## 5. 数据模型

在 `src/common/storage.ts` 的 `IConfigStorageRefer` 中增加：

```ts
'assistant.systemPromptOverride'?: {
  assistantId: string;
  content: string;
};
```

示例：

```json
{
  "assistant.systemPromptOverride": {
    "assistantId": "gewu",
    "content": "# 格物\n\n修改后的主体提示词……"
  }
}
```

覆盖值仅在以下条件全部满足时生效：

1. 当前读取的是 Assistant `rules`。
2. 被读取 Assistant 去掉 `builtin-` 前缀后的 ID 等于 `brand.defaultAgentId`。
3. 覆盖值中的 `assistantId` 等于 `brand.defaultAgentId`。
4. `content.trim()` 非空。

## 6. 提示词读取优先级

品牌默认 Assistant 的主体提示词读取顺序调整为：

```text
匹配当前 defaultAgentId 的 ProcessConfig 本地覆盖
  > AssistantManager 当前有效规则
  > legacy flat assistant rule
  > 安装包内置规则
```

非品牌默认 Assistant 保持现有读取逻辑，不受覆盖值影响。

覆盖判断放在主进程共享读取函数：

```text
src/process/utils/assistantResources.ts
  readAssistantResource()
```

该函数是 `AcpAgent` 运行时读取 Assistant 规则的入口。把覆盖层放在这里，可以避免在 Renderer、会话创建和 SCode 发送路径分别实现一套判断。

设置页通过专用系统设置 IPC 调用这个共享读取函数；SCode 发送前也由 `AcpAgent` 调用它重新加载有效规则。现有 `ipcBridge.fs.readAssistantRule` 保持不变，避免本需求顺带改变 Assistant 编辑功能的既有资源优先级。

## 7. IPC 设计

在现有 `ipcBridge.systemSettings` 下增加两个接口。

### 7.1 获取当前系统提示词

```ts
getDefaultAssistantSystemPrompt
```

返回：

```ts
interface IDefaultAssistantSystemPrompt {
  agentId: string;
  content: string;
}
```

主进程流程：

1. 读取 `brand.defaultAgentId` 并执行 `trim()`。
2. 若不存在有效 ID，返回明确错误。
3. 通过统一规则读取函数获取当前有效主体提示词。
4. 若最终内容为空，返回明确错误。
5. 返回 `agentId` 和 `content`。

### 7.2 保存系统提示词

```ts
setDefaultAssistantSystemPrompt
```

请求参数：

```ts
interface ISetDefaultAssistantSystemPromptParams {
  content: string;
}
```

主进程流程：

1. 读取并校验 `brand.defaultAgentId`。
2. 校验 `content.trim()` 非空。
3. 原样保留用户输入的 Markdown 格式，不主动 `trim()` 后再存储。
4. 写入 `ProcessConfig.set('assistant.systemPromptOverride', ...)`。
5. 返回成功；写入异常交给 Renderer 展示失败反馈。

Renderer 不允许指定 `assistantId`，避免通过通用接口修改任意 Assistant。

## 8. 设置页面

### 8.1 路由和菜单

新增路由：

```text
/settings/system-prompt
```

设置侧栏顺序：

```text
系统
系统提示词
关于
```

涉及文件：

```text
src/renderer/layouts/components/SettingsSider.tsx
src/renderer/router.tsx
```

菜单 ID 和 path 统一使用：

```text
system-prompt
```

仅当 `brand.defaultAgentId` 为有效非空字符串时展示入口。直达页面仍需处理主进程返回的不可用错误，不能只依赖菜单隐藏。

个人模式和企业模式都展示该入口，并将 `/settings/system-prompt` 加入企业模式设置路由白名单。

### 8.2 页面结构

新增：

```text
src/renderer/pages/settings/system-prompt/index.tsx
```

页面复用现有设置页样式和组件，只包含：

- `PageWrapper`。
- 页面标题“系统提示词”。
- 当前 Assistant ID 或名称。
- 功能说明，明确“新会话立即使用；已有会话需重启应用或重建 Agent 后生效”。
- Arco `Input.TextArea`。
- 保存按钮。
- 初始加载状态。
- 保存 loading 状态。
- dirty 状态：内容未变化时禁用保存按钮。
- 空内容校验。
- `Message.success` / `Message.error` 反馈。

不增加表单框架、Markdown 编辑器或新的共享组件。

### 8.3 页面状态

建议保持最小状态：

```ts
const [content, setContent] = useState('');
const [savedContent, setSavedContent] = useState('');
const [agentId, setAgentId] = useState('');
const [isLoading, setIsLoading] = useState(true);
const [isSaving, setIsSaving] = useState(false);
```

保存按钮禁用条件：

```ts
isLoading || isSaving || !content.trim() || content === savedContent
```

保存成功后将 `savedContent` 更新为当前 `content`。

## 9. 国际化

所有 `src/renderer/i18n/locales/*/settings.json` 保持 key 同步，新增类似结构：

```json
{
  "systemPrompt": "系统提示词",
  "systemPromptEditor": {
    "description": "编辑默认助手使用的主体系统提示词，新建会话后生效。",
    "currentAssistant": "当前助手：{{agentId}}",
    "placeholder": "请输入系统提示词",
    "emptyError": "系统提示词不能为空",
    "saveSuccess": "系统提示词已保存",
    "loadFailed": "系统提示词加载失败",
    "saveFailed": "系统提示词保存失败",
    "unavailable": "当前品牌未配置默认助手"
  }
}
```

按钮优先复用已有通用“保存”翻译 key。

## 10. 完整数据流

### 10.1 打开页面

```text
用户打开 /settings/system-prompt
  → Renderer 调用 getDefaultAssistantSystemPrompt
  → 主进程读取 brand.defaultAgentId
  → readAssistantResource('rules', 'builtin-{id}', locale, ...)
  → 优先返回匹配的 ProcessConfig 覆盖
  → 没有覆盖则读取当前 AssistantManager/内置规则
  → Renderer 在 TextArea 中展示
```

### 10.2 保存

```text
用户修改 TextArea 并点击保存
  → Renderer 检查 content.trim() 非空
  → 调用 setDefaultAssistantSystemPrompt({ content })
  → 主进程再次校验 defaultAgentId 和非空内容
  → ProcessConfig 保存 assistantId + content
  → Renderer 显示成功反馈
```

### 10.3 新会话生效

```text
用户保存后新建默认 Assistant 会话
  → Guide 解析 builtin-gewu
  → readAssistantResource() 命中 ProcessConfig 覆盖
  → conversation.extra.presetContext 保存覆盖内容
  → AcpAgent 首条消息再次读取有效规则
  → 追加 Identity Override、runtime appendix 等动态内容
  → prepareFirstMessageWithSkillsIndex()
  → AcpConnection.sendPrompt()
  → ACP session/prompt
  → SCode 使用新主体提示词
```

## 11. 预计修改文件

```text
src/common/storage.ts
src/common/ipcBridge.ts
src/process/utils/assistantResources.ts
src/process/bridge/systemSettingsBridge.ts
src/renderer/layouts/components/SettingsSider.tsx
src/renderer/router.tsx
src/renderer/pages/settings/system-prompt/index.tsx
src/renderer/i18n/locales/*/settings.json
tests/unit/...
```

不需要修改：

```text
assistant/gewu/gewu.md
src/process/task/AcpAgent.ts
src/process/task/agentUtils.ts
src/agent/acp/AcpConnection.ts
```

## 12. 测试计划

### 12.1 主进程读取测试

覆盖以下场景：

1. 没有覆盖值时返回原 Assistant 规则。
2. 保存匹配 `defaultAgentId` 的覆盖后返回覆盖内容。
3. 覆盖记录中的 `assistantId` 与当前品牌不一致时忽略覆盖。
4. 非品牌默认 Assistant 不使用该覆盖。
5. Skills 资源读取不受影响。
6. 原有 custom、hub、system、legacy 和 bundled 回退顺序不被破坏。

### 12.2 IPC 测试

覆盖以下场景：

1. 获取接口返回当前 `agentId` 和有效内容。
2. 保存合法内容成功。
3. 保存空字符串或纯空白内容失败。
4. 无有效 `defaultAgentId` 时获取和保存均失败。
5. 存储异常不会伪装成保存成功。

### 12.3 Renderer 验收

1. 设置侧栏出现“系统提示词”，顺序正确。
2. 页面能展示当前主体提示词。
3. 内容不变时保存按钮禁用。
4. 空内容不能保存。
5. 保存中按钮显示 loading 且不可重复提交。
6. 保存成功和失败反馈正确。
7. 离开页面后重新进入仍显示已保存内容。
8. 保存后新建 Gewu 会话使用新提示词。
9. 保存前已经存在的会话不承诺立即应用新提示词。
10. 非默认 Assistant 不受影响。
11. 生产打包环境保存时不出现 `EROFS` 或 `app.asar` 写入错误。

## 13. 验证命令

编辑 TypeScript/TSX 后逐文件执行：

```bash
bunx eslint <path> --fix
```

然后执行：

```bash
bunx vitest run <相关测试文件>
bunx tsc --noEmit
```

最后在打包环境进行一次 smoke test，确认覆盖值写入用户配置目录，而不是安装包资源目录。

## 14. 已知限制与后续扩展

### 14.1 已有会话不会主动立即生效

当前 ACP 会话仅在首条消息中注入完整主体提示词，后续消息只按现有逻辑重注入身份和团队治理内容。因此，本期不主动更新仍存活的 Agent 上下文；已有会话在应用重启或 Agent 运行实例重建后会使用最新提示词。

如果未来需要“保存后当前会话下一条消息立即生效”，再增加：

1. 主体提示词版本或内容快照。
2. 当前 `AcpAgent` 的变更检测。
3. 仅在变化后的下一条消息中重新注入一次完整主体提示词。
4. 防止后续每轮重复注入造成 token 膨胀。

### 14.2 本期没有恢复默认

本期不提供恢复按钮。用户保存后只能继续修改并覆盖当前值。

如果后续增加恢复功能，应删除 `assistant.systemPromptOverride`，而不是把安装包默认内容复制成新的覆盖值。这样应用升级后才能自然使用新版内置提示词。

## 15. 验收标准

以下条件全部满足即视为完成：

- 设置侧栏存在“系统提示词”入口。
- 页面展示当前品牌默认 Assistant 的有效主体提示词。
- 用户可修改并成功保存非空内容。
- 保存内容持久化在 `ProcessConfig`，不修改 `assistant/gewu/gewu.md` 或安装包资源。
- 保存后新建的默认 Assistant 会话使用新主体提示词。
- 品牌身份、Skills、Workspace、Team、Dify 和 runtime appendix 仍由现有流程动态拼装。
- 非品牌默认 Assistant 不受影响。
- 相关 ESLint、单元测试和 TypeScript 检查通过。
