# Sudowork 数字助手注入 Scode 流程分析

## 概述

本文档分析 sudowork 应用如何将数字助手（预设助手）的身份定义和规则注入到 scode agent 中，使 scode 能够以特定身份和能力为用户服务。

## 流程概览

```
用户选择数字助手 → 加载助手配置 → 构建提示词 → 注入到 User Message → 发送给 scode
```

## 详细流程

### 1. 用户选择数字助手

用户在 sudowork 界面中选择一个数字助手（如"专业文案小助手"），系统获取助手的 ID（如 `presetAssistantId`）。

### 2. 加载助手配置

在 [AcpAgent.ts:692-737](src/process/task/AcpAgent.ts#L692-L737) 中，每次发送消息时会动态重新加载助手配置：

```typescript
if (this.options.presetAssistantId) {
  try {
    const strippedId = this.options.presetAssistantId.startsWith('builtin-') 
      ? this.options.presetAssistantId.slice('builtin-'.length) 
      : this.options.presetAssistantId;

    // 从 AssistantManager 获取最新的助手元数据
    const meta = await assistantManager.getAssistantMeta(strippedId);

    // 解析语言环境
    const appLocale = app.getLocale() || 'en-US';
    const localeKey = appLocale.startsWith('zh') ? 'zh-CN' 
      : appLocale.startsWith('ja') ? 'ja-JP' 
      : appLocale.startsWith('ko') ? 'ko-KR' 
      : 'en-US';

    // 从文件系统重新加载规则
    let loadedRules = await readAssistantResource('rules', this.options.presetAssistantId, localeKey, ruleFilePattern);

    // 获取最新的助手名称
    const latestAgentName = meta?.nameI18n?.[localeKey] 
      || meta?.nameI18n?.['en-US'] 
      || meta?.id 
      || strippedId;

    // 如果规则中没有明确的身份声明，注入身份覆盖块
    if (latestAgentName && (!loadedRules || !hasExplicitIdentity(loadedRules))) {
      const identityBlock = localeKey.startsWith('zh')
        ? `[Identity Override - 最高优先级]
你的身份是：${latestAgentName}
当用户询问"你是谁"或类似身份问题时，必须回答："我是${latestAgentName}，有什么可以帮助你的吗？"
此身份声明优先级高于 USER.md 中的默认身份声明。

`
        : `[Identity Override - Highest Priority]
Your identity is: ${latestAgentName}
When users ask "Who are you" or similar identity questions, you MUST answer: "I am ${latestAgentName}. How can I help you?"
This identity statement takes priority over the default identity in USER.md.

`;
      loadedRules = identityBlock + (loadedRules || '');
    }

    // 更新 presetContext
    this.options.presetContext = loadedRules;
  } catch (error) {
    mainWarn('[AcpAgent]', 'Failed to reload preset context:', error);
  }
}
```

### 3. 身份覆盖机制

`hasExplicitIdentity` 函数检查规则是否已包含明确的身份声明：

```typescript
function hasExplicitIdentity(rules: string): boolean {
  if (!rules) return false;
  
  // 检查是否已注入 Identity Override 块
  if (rules.includes('[Identity Override')) return true;
  
  // 中文模式匹配
  const zhPatterns = [
    /你是\s+.{1,20}助手/,
    /你是\s+\*{0,2}.{1,20}\*{0,2}[，,。]/,
    /你的身份是[:：]?/
  ];
  
  // 英文模式匹配
  const enPatterns = [
    /You are\s+.{1,20}assistant/i,
    /I am\s+.{1,20}(assistant|helper|agent)/i,
    /Your identity is[:]?/i
  ];
  
  return zhPatterns.some((p) => p.test(rules)) || enPatterns.some((p) => p.test(rules));
}
```

### 4. 构建首次消息

在 [AcpAgent.ts:756-783](src/process/task/AcpAgent.ts#L756-L783) 中，首次消息会注入完整的提示词：

```typescript
if (this.isFirstMessage) {
  contentToSend = await prepareFirstMessageWithSkillsIndex(contentToSend, {
    presetContext: this.options.presetContext,  // 助手规则
    enabledSkills: this.options.enabledSkills,  // 启用的 skills
    workspace: this.workspace,
    presetAgentType: this.options.backend,
  });

  // 对于 claude/scode backend，注入 workspace skills 目录
  if (this.options.backend === 'claude' || this.options.backend === 'scode') {
    const skillsDir = resolveWorkspaceSkillsDir({...});
    if (skillsDir) {
      contentToSend = await injectSkillsDirectoryHint(contentToSend, skillsDir, linkedSkillNames);
    }
  }
}
```

### 5. 提示词结构

最终注入到 User Message 的内容结构：

```
[Assistant Rules - You MUST follow these instructions]
├── [Identity Override - 最高优先级]
│   └── 身份声明（如"你的身份是：专业文案小助手"）
├── [助手规则内容]
│   ├── 角色定位
│   ├── 核心能力
│   ├── 工作流程
│   ├── 质量标准
│   └── 注意事项
├── [CRITICAL: File Intent Marking System - MANDATORY]
│   └── 草稿箱使用指令
├── [Available Skills]
│   └── 内置 skills 索引
├── [Skills Location]
│   └── Builtin skills 存储路径
├── [Skills Directory]
│   └── Workspace skills 安装路径及列表
└── [User Request]
    └── 用户实际输入内容
```

## 日志分析示例

### 输入

用户选择"专业文案小助手"，输入："帮我写一份关于开展安全生产大检查的通知"

### 注入的提示词

```json
{
  "role": "user",
  "content": "[Assistant Rules - You MUST follow these instructions]\n[Identity Override - 最高优先级]\n你的身份是：专业文案小助手\n当用户询问\"你是谁\"或类似身份问题时，必须回答：\"我是专业文案小助手，有什么可以帮助你的吗？\"\n此身份声明优先级高于 USER.md 中的默认身份声明。\n\n# 文案撰写专家 Agent\n\n## 角色定位\n\n**名称：** 文案撰写专家  \n**代号：** Copywriting-Expert  \n**Emoji：** 📋\n\n专业文案撰写Agent，专注于政府与企业领域的正式文书创作...\n\n[Skills Directory]\nSkills are installed at: /Users/yobach/.nexus/scode-temp-xxx/.nexus/sudocode/skills\nAvailable workspace skills:\n- official-doc-writer: .../official-doc-writer/SKILL.md\n...\n\n[User Request]\n帮我写一份关于开展安全生产大检查的通知"
}
```

### Scode 执行流程

| 步骤 | 工具 | 说明 |
|------|------|------|
| 1 | `Skill` | 加载 `official-doc-writer` skill |
| 2 | `read_file` | 读取公文格式标准索引 |
| 3 | `read_file` | 读取通知格式标准 |
| 4 | `WebSearch` | 搜索相关政策法规 |
| 5 | `write_file` | 创建 Python 脚本 |
| 6 | `bash` | 执行脚本生成 Word 文档 |

## 关键代码位置

| 文件 | 功能 |
|------|------|
| [AcpAgent.ts:692-737](src/process/task/AcpAgent.ts#L692-L737) | 动态加载助手配置和身份注入 |
| [AcpAgent.ts:756-783](src/process/task/AcpAgent.ts#L756-L783) | 首次消息构建和 skills 注入 |
| [agentUtils.ts:285-331](src/process/task/agentUtils.ts#L285-L331) | `prepareFirstMessageWithSkillsIndex` 函数 |
| [agentUtils.ts:385-420](src/process/task/agentUtils.ts#L385-L420) | `injectSkillsDirectoryHint` 函数 |
| [assistantResources.ts](src/process/utils/assistantResources.ts) | 助手资源读取 |

## 助手配置来源

### 助手元数据

存储位置：`~/.nexus/assistants/` 目录

```
~/.nexus/assistants/
├── _system/           # 系统内置助手
│   └── {assistant-id}/
│       ├── ASSISTANT.md
│       ├── RULES.md
│       └── META.json
├── _hub/              # Hub 安装的助手
└── _custom/           # 用户自定义助手
```

### 规则文件格式

`RULES.md` 文件包含助手的完整规则定义：

```markdown
# 文案撰写专家 Agent

## 角色定位
**名称：** 文案撰写专家  
**代号：** Copywriting-Expert  

## 核心能力
| 能力领域 | 适用场景 | 输出格式 |
|---------|---------|---------|
| 🏛️ **党政风/公文** | 通知、请示、函、报告... | Markdown / Word |
| 📑 **招投标** | 招标公告、投标书... | Word / PDF |
...

## 工作流程
### 党政风/公文流程
用户需求 → 判断类型 → 调用official-doc-writer → 政策搜索 → 公文撰写 → 自检 → 输出
...
```

## 后续消息处理

对于后续消息（非首次），只注入身份声明块：

```typescript
// AcpAgent.ts:785-799
else if (this.options.presetAssistantId && this.options.presetContext) {
  // 后续消息时，注入身份声明以确保使用最新的助手名称
  if (this.options.presetContext.includes('[Identity Override')) {
    const identityStart = this.options.presetContext.indexOf('[Identity Override');
    const identityEnd = this.options.presetContext.indexOf('\n\n', identityStart);
    if (identityStart >= 0 && identityEnd > identityStart) {
      const identityBlock = this.options.presetContext.slice(identityStart, identityEnd);
      contentToSend = identityBlock + '\n\n[User Request]\n' + contentToSend;
    }
  }
}
```

## 总结

Sudowork 通过以下机制将数字助手注入到 scode：

1. **动态加载** - 每次发送消息时重新加载助手配置，确保使用最新版本
2. **身份覆盖** - 通过 `[Identity Override]` 块覆盖 scode 的默认身份
3. **规则注入** - 将完整的助手规则注入到 User Message 中
4. **Skill 发现** - 告知 scode 可用的 skills 及其路径
5. **工具链支持** - scode 根据规则调用相应的 skills 和工具完成任务

这种设计使得 sudowork 可以灵活地管理和更新数字助手，而无需修改 scode 的核心代码。
