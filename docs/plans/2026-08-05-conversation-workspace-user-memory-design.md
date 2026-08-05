# 会话、Workspace、用户记忆与 Skills 分层设计

## 1. 背景

Sudowork 当前的本地 ACP/Scode 会话采用 `conversation-owned workspace` 模型：

- 每个 Conversation 有独立聊天记录；
- 每个 Conversation 有独立 ACP Session；
- 未指定目录时，每个 Conversation 创建独立临时 Workspace；
- Workspace 同时承载临时文件、交付物、`AGENTS.md` 和 Skills 链接。

默认目录形态如下：

```text
~/.nexus/scode-temp-<timestamp>/
├── .drafts/
└── .nexus/sudocode/
    ├── AGENTS.md
    └── skills/
```

该模型能够隔离不同会话的临时文件，但也导致部分本应属于用户级的数据被限制在单个会话中。

典型现象：

1. 用户在会话 A 中告诉 AI 一个通用搜索流程；
2. AI 将规则保留在会话上下文，或写入会话 A 的 Workspace；
3. 用户新建会话 B；
4. 会话 B 创建新的 ACP Session 和临时 Workspace；
5. AI 无法获得会话 A 中形成的通用流程，用户需要重新说明。

另一个相关现象是：会话 A 中创建的 Skill 当前可见，但新建会话后可能不可见。这通常表示 Skill 只存在于会话 Workspace，或虽然已经安装到用户 Skill 库，但未被新会话同步或未被当前助手启用。

## 2. 当前实现

### 2.1 Conversation 与 Workspace

本地 ACP 会话创建逻辑位于：

```text
src/process/initAgent.ts
```

未指定 Workspace 时，系统创建：

```text
<workDir>/<backend>-temp-<timestamp>
```

并将路径持久化到：

```ts
conversation.extra.workspace
```

用户指定目录时，系统直接使用解析后的绝对路径，不复制目录，也不创建 worktree、overlay 或容器。

因此当前关系是：

```text
默认：Conversation 1:1 临时 Workspace
指定目录：多个 Conversation 可以共享一个 Workspace
```

### 2.2 ACP Session

每个 Conversation 单独保存：

```ts
conversation.extra.acpSessionId
```

重新打开原 Conversation 时，可以通过 `session/load` 或后端恢复策略加载原 ACP Session。新建 Conversation 没有旧的 `acpSessionId`，会创建新的 ACP Session。

实现位置：

```text
src/process/task/AcpAgent.ts
src/agent/acp/AcpConnection.ts
```

因此，新建会话不会自动继承其他会话的：

- 消息历史；
- 工具调用历史；
- 已读文件；
- 已验证结论；
- 已排除方案；
- 临时形成的操作流程。

这是正确的会话隔离行为，不应通过默认复制全部历史消息来解决。

### 2.3 Workspace 记忆

当前 Scode 托管规则要求：用户提出“记住、保存、持久化偏好或工作流”时，优先更新当前 Workspace 下的：

```text
<workspace>/.nexus/sudocode/AGENTS.md
```

相关逻辑位于：

```text
src/process/services/scode/ScodeInstallService.ts
```

由于默认每个 Conversation 使用不同临时 Workspace，这类记忆实际上是会话 Workspace 级，而不是用户级。

### 2.4 用户昵称是特殊机制

项目已有用户昵称的专门持久化链路：

```text
Renderer 登录/资料
  → sudoworkAuth.saveUserNickname
  → ~/.nexus/user_nickname.txt
  → ~/.nexus/sudoclaw/workspace/USER.md
```

实现位置：

```text
src/renderer/context/AuthContext.tsx
src/process/bridge/authBridge.ts
src/process/services/sudoclaw/SudoclawInstallService.ts
```

该机制只能证明昵称拥有用户级持久化，不能等价为“任意聊天内容都有通用用户记忆”。如果用户在聊天中告知的姓名也能跨会话，需要进一步区分：

- 姓名是否与账号昵称一致；
- 是否由 Scode/Moss 外部运行时保存；
- 是否存在当前仓库未显式管理的后端 Memory 能力。

### 2.5 Skills

用户级 Skill 库位于：

```text
~/.nexus/skills/
```

Scode 会话实际看到的 Skills 位于：

```text
<workspace>/.nexus/sudocode/skills/
```

Sudowork 会按会话配置，将用户级 Skill 链接到当前 Workspace。相关逻辑位于：

```text
src/process/bridge/conversationBridge.ts
src/process/utils/workspaceSkillsDir.ts
src/process/utils/workspaceSkillTargets.ts
```

会话中生成 Skill 后，系统也会尝试将其提升到用户自定义 Skill 库：

```text
src/process/task/workspaceSkillInstaller.ts
```

但如果 Skill 只写入当前 Workspace 的同步目录、缺少必要元数据、未被文件追踪捕获，或者不在新助手的 `enabledSkills` 中，仍可能只在当前会话可见。

## 3. 参考 Agent 的通用分层

Pi 和 Codex 的共同设计不是“一个会话等于一个项目”，而是将不同状态分开管理。

### 3.1 Pi

Pi 将以下概念分离：

- Session：独立聊天历史，可恢复、分支、克隆；
- Working Directory：Session 关联的文件工作目录；
- 全局指令：`~/.pi/agent/AGENTS.md`；
- 目录指令：从当前目录向上发现 `AGENTS.md`；
- 用户 Skills：`~/.pi/agent/skills/`、`~/.agents/skills/`；
- 目录 Skills：`.pi/skills/`、`.agents/skills/`。

需要继承历史上下文时，用户显式使用 fork/clone；普通新会话保持独立。

### 3.2 Codex

Codex采用类似分层：

- Session/Thread 保存聊天历史；
- `cwd` 决定当前文件工作范围；
- 用户级指令位于 `~/.codex/AGENTS.md`；
- 目录级指令从仓库根目录逐级加载到当前目录；
- 用户级 Skills 位于 `$HOME/.agents/skills`；
- 仓库级 Skills 位于 `$REPO_ROOT/.agents/skills`；
- `resume` 用于继续原会话；
- `fork` 用于创建继承已有上下文的新会话；
- 普通 `new` 创建干净聊天。

### 3.3 可借鉴原则

```text
会话负责历史
工作目录负责文件
用户目录负责长期偏好和能力
显式 fork 负责跨会话任务交接
```

## 4. 设计目标

1. 保留默认每会话独立临时 Workspace。
2. 增加明确的用户级通用记忆作用域。
3. 让用户明确要求长期记住的规则在新会话中可用。
4. 将用户安装的 Skill 与单个 Conversation Workspace 解耦。
5. 不自动复制其他会话全部历史。
6. 不引入项目实体或项目管理功能。
7. 保持原会话恢复行为不变。
8. 为未来增加“从当前会话分支”保留扩展空间。

## 5. 非目标

本阶段不实现：

- 项目表、项目 ID 或项目管理页面；
- 自动把多个会话归为同一项目；
- 项目级知识库；
- 新会话自动读取所有旧会话；
- 自动总结所有会话并永久保存；
- 多设备或云端记忆同步；
- 复杂向量检索式 Memory；
- 自动将任意聊天内容判定为长期记忆。

## 6. 推荐作用域模型

### 6.1 用户级

适合保存：

- 用户称呼；
- 回复语言和格式偏好；
- 长期业务约束；
- 通用搜索顺序；
- 数据源偏好或禁用规则；
- 用户安装的 Skills。

建议存储根目录：

```text
~/.nexus/sudowork/sudocode/
```

### 6.2 会话级

适合保存：

- 当前聊天消息；
- 当前 ACP Session；
- 当前任务临时条件；
- 工具调用历史；
- 中间推理；
- 当前会话附件和交付物。

继续使用：

```text
~/.nexus/scode-temp-<timestamp>/
```

### 6.3 Workspace 级

仅在用户明确指定目录或明确要求“仅对此目录生效”时使用。

适合保存：

- 目录专属规则；
- 代码仓库规范；
- 当前目录文件处理约定；
- 目录级 Skills。

路径继续使用：

```text
<workspace>/.nexus/sudocode/AGENTS.md
```

### 6.4 Skill 级

适合保存：

- 稳定、可重复执行的流程；
- 多步骤或有分支判断的工作流；
- 需要脚本、模板或参考资料的能力；
- 需要明确输入、输出和质量标准的操作。

例如完整询价流程应优先沉淀为用户级 Skill，而不是把大量步骤永久塞进用户记忆。

## 7. 用户级记忆设计

### 7.1 存储方式

第一阶段不增加数据库表，复用现有 Scode 用户目录。

建议将用户记忆存放在用户级 `AGENTS.md` 的受控区块中：

```text
~/.nexus/sudowork/sudocode/AGENTS.md
```

示例：

```md
<!-- SUDOWORK_USER_MEMORY_START -->
## User Memory

- 用户要求所有报价结论必须附带数据来源。
- 查询建材价格时，先查政府采购成交公告，再查市场报价。
- 默认使用中文回复。
<!-- SUDOWORK_USER_MEMORY_END -->
```

选择受控区块而不是立即新建 `MEMORY.md` 的原因：

- 当前已有用户级 `AGENTS.md`；
- Scode 已使用该目录作为独立配置 Home；
- 减少新的文件发现和注入逻辑；
- 与 Pi/Codex 的全局 `AGENTS.md` 分层一致；
- 便于沿用现有 marker block 更新方式。

如果确认 Scode 不会自动加载该用户级文件，则由 Sudowork 在首条消息中读取并隐藏注入该区块。不要依赖偶然的目录扫描行为。

### 7.2 写入条件

第一阶段只在用户明确表达长期记忆意图时写入，例如：

- “记住……”；
- “以后都……”；
- “以后默认……”；
- “下次也按这个流程……”；
- “长期使用这个格式……”；
- “忘掉之前关于……的规则”。

普通陈述不自动保存，避免把临时条件误判为长期记忆。

### 7.3 基本操作

至少支持：

```text
记住：以后报价必须附来源
查看你记住了什么
忘记报价相关规则
清空通用记忆
```

删除和清空必须明确确认，避免误删。

### 7.4 注入策略

用户记忆只需在新 ACP Session 的首条消息中注入一次：

```text
[User Memory]
...

[User Request]
...
```

要求：

- 不显示在聊天消息正文；
- 文件不存在或区块为空时直接跳过；
- 设置最大字符数，避免无限膨胀；
- 用户级记忆优先级低于系统安全规则，高于普通临时上下文；
- 不注入敏感凭据、Token、密码和密钥；
- 恢复原 ACP Session 时避免重复注入同一份内容造成上下文污染。

## 8. Skills 优化

### 8.1 明确“生成”和“安装”

产品语义应区分：

```text
生成 Skill：只在当前 Workspace 产出 Skill 包
安装 Skill：复制到用户级 Skill 库，并供后续新会话使用
```

当用户说“帮我增加一个 Skill”且没有明确要求只生成包时，默认语义应是安装。

### 8.2 安装目标

个人模式：

```text
~/.nexus/skills/_my-custom-skill/<skill-name>/
```

### 8.3 新会话同步

新会话创建时：

1. 扫描用户级已安装 Skills；
2. 根据当前助手策略筛选；
3. 链接到当前 Workspace 的 Scode Skills 目录；
4. 首条消息注入可用 Skill 名称、描述和路径。

### 8.4 助手白名单

需要明确产品规则：

- 用户安装的新 Skill 是否默认对当前助手启用；
- 是否默认对所有助手启用；
- 是否只安装但等待用户手动启用。

推荐第一阶段：

> 用户在某助手会话中明确要求创建并安装 Skill 时，安装成功后自动加入该助手的启用列表；不自动修改其他助手。

这样能保证同一助手的新会话可见，同时不扩大其他助手能力范围。

## 9. 新会话与分支语义

### 9.1 普通新会话

```text
新 Conversation
+ 新 ACP Session
+ 新临时 Workspace
+ 用户级记忆
+ 当前助手已启用的用户 Skills
```

不继承其他会话消息。

### 9.2 继续原会话

```text
原 Conversation
+ 恢复原 ACP Session
+ 原 Workspace
```

用于继续同一任务。

### 9.3 从当前会话分支（后续能力）

参考 Pi/Codex 的 fork：

```text
新 Conversation
+ 来源 Conversation ID
+ 来源会话交接摘要或后端 fork Session
+ 可选择复用或新建 Workspace
```

适用于从询价对话另开标书生成、文件检查等任务。该能力不要求项目系统，但不属于本阶段最小改造。

## 10. 建议实施阶段

### 阶段 1：修正作用域

1. 定义用户级记忆区块及读写方法；
2. 修改 Scode 托管规则，区分用户级记忆和 Workspace 级规则；
3. 新 ACP Session 首条消息注入用户级记忆；
4. 支持查看、删除和清空；
5. 添加长度和敏感信息保护；
6. 增加最小单元测试。

### 阶段 2：修复 Skill 跨会话一致性

1. 确认 Skill 创建完成后可靠安装到用户级目录；
2. 安装成功后更新当前助手启用列表；
3. 新会话创建时验证同步结果；
4. 区分“已生成”和“已安装”的用户提示；
5. 增加端到端回归测试。

### 阶段 3：会话分支

1. 增加“从当前对话新建”入口；
2. 优先使用后端 fork 能力；
3. 不支持 fork 的后端使用结构化交接摘要；
4. 保留来源会话关系；
5. 不默认复制全部工具输出。

## 11. 预计涉及文件

第一阶段可能涉及：

```text
src/process/services/scode/scodePaths.ts
src/process/services/scode/ScodeInstallService.ts
src/process/task/agentUtils.ts
src/process/task/AcpAgent.ts
src/common/ipcBridge.ts
src/process/bridge/*
tests/unit/*
```

具体落点应在实施前根据现有 Scode 加载行为再确认，优先复用已有 marker block 和 IPC 结构。

## 12. 验收场景

### 12.1 用户记忆

```text
会话 A：记住，以后报价必须附带数据来源。
会话 B：报价时有什么长期要求？
预期：能回答必须附带数据来源。
```

### 12.2 临时信息不跨会话

```text
会话 A：这次只查北京地区。
会话 B：查询范围是什么？
预期：不应自动回答北京，除非用户明确要求长期记住。
```

### 12.3 删除记忆

```text
会话 A：忘记“报价必须附来源”这条规则。
会话 B：报价时有什么长期要求？
预期：不再包含该规则。
```

### 12.4 Skill 安装

```text
会话 A：创建并安装一个测试 Skill。
会话 B：列出可用 Skills。
预期：同一助手的新会话包含该 Skill。
```

### 12.5 会话隔离

```text
会话 A 产生临时文件 A。
新建会话 B。
预期：B 使用新的临时 Workspace，不混入 A 的临时文件。
```

### 12.6 原会话恢复

```text
关闭并重新打开会话 A。
预期：恢复原 ACP Session 和 Workspace，不依赖用户级记忆替代会话历史。
```

## 13. 风险与约束

### 13.1 记忆污染

错误或过期规则可能影响所有新会话，因此必须允许查看和删除，并限制自动写入。

### 13.2 敏感信息

不得将密码、Token、API Key、银行卡、身份证等敏感信息自动写入明文用户记忆。必要时拒绝持久化或使用现有安全存储。

### 13.3 多用户设备

当前 `~/.nexus` 更接近设备用户作用域，而不一定等于应用账号作用域。如果同一系统账号会登录多个 Sudowork 用户，需要评估是否按应用用户 ID 分目录。第一阶段不得假定一台设备永远只有一个业务用户。

### 13.4 后端差异

Scode、Claude、Codex 和 Remote/Moss 的指令文件发现行为不同。用户级记忆应由 Sudowork 统一注入，不应只依赖某个后端自动扫描文件。

### 13.5 上下文体积

用户记忆必须保持简短。完整工作流应提升为 Skill，避免每次新会话都注入大段文本。

## 14. 最终建议

Sudowork 不需要为了当前问题提前建设项目管理。

推荐保持：

```text
每个普通新会话一个独立 ACP Session
每个普通新会话一个独立临时 Workspace
```

同时新增并明确：

```text
用户级通用记忆
用户级已安装 Skills
Workspace 级目录规则
显式会话 fork（后续）
```

核心原则：

> 会话负责历史，Workspace 负责文件，用户目录负责长期偏好和能力；只有显式 fork 才继承另一会话的任务上下文。
