# Scode Agent 提示词注入分析

## 概述

本文档分析 sudowork 应用中 scode agent 的提示词注入机制，包括注入时机、位置和内容来源。

## 日志分析来源

分析基于 `/Users/yobach/.nexus/logs/scode.log` 日志文件，该日志记录了普通用户模式下与 scode agent 对话的完整请求过程。

## 提示词注入时机

### 整体流程

```
session_started → request_started → http_request_started → request_debug (包含完整请求体)
```

提示词注入发生在 **首次消息发送时**，在 HTTP 请求发送前完成。

### 代码位置

注入逻辑位于 [AcpAgent.ts:756-783](src/process/task/AcpAgent.ts#L756-L783)：

```typescript
if (this.isFirstMessage) {
  contentToSend = await prepareFirstMessageWithSkillsIndex(contentToSend, {
    presetContext: this.options.presetContext,
    enabledSkills: this.options.enabledSkills,
    workspace: this.workspace,
    presetAgentType: this.options.backend,
  });

  if (this.options.backend === 'claude' || this.options.backend === 'scode') {
    const skillsDir = resolveWorkspaceSkillsDir({...});
    if (skillsDir) {
      contentToSend = await injectSkillsDirectoryHint(contentToSend, skillsDir, linkedSkillNames);
    }
  }
}
```

## 提示词结构分析

从日志 `request_debug` 事件的 `body.messages` 可以看到完整的提示词结构：

### 1. System Message（scode 内置）

由 scode 二进制文件自身处理，包含：

- **基础身份提示词**：`"You are Sudo Code, an interactive AI coding agent..."`
- **工具使用规则**：如何使用 Read、Edit、Write 等工具
- **Git 操作规范**：commit message 格式、PR 创建流程等
- **安全指南**：避免引入安全漏洞
- **环境上下文**：工作目录、日期、平台信息

### 2. User Message（sudowork 注入）

由 sudowork 应用动态注入，结构如下：

```
[Assistant Rules - You MUST follow these instructions]
├── presetContext (预设规则，来自助手配置)
├── [CRITICAL: File Intent Marking System - MANDATORY]
│   └── buildDraftsInstruction (草稿箱使用指令)
├── [Available Skills]
│   └── 内置 skills 索引列表
├── [Skills Location]
│   └── Builtin skills 存储路径
├── [Skills Directory]
│   └── Workspace skills 安装路径及列表
└── [User Request]
    └── 用户实际输入内容
```

## 注入函数详解

### prepareFirstMessageWithSkillsIndex

位置：[agentUtils.ts:285-331](src/process/task/agentUtils.ts#L285-L331)

功能：
1. 添加预设规则 (`presetContext`)
2. 添加草稿箱使用指令 (`buildDraftsInstruction`)
3. 加载内置 skills 索引

```typescript
export async function prepareFirstMessageWithSkillsIndex(content: string, config: FirstMessageConfig): Promise<string> {
  const instructions: string[] = [];

  // 1. 添加预设规则
  if (config.presetContext) {
    instructions.push(config.presetContext);
  }

  // 2. 添加草稿箱使用指令
  if (config.workspace) {
    instructions.push(buildDraftsInstruction(config.workspace));
  }

  // 3. 加载内置 skills 索引
  const skillManager = AcpSkillManager.getInstance();
  await skillManager.discoverBuiltinSkills();
  const builtinSkillsIndex = skillManager.getBuiltinSkillsIndex();
  
  if (builtinSkillsIndex.length > 0) {
    const systemSkillsDir = getBuiltinSkillsDir();
    const indexText = buildSkillsIndexText(builtinSkillsIndex);
    // 告诉 Agent 从 builtin skills 目录按需读取
    instructions.push(skillsInstruction);
  }

  return `[Assistant Rules - You MUST follow these instructions]\n${systemInstructions}\n\n[User Request]\n${content}`;
}
```

### injectSkillsDirectoryHint

位置：[agentUtils.ts:385-420](src/process/task/agentUtils.ts#L385-L420)

功能：追加 workspace skills 目录提示

```typescript
export async function injectSkillsDirectoryHint(content: string, skillsDir: string, enabledSkillNames?: string[]): Promise<string> {
  const skillManager = AcpSkillManager.getInstance();
  await skillManager.discoverSkills(enabledSkillNames);
  
  const hint = `[Skills Directory]
Skills are installed at: ${skillsDir}
Each skill has a SKILL.md file containing detailed instructions.

Available workspace skills:
- browser: ${skillsDir}/browser/SKILL.md
- chandao-api: ${skillsDir}/chandao-api/SKILL.md
...`;

  return content.replace('[User Request]', `${hint}\n\n[User Request]`);
}
```

## Skills 路径解析

### Builtin Skills 路径

来源：`getBuiltinSkillsDir()` 函数

```
/Users/yobach/.nexus/skills/_system/_builtin/{skill-name}/SKILL.md
```

### Workspace Skills 路径

由 `resolveWorkspaceSkillsDir` 在 [skillRoots.ts:9-36](src/renderer/pages/conversation/workspace/skillRoots.ts#L9-L36) 解析：

| Backend | Skills 路径 |
|---------|------------|
| `scode` | `{workspace}/.nexus/sudocode/skills` |
| `claude` | `{workspace}/.claude/skills` |
| `openclaw-gateway` | `{workspace}/skills` |
| 其他 | `{workspace}/skills` |

```typescript
export function resolveWorkspaceSkillRoot(workspace: string, eventPrefix: 'acp' | 'openclaw-gateway' = 'acp', backend?: string): { path: string; source: WorkspaceSkillSource } {
  if (eventPrefix === 'openclaw-gateway') {
    return { path: `${workspace}/skills`, source: 'skills' };
  }

  if (backend === 'claude') {
    return { path: `${workspace}/.claude/skills`, source: 'claude-skills' };
  }

  if (backend === 'scode') {
    return { path: `${workspace}/.nexus/sudocode/skills`, source: 'scode-skills' };
  }

  return { path: `${workspace}/skills`, source: 'skills' };
}
```

## 日志中的实际注入示例

从日志第5行 `request_debug` 可以看到完整的注入结果：

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are Sudo Code, an interactive AI coding agent..."
    },
    {
      "role": "user",
      "content": "[Assistant Rules - You MUST follow these instructions]\n[CRITICAL: File Intent Marking System - MANDATORY]\n...\n\n[Available Skills]\n- cron (Scheduled task management...)\n- sudoclaw-skill-installer (...)\n\n[Skills Location]\nBuiltin skills are stored at:\n- /Users/yobach/.nexus/skills/_system/_builtin/{skill-name}/SKILL.md\n\n[Skills Directory]\nSkills are installed at: /Users/yobach/.nexus/scode-temp-1778462715400/.nexus/sudocode/skills\nAvailable workspace skills:\n- browser: .../browser/SKILL.md\n- chandao-api: .../chandao-api/SKILL.md\n- cron: .../cron/SKILL.md\n- docx: .../docx/SKILL.md\n- pdf: .../pdf/SKILL.md\n- pptx: .../pptx/SKILL.md\n- xlsx: .../xlsx/SKILL.md\n...\n\n[User Request]\nhello 你是谁 你安装了哪些skill"
    }
  ]
}
```

## 关键发现

### 1. 注入时机

- 仅在首次消息 (`isFirstMessage === true`) 时注入完整提示词
- 后续消息只注入身份声明（如果存在 `[Identity Override]` 块）

### 2. 注入位置

- 在 User Message 中，以 `[Assistant Rules]` 前缀标识
- System Message 由 scode 二进制文件内置，sudowork 无法修改

### 3. Skills 发现机制

- **Builtin Skills**：通过 `AcpSkillManager.discoverBuiltinSkills()` 扫描 `_system/_builtin` 目录
- **Workspace Skills**：通过 `AcpSkillManager.discoverSkills()` 扫描 workspace skills 目录

### 4. 路径动态解析

- 根据 backend 类型动态确定 skills 安装路径
- 支持 `scode`、`claude`、`openclaw-gateway` 等多种 backend

## 相关文件

| 文件 | 功能 |
|------|------|
| [AcpAgent.ts](src/process/task/AcpAgent.ts) | Agent 主逻辑，控制首次消息注入时机 |
| [agentUtils.ts](src/process/task/agentUtils.ts) | 提示词构建函数 |
| [skillRoots.ts](src/renderer/pages/conversation/workspace/skillRoots.ts) | Skills 路径解析 |
| [AcpSkillManager.ts](src/process/task/AcpSkillManager.ts) | Skills 发现和管理 |

## Skills 发现规则详解

### Skill 存储目录结构

Skills 存储在 `~/.nexus/skills/` 目录下，采用分层结构：

```
~/.nexus/skills/
├── _system/                    # 系统内置 skills
│   └── _builtin/               # 内置 skills（所有场景自动注入）
│       ├── cron/
│       │   └── SKILL.md
│       └── sudoclaw-skill-installer/
│           └── SKILL.md
├── _hub/                       # Hub 安装的 skills
│   ├── browser/
│   │   ├── SKILL.md
│   │   └── _sudowork_meta.json
│   └── docx/
│       └── SKILL.md
├── _my-custom-skill/           # 用户上传的自定义 skills
│   └── my-skill/
│       └── SKILL.md
└── {legacy-skill}/             # 旧版扁平结构（向后兼容）
    └── SKILL.md
```

### Skill 发现流程

由 `AcpSkillManager` 类负责发现和管理 skills：

#### 1. Builtin Skills 发现

```typescript
async discoverBuiltinSkills(): Promise<void> {
  const builtinDir = this.builtinSkillsDir; // ~/.nexus/skills/_system/_builtin
  
  // 扫描目录
  const entries = await fs.readdir(builtinDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const skillName = entry.name;
    const skillFile = path.join(builtinDir, skillName, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    
    // 解析 SKILL.md 的 frontmatter
    const content = await fs.readFile(skillFile, 'utf-8');
    const { name, description } = parseFrontmatter(content);
    
    this.builtinSkills.set(skillName, {
      name: name || skillName,
      description: description || `Builtin Skill: ${skillName}`,
      location: skillFile,
    });
  }
}
```

**规则**：
- 扫描 `_system/_builtin/` 目录
- 只识别包含 `SKILL.md` 文件的子目录
- 从 `SKILL.md` 的 frontmatter 解析 `name` 和 `description`
- **所有场景自动注入**，无需用户启用

#### 2. Hub/Custom Skills 发现

```typescript
async discoverSkills(enabledSkills?: string[]): Promise<void> {
  // 1. 扫描 custom 目录
  await this.discoverSkillsFromDir(this.customSkillsDir, this.customSkills, enabledSkills);
  
  // 2. 扫描 hub 目录
  await this.discoverSkillsFromDir(this.hubSkillsDir, this.hubSkills, enabledSkills);
  
  // 3. 合并到主 skills map（custom 优先级高于 hub）
  for (const [key, skill] of this.customSkills) {
    if (!this.skills.has(key)) this.skills.set(key, skill);
  }
  for (const [key, skill] of this.hubSkills) {
    if (!this.skills.has(key)) this.skills.set(key, skill);
  }
}
```

**发现规则**：

| 条件 | 行为 |
|------|------|
| `enabledSkills === undefined` | 加载所有已安装且启用的 skills |
| `enabledSkills === []` | 不加载任何 skills（预设助手未选择任何 skill） |
| `enabledSkills === ['skill1', 'skill2']` | 只加载指定的 skills |
| skill 的 `_sudowork_meta.json` 中 `enabled === false` | 跳过该 skill |

#### 3. Skill 启用状态检查

```typescript
export async function isUserSkillEnabled(skillName: string): Promise<boolean> {
  const subdirs = ['_my-custom-skill', '_hub', '_system'];
  
  for (const subdir of subdirs) {
    const skillMetaPath = path.join(getSkillsDir(), subdir, skillName, '_sudowork_meta.json');
    try {
      const raw = await fs.readFile(skillMetaPath, 'utf-8');
      const meta = JSON.parse(raw);
      return meta.enabled !== false;  // 默认启用
    } catch {
      // 继续检查下一个目录
    }
  }
  
  // 兼容旧版扁平结构
  const legacyMetaPath = path.join(getSkillsDir(), skillName, '_sudowork_meta.json');
  try {
    const raw = await fs.readFile(legacyMetaPath, 'utf-8');
    const meta = JSON.parse(raw);
    return meta.enabled !== false;
  } catch {
    return true;  // 默认启用
  }
}
```

### SKILL.md 格式要求

每个 skill 必须包含 `SKILL.md` 文件，格式如下：

```markdown
---
name: skill-name
description: Skill description shown in the index
---

# Skill Title

Detailed skill instructions here...

## Usage

...
```

**Frontmatter 解析规则**：
- `name`: Skill 显示名称（可选，默认使用目录名）
- `description`: Skill 描述（可选，默认使用 `Skill: {name}`）

### Workspace Skills 发现

Workspace skills 是链接到当前工作空间的 skills：

```typescript
// 在 AcpAgent.ts 中
if (this.options.backend === 'claude' || this.options.backend === 'scode') {
  const skillsDir = resolveWorkspaceSkillsDir({...});
  if (skillsDir) {
    // 读取目录中的符号链接和子目录
    const linkedSkillNames = await fs.promises
      .readdir(skillsDir, { withFileTypes: true })
      .then((entries) =>
        entries
          .filter((entry) => entry.isSymbolicLink() || entry.isDirectory())
          .map((entry) => entry.name)
      );
    
    contentToSend = await injectSkillsDirectoryHint(contentToSend, skillsDir, linkedSkillNames);
  }
}
```

**Workspace Skills 路径规则**：

| Backend | Skills 路径 |
|---------|------------|
| `scode` | `{workspace}/.nexus/sudocode/skills` |
| `claude` | `{workspace}/.claude/skills` |
| 其他 | `{workspace}/skills` |

### Skill 优先级

当多个位置存在同名 skill 时，优先级为：

```
custom > hub > merged skills > builtin > extension
```

### 扩展 Skills

扩展可以通过 `aion-extension.json` 的 `contributes.skills` 声明贡献 skills：

```typescript
private async discoverExtensionSkills(enabledSkills?: string[]): Promise<void> {
  const registry = ExtensionRegistry.getInstance();
  const extSkills = registry.getSkills();
  
  for (const extSkill of extSkills) {
    // 如果指定了 enabledSkills，只加载被启用的扩展 skills
    if (enabledSkills && !enabledSkills.includes(extSkill.name)) {
      continue;
    }
    
    // 避免与内置/可选 skills 冲突
    if (this.builtinSkills.has(extSkill.name) || this.skills.has(extSkill.name)) {
      continue;
    }
    
    this.extensionSkills.set(extSkill.name, extSkill);
  }
}
```

## 总结

sudowork 应用在发送首次消息给 scode agent 时，会动态注入以下内容：

1. **预设规则** (`presetContext`) - 来自助手配置
2. **草稿箱指令** - 告诉 agent 如何使用 `@draft`/`@final` 标记
3. **Builtin Skills 索引** - 内置 skills 列表及路径
4. **Workspace Skills 目录** - 已安装的 skills 列表及路径

这些信息帮助 agent 了解可用的 skills 和正确的文件处理方式，同时保持 scode 二进制文件的独立性和可维护性。
