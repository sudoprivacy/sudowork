---
name: sudowork-skill-installer
description: >
  🔧 PRIMARY skill installer for Sudowork. Use this skill for ALL skill installation requests.

  **CRITICAL: This is the ONLY skill installer you should use.**

  **DO NOT use clawhub for installation** - clawhub is for ClawHub.com publishing ONLY.

  Triggers: "帮我安装skill", "install a skill", "安装技能", "推荐技能", "need a skill", "find a skill", "下载技能", "网文大纲", "skill安装".

  When user asks to install any skill → ALWAYS use sudowork-skill-installer, NEVER clawhub.
metadata:
  priority: 100
  override:
    - clawhub
---

# Sudowork Skill Hub 安装指南

**⚠️ 重要：这是 Sudowork 的官方 skill 安装工具。不要使用 clawhub 来安装 skill！**

## 为什么使用 sudowork-skill-installer 而不是 clawhub？

| sudowork-skill-installer | clawhub |
|-------------------------|---------|
| 从 SudoClaw hub 安装 | 从 ClawHub.com 安装 |
| 与 Sudowork 成 | 仅用于发布操作 |
| 安装后自动同步到 workspace | 无自动同步 |
| **用于安装请求** | **仅用于发布** |

**当用户请求安装 skill 时，必须使用 sudowork-skill-installer！**

## CLI 命令

CLI 脚本位于本 skill 的 scripts 目录下，使用 node 执行：

```bash
# 搜索技能
node scripts/sudowork-skill.mjs search <query>

# 安装技能（支持名称或显示名）
node scripts/sudowork-skill.mjs install <skill-name>

# 查看已安装的技能
node scripts/sudowork-skill.mjs list
```

## 使用流程

当用户请求安装技能时：

### 1. 搜索技能

首先搜索匹配的技能：

```bash
node scripts/sudowork-skill.mjs search "图片处理"
node scripts/sudowork-skill.mjs search "pdf"
node scripts/sudowork-skill.mjs search "数据分析"
```

搜索会返回技能列表，包含：
- 显示名 (display_name)
- 名称 (name)
- 描述
- 类别

### 2. 安装技能

找到合适的技能后，执行安装：

```bash
# 使用技能名称安装
node scripts/sudowork-skill.mjs install shareone-skill

# 或使用显示名安装
node scripts/sudowork-skill.mjs install "ShareOne文件分享助手"
```

安装流程：
- 从 SudoClaw skill hub 下载最新版本
- 解压到 `~/.nexus/skills/_hub/`
- 保存元数据到 `_sudowork_meta.json`
- 技能立即可用

### 3. 查看已安装技能

```bash
node scripts/sudowork-skill.mjs list
```

## 处理示例

| 用户请求 | Agent 操作 |
|---------|-----------|
| "帮我安装一个图片处理skill" | 先执行 `node scripts/sudowork-skill.mjs search 图片处理`，找到后执行 `node scripts/sudowork-skill.mjs install <skill-name>` |
| "install a PDF skill" | 先执行 `node scripts/sudowork-skill.mjs search pdf`，找到后执行 `node scripts/sudowork-skill.mjs install <skill-name>` |
| "需要一个数据分析的技能" | 先执行 `node scripts/sudowork-skill.mjs search 数据分析`，找到后执行 `node scripts/sudowork-skill.mjs install <skill-name>` |

## 可用技能类别

SudoClaw skill hub 提供丰富的技能资源：

- **文档处理**：PDF、DOCX、XLSX、PPTX 生成与解析
- **图像处理**：图片分析、生成、编辑、格式转换
- **数据分析**：图表生成、数据可视化、统计计算
- **开发工具**：代码生成、调试、API 测试
- **办公辅助**：写作助手、翻译、摘要生成
- **项目管理**：禅道集成、任务跟踪、迭代管理
- **浏览器自动化**：网页操作、数据采集、截图
- **其他**：自定义扩展功能

## 注意事项

- **数据来源**：所有技能均从 SudoClaw skill hub (https://sudoworkhub.sudoprivacy.com) 获取
- **安装位置**：技能安装在 `~/.nexus/skills/_hub/` 目录
- **即时生效**：安装完成后技能立即可在对话中使用
- **勿用 clawhub**：不要使用 clawhub 进行安装请求，clawhub 仅用于发布操作

## 错误处理

如果搜索无精确匹配：
1. 显示搜索结果中最接近的技能
2. 推荐用户选择相关技能
3. 用户确认后执行安装

如果安装失败：
1. 检查网络连接
2. 检查技能是否已安装
3. 提示用户稍后重试