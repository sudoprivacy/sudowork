# Scode Memory 历史背景与当前逻辑

> 本文记录 Sudowork 集成 Scode Memory 的历史背景、文件归属、旧链路问题，以及里程碑 A 完成后的当前逻辑。
>
> 本文不描述普通聊天历史召回的完整实施方案；相关任务见 `docs/plans/2026-08-05-用户记忆跨会话现状及修复方案.md`。

## 1. 先说结论

过去并不是 Sudowork 有意为每个聊天会话复制一份用户记忆，而是两个合理但不匹配的设计叠加在一起：

1. Scode 默认把 `cwd` / Workspace 当作代码项目，并按 Workspace 隔离 Memory；
2. Sudowork 默认给每个普通聊天会话创建不同的临时 Workspace。

因此，Scode 会把不同聊天会话误认为不同项目：

```text
会话 A → 临时 Workspace A → Workspace Memory A
会话 B → 临时 Workspace B → Workspace Memory B
```

里程碑 A 完成后，Sudowork 显式为 Scode 指定按用户隔离的稳定 Memory 目录：

```text
会话 C ─┐
会话 D ─┼→ 当前用户统一 Memory 目录
会话 E ─┘
```

不同会话仍使用不同 Workspace，但不再各自拥有一套用户 Memory。

## 2. Scode 为什么默认按 Workspace 保存 Memory

Scode 最初是面向代码项目的 Agent。它默认认为：

```text
不同 cwd / Workspace = 不同代码项目
```

项目之间通常确实需要隔离记忆。例如：

```text
项目 A 使用 bun，测试命令是 bun run test
项目 B 使用 pnpm，测试命令是 pnpm test
```

如果两个项目共用一套项目记忆，规则和上下文会互相污染。因此 Scode 默认根据 Workspace 路径派生项目键，并使用：

```text
~/.scode/projects/<workspace-key>/memory/
├── MEMORY.md
└── <具体记忆文件>.md
```

其中：

- `MEMORY.md` 是索引；
- 具体记忆文件保存用户事实、反馈、项目背景等内容；
- Memory 默认作用域由 Scode 当前 `cwd` 决定。

这个设计对代码项目合理，但不适合把每个普通聊天会话都视为一个新 Workspace 的产品。

## 3. Sudowork 为什么放大了这个问题

Sudowork 为了隔离不同会话的附件、临时文件和交付物，默认给每个本地 Scode Conversation 创建独立临时 Workspace：

```text
会话 A → ~/.nexus/scode-temp-<timestamp-A>
会话 B → ~/.nexus/scode-temp-<timestamp-B>
```

相关入口：

```text
src/process/initAgent.ts
```

从 Sudowork 视角看，这是会话文件隔离；从 Scode 视角看，则是两个不同项目。因此旧链路变成：

```text
会话 A
→ Workspace A
→ ~/.scode/projects/<workspace-A-key>/memory/

会话 B
→ Workspace B
→ ~/.scode/projects/<workspace-B-key>/memory/
```

结果是：

- 会话 A 保存的记忆只属于 Workspace A；
- 会话 B 会得到新的 Workspace Memory；
- Scode Memory 写入成功，但无法表现为用户级跨会话记忆；
- 记忆不是被复制了多份，而是被分散到了多个互不共享的作用域。

## 4. 历史上各文件是谁创建的

### 4.1 `~/.scode/projects/<workspace-key>/memory/MEMORY.md`

直接创建和管理者：**Scode 原生 Memory 系统**。

Sudowork 过去没有直接创建这些文件。Scode 根据当前 Workspace 推导 Memory 目录，并通过自己的 Memory/文件工具维护：

```text
MEMORY.md
user_name.md
feedback_quote_lookup_order.md
...
```

### 4.2 `<workspace>/.nexus/sudocode/AGENTS.md`

直接创建和更新者：**Sudowork**。

调用链：

```text
创建 Scode 会话
→ src/process/initAgent.ts
→ ensureWorkspaceAgentsMdRules(workspace)
→ src/process/services/scode/ScodeInstallService.ts
→ fs.mkdirSync(...)
→ fs.writeFileSync(...)
```

Sudowork 使用该文件向 Scode 注入身份、时间查询、文件安全和 Memory 操作规则。它是 Workspace 运行规则文件，不是 Scode 原生 Memory 索引。

### 4.3 `<workspace>/AGENTS.md`

历史上的 Memory 内容通常由：**Scode 根据旧规则创建或更新**。

旧版 Sudowork 托管规则曾要求 Scode 在用户要求记忆时优先更新 Workspace 下的 `AGENTS.md`。因此 Scode 可能在其中追加：

```md
## Memory

- 用户名叫“小黑”。
```

该文件仍属于单个临时 Workspace，不能跨普通新会话共享。

### 4.4 `<workspace>/.drafts/MEMORY.md`

产生者：**Sudowork 文件跟踪/归档逻辑的副作用**。

这是 Memory 文件被误判成普通任务文件后进入 `.drafts` 的结果，不是正确的 Memory 存储设计。

### 4.5 当前的 `user-memory/<user-key>/MEMORY.md`

目录由：**Sudowork 创建并传给 Scode**。

文件内容由：**Scode 原生 Memory 系统维护**。

Sudowork 负责确定用户作用域和目录位置；Scode 仍负责 `MEMORY.md` 与具体记忆文件的格式、读写和更新。

## 5. 旧逻辑中为什么会出现多套落点

旧链路同时存在三种机制：

```text
1. Scode 原生 Workspace Memory
   ~/.scode/projects/<workspace-key>/memory/

2. Sudowork 托管的 Workspace 规则
   <workspace>/.nexus/sudocode/AGENTS.md

3. Scode 按旧规则更新的 Workspace 指令
   <workspace>/AGENTS.md
```

同时，Sudowork 的文件跟踪逻辑还可能把 Memory 误当成普通交付文件。

因此历史问题并不只是“跨会话读不到”，还包括：

- 用户级事实来源不唯一；
- Workspace 规则与 Scode 原生 Memory 职责重叠；
- 内部 Memory 路径被当作普通 Workspace 路径；
- `MEMORY.md` 可能被展示或归档为用户交付物。

## 6. Scode 已有的解耦能力

嵌入版 `scode 0.1.16` 已验证支持：

```text
SUDOCODE_MEMORY_DIR=<stable-memory-path>
```

设置该环境变量后，Scode 不再根据当前 Workspace 推导 Memory 目录，而是直接使用指定目录。

真实二进制合同测试已经验证：两个不同 cwd 设置同一个 `SUDOCODE_MEMORY_DIR` 后，Scode 的 system prompt 指向同一个 Memory 目录。

该能力让下面三个作用域可以彼此独立：

```text
Scode cwd       = 当前会话独立 Workspace
Scode session   = 当前 Conversation 独立 ACP Session
Scode memory    = 当前用户稳定 Memory 目录
```

## 7. 里程碑 A 后的当前逻辑

### 7.1 当前目录结构

Memory 根目录：

```text
~/.nexus/sudowork/sudocode/user-memory/
```

游客：

```text
~/.nexus/sudowork/sudocode/user-memory/guest/
```

登录用户：

```text
~/.nexus/sudowork/sudocode/user-memory/<sha256-user-key>/
```

登录用户的 `<user-key>` 使用以下逻辑派生：

```text
personal:<user-id>   → SHA-256 → 目录名
enterprise:<user-id> → SHA-256 → 目录名
```

这样可以保证：

- 原始用户 ID 不直接暴露在文件路径中；
- 个人账号与企业账号即使 ID 相同也不会共用 Memory；
- 游客使用独立固定作用域；
- 同一用户重新登录后仍映射到同一目录。

相关代码：

```text
src/process/services/scode/scodePaths.ts
src/process/task/AcpAgent.ts
```

### 7.2 启动 Scode 时的链路

当前用户会话启动 Scode 时：

```text
读取当前账号类型和用户 ID
→ 生成 personal:/enterprise: 作用域
→ SHA-256 派生 user-key
→ 创建 user-memory/<user-key>/
→ 设置 SUDOCODE_MEMORY_DIR
→ 启动 Scode ACP
```

游客没有用户 ID，直接使用：

```text
SUDOCODE_MEMORY_DIR=~/.nexus/sudowork/sudocode/user-memory/guest
```

`SUDOCODE_MEMORY_DIR` 只注入面向用户的 `AcpAgent` Scode 会话。后台本地知识库构建等 Scode 任务不会自动读取用户 Memory。

### 7.3 会话和 Workspace 的当前关系

```text
会话 C Workspace ─┐
会话 D Workspace ─┼→ 用户 A Memory
会话 E Workspace ─┘

会话 F Workspace ───→ 用户 B Memory
游客会话 Workspace ─→ guest Memory
```

因此：

- C、D、E 的 Workspace 仍然互相隔离；
- C、D、E 的用户 Memory 是同一份；
- 用户 A、用户 B 和游客的 Memory 互相隔离；
- Memory 不再跟随 Conversation Workspace 生命周期。

### 7.4 账号切换处理

`AcpAgent` 在每次发送消息前重新计算当前账号的 Memory 目录。

如果发现运行中的 Scode 使用了旧账号目录：

```text
断开旧 Scode 连接
→ 清除旧 ACP Session ID
→ 切换 SUDOCODE_MEMORY_DIR
→ 使用当前账号重新连接
```

这样可以避免在退出用户 A、登录用户 B 后，旧会话继续向用户 A 的 Memory 写入数据。

### 7.5 Workspace AGENTS.md 的当前职责

当前托管规则已改为：

- 用户 Memory 使用 Scode 原生 persistent Memory；
- 不把用户记忆写入 Workspace 下的任何 `AGENTS.md`；
- `.nexus/sudocode/AGENTS.md` 只负责运行规则；
- 不在面向用户的回复中暴露内部 Memory 文件名和路径。

相关代码：

```text
src/process/services/scode/ScodeInstallService.ts
```

### 7.6 内部 Memory 文件的当前展示规则

以下路径被视为内部数据：

```text
~/.nexus/sudowork/sudocode/user-memory/**
```

`AcpAgent` 会在主进程中过滤这些文件对应的：

- ACP Write/Edit 工具调用卡片；
- 普通文件操作消息；
- Workspace 文件跟踪；
- 交付物列表；
- 频道文件发送；
- `.drafts` 归档。

用户应只看到类似：

```text
已记住：你的测试代号是“蓝鲸-7429”。
```

而不应看到：

```text
MEMORY.md
user_name.md
~/.nexus/sudowork/sudocode/user-memory/...
```

## 8. 当前各存储层的职责

| 存储层 | 当前用途 | 是否跨会话 | 管理者 |
|---|---|---:|---|
| Conversation Workspace | 附件、任务文件、草稿、项目规则 | 否 | Sudowork / Agent |
| `user-memory/<user-key>/` | 用户事实、偏好、长期规则 | 是，同一用户共享 | Sudowork 定目录，Scode 管内容 |
| 聊天数据库 | 原始用户消息和助手回复 | 已持久化，但尚未自动跨会话召回 | Sudowork |
| `~/.scode/projects/*/memory/` | 旧版 Workspace Memory | 仅原 Workspace | Scode |
| `<workspace>/.nexus/sudocode/AGENTS.md` | Workspace 运行与安全规则 | 否 | Sudowork |

## 9. 当前仍未完成的能力

### 9.1 旧 Memory 尚未迁移

以前的记忆仍保留在：

```text
~/.scode/projects/*/memory/
```

这些内容不会自动进入新的统一目录，也不会被自动删除。

原因是旧数据可能包含：

- 测试记忆；
- 重复项；
- 已过期内容；
- 相互冲突的事实。

旧数据将在里程碑 B 中盘点，并由用户确认后迁移。

### 9.2 普通聊天历史尚未自动召回

当前统一的是 Scode 用户 Memory，不等于已经实现完整聊天历史召回。

例如：

```text
会话 A：这次只查北京，客户关注交付时间，先做简版。
会话 B：继续上次的任务。
```

如果会话 A 的内容没有被提炼成 Scode Memory，会话 B 目前仍不能可靠自动获得全部任务背景。

普通聊天、临时任务条件、决策和未完成事项的相关召回属于里程碑 C。

### 9.3 上游稳定性承诺仍待确认

`SUDOCODE_MEMORY_DIR` 已由当前真实二进制和自动化测试验证，但仍需向 Scode 上游确认长期兼容承诺。

## 10. 当前验证覆盖

现有自动化验证包括：

- 同一用户 ID 重复解析得到同一目录；
- 不同用户和游客得到不同目录；
- 原始用户 ID 不出现在路径中；
- 真实 Scode 二进制在两个不同 cwd 下读取同一个 `SUDOCODE_MEMORY_DIR`；
- Workspace 托管规则不再要求写入 Workspace `AGENTS.md`；
- Memory 内部路径可以被主进程识别和过滤；
- TypeScript 和相关 ESLint 检查通过。

相关测试：

```text
tests/unit/scodeConfigIsolation.test.ts
tests/unit/ScodeInstallService.test.ts
tests/integration/scodeConfigHomeIsolation.integration.test.ts
```

## 11. 一句话理解

### 过去

```text
每个会话有独立 Workspace
→ Scode 把每个 Workspace 当作独立项目
→ 用户记忆被分散到多套 Workspace Memory
```

### 现在

```text
每个会话仍有独立 Workspace
+ 当前用户只有一套统一 Memory
→ 文件隔离保留，用户记忆可以跨新会话共享
```
