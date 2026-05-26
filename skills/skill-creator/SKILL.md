---
name: skill-creator
description: 创建或更新 Sudowork 自定义技能，同时保留核心 skill creation / skill-design 最佳实践。用于用户要求创建新技能、优化已有技能、打包导入 Sudowork，或让技能展示在我的技能自定义技能中。
license: Complete terms in LICENSE.txt
---

# 技能创建

使用这个 skill 创建可以在 Sudowork 中作为自定义技能使用的有效技能包。

产物必须仍然是一个标准 skill：根目录包含聚焦的 `SKILL.md`，并可按需附带 `scripts/`、`references/`、`assets/`。同时，产物还必须包含 Sudowork 所需的展示元数据和打包约定，确保可以导入并显示在 Sudowork 的“我的技能 / 自定义技能”中。

## Sudowork 兼容约定

Sudowork 自定义技能包应是一个文件夹或 zip 包，结构如下：

```text
skill-name/
├── SKILL.md
├── _sudowork_meta.json
├── icon.svg or icon.png (推荐但非必需)
├── scripts/ (可选)
├── references/ (可选)
└── assets/ (可选)
```

为了正确显示在 `Sudowork > 设置 > 技能 > 我的技能 > 自定义技能`：

- 将 `SKILL.md` 放在技能根目录。
- 在 `SKILL.md` frontmatter 中使用 hyphen-case 的 `name`，并让它与文件夹名一致。
- 提供 `_sudowork_meta.json`，包含 `display_name`、`description`、`icon`、`emoji`、`categories`、`source_type`、`enabled` 等展示字段。
- 本地创建的自定义技能中，`_sudowork_meta.json` 的 `source_type` 使用 `upload`，`is_builtin` 使用 `false`，`enabled` 使用 `true`。
- 打包为 `.zip`，因为 Sudowork 本地导入入口支持 zip 包和文件夹。
- 创建或更新技能时先写入当前会话的临时空间，也就是 Sudowork 会话页面右侧的文件空间；不要直接写入 workspace skill 同步目录。
- 完成前必须使用 `scripts/install_skill.py` 安装到 `~/.nexus/skills/_my-custom-skill/<skill-name>/`。除非用户明确要求只生成包、不安装，否则不能只创建临时目录或 zip 后结束，也不能只把安装命令交给用户。
- 安装完成后保留会话临时空间里的最终技能目录 `<skill-name>/`，用于 Sudowork 在 turn 结束时校验并同步；不要删除该技能目录。删除 `skill-packages/` 中间打包目录以及其中的 zip 文件，避免临时空间残留打包产物。

不要把用户创建的技能放入 hub 或 system 技能目录；这些目录分别保留给商店技能和内置技能。

## 核心设计原则

### 保持精炼

上下文窗口会同时承载系统提示、对话历史、skill 元数据和任务文件。只写入 agent 难以稳定推断出的流程知识、领域细节和可复用资源。

优先使用简短示例，而不是长篇解释。大型 schema、政策、API 参考、详细示例应移入 `references/`。

### 匹配自由度与风险

根据任务脆弱程度选择约束强度：

- 高自由度：当多个方案都合理时，用文字原则和启发式说明。
- 中自由度：当存在推荐模式但需要少量变化时，用伪代码或参数化脚本。
- 低自由度：当流程脆弱、重复、或需要稳定结果时，提供明确脚本和严格步骤。

### 渐进式披露

技能按层加载：

1. Frontmatter 元数据（`name` 和 `description`）始终可见。
2. `SKILL.md` 正文只在 skill 触发后加载。
3. Bundled resources 只在需要时读取或执行。

保持 `SKILL.md` 精简。若引用额外文档，应直接链接一层以内的 reference 文件，并说明什么时候读取。

### 最佳实践检查清单

在认为技能完成前，检查它是否符合这些核心原则：

- 触发清晰：frontmatter 的 `description` 同时说明技能做什么、什么时候使用。
- 范围聚焦：一个技能只解决一个连贯的问题，不要变成通用资料堆。
- 上下文节省：核心流程写在 `SKILL.md`，大块细节放入 `references/`。
- 资源复用：重复或脆弱操作应沉淀为脚本、模板或 reference。
- 可验证：用真实提示测试技能，并在打包前运行校验脚本。

## 技能结构

### SKILL.md

必需。它包含：

- YAML frontmatter，其中至少包含 `name` 和 `description`。
- Markdown 正文，说明 agent 应如何完成任务。

`description` 是主要触发机制。它应同时包含技能能力和使用场景。不要把“什么时候使用本技能”只写在正文里；正文只有在触发后才会加载。

除非目标运行时明确要求更多字段，否则 frontmatter 保持如下结构：

```yaml
---
name: my-skill
description: 清晰说明这个技能做什么，以及什么时候应该使用它。
---
```

### _sudowork_meta.json

建议每个 Sudowork 自定义技能都提供。它控制技能卡片展示和导入元数据。

使用这个结构：

```json
{
  "id": "",
  "name": "my-skill",
  "display_name": "我的技能",
  "description": "简短的用户可读描述。",
  "icon": "icon.svg",
  "emoji": null,
  "category": "开发",
  "categories": ["开发"],
  "applicable_scenarios": null,
  "core_features": null,
  "homepage": null,
  "author_id": "",
  "source_type": "upload",
  "is_builtin": false,
  "enabled": true,
  "installed_version": "1.0.0",
  "installed_at": "2026-01-01T00:00:00.000Z"
}
```

说明：

- `display_name` 是用户在 UI 中看到的名称。
- `description` 是技能卡片和详情里的描述。
- `icon` 可以是本地文件，例如 `icon.svg`；缺失时 Sudowork 可以回退到上传技能默认图标。
- `categories` 用于面向用户的分类展示。
- `installed_at` 在包内可以使用任意 ISO 时间；Sudowork 导入时会刷新它。

### Bundled Resources

只保留直接支持技能能力的资源。

- `scripts/`：用于确定性或重复操作的可执行 helper。
- `references/`：只在需要时加载的详细文档。
- `assets/`：模板、图片、字体、boilerplate 或输出中会复制使用的文件。

除非技能运行时确实需要，否则不要额外添加 `README.md`、`INSTALLATION_GUIDE.md`、`CHANGELOG.md` 等辅助文档。

## 创建流程

除非某一步明显不适用，否则按顺序执行。

### 1. 理解技能

收集具体例子：

- 技能要帮助用户做什么？
- 哪些用户表达应触发它？
- 哪些输入、文件、服务或领域规则重要？
- Agent 最终应产出什么？

只问必要问题。若用户已经给出足够上下文，直接继续。

### 2. 规划可复用内容

针对每个例子，判断内容应放在哪里：

- `SKILL.md`：核心流程和决策规则。
- `scripts/`：重复、确定性的操作。
- `references/`：详细 schema、API、政策或示例。
- `assets/`：模板和可复用输出素材。

多步骤或分支流程可参考 `references/workflows.md`。需要稳定输出格式时可参考 `references/output-patterns.md`。

### 3. 初始化技能

使用内置初始化脚本。它会创建 `SKILL.md`、`_sudowork_meta.json`、默认图标和示例资源目录。

默认不要传 `--path`，让脚本在当前工作目录中生成草稿。Sudowork Agent 的当前工作目录应是会话 workspace，对应会话页面右侧的“临时空间”。只有用户明确指定另一个会话内目录时才传 `--path`。不要把新技能直接创建到 workspace skill 同步目录，也不要直接创建到 `~/.nexus/skills/_my-custom-skill`。

```bash
scripts/init_skill.py <skill-name>
```

推荐带上展示字段：

```bash
scripts/init_skill.py data-reporter --display-name "数据报告助手" --description "生成结构化数据分析报告。" --category "数据分析" --emoji "📊"
```

初始化后：

- 完成 `SKILL.md` 中的 TODO。
- 更新 `_sudowork_meta.json`，使展示字段匹配最终技能。
- 保留或替换 `icon.svg`。
- 删除未使用的示例文件和空资源目录。

相关脚本：

- `scripts/init_skill.py`：创建新自定义技能。
- `scripts/update_skill.py`：更新已有自定义技能的 name、description、display name、icon、分类等展示字段。
- `scripts/quick_validate.py`：校验技能结构和 Sudowork 元数据。
- `scripts/package_skill.py`：打包为 Sudowork 可导入 zip。
- `scripts/install_skill.py`：把临时目录或 zip 安装到 `~/.nexus/skills/_my-custom-skill/<skill-name>/`。

### 4. 实现技能

为未来会使用该技能的 agent 编写说明：

- 明确写出非显而易见的步骤、约束和质量标准。
- 工作流说明使用命令式表达。
- 当可靠性重要时添加脚本。
- 新增脚本后实际运行测试。
- 在 `SKILL.md` 中让 reference 文件保持可发现。

### 5. 校验技能

运行：

```bash
scripts/quick_validate.py <path/to/skill-folder>
```

打包前修复所有校验错误。校验会检查 `SKILL.md` frontmatter、命名规则，以及 `_sudowork_meta.json` 的 Sudowork 元数据一致性。

### 6. 打包为 Sudowork 可导入格式

运行：

```bash
scripts/package_skill.py <path/to/skill-folder>
```

或指定会话临时空间下的输出目录：

```bash
scripts/package_skill.py <path/to/skill-folder> ./skill-packages
```

打包脚本会先校验，再创建 `<skill-name>.zip`。zip 会保留单个顶层技能目录，符合 Sudowork 本地导入逻辑。

### 7. 安装到 Sudowork 自定义技能

当前只使用个人自定义技能目录。不要写入企业模式 `custom` 目录。

这是创建或更新 Sudowork 自定义技能的必做收尾步骤。临时空间中的技能目录只是草稿；任务完成标准是技能已经进入 `~/.nexus/skills/_my-custom-skill/<skill-name>/` 并可被 Sudowork 重新扫描。不要把“已生成临时目录”“已生成 zip”或“告诉用户运行安装命令”当作完成。

安装后保留临时技能目录，等待 Sudowork 自动校验和同步。不要运行 `rm -rf <skill-dir>` 清理最终技能目录。若存在 `skill-packages/`，安装成功后删除整个 `skill-packages/` 目录及其中的 zip：

```bash
rm -rf ./skill-packages
```

从临时技能目录安装：

```bash
scripts/install_skill.py ./data-reporter --move
```

或从 zip 安装：

```bash
scripts/install_skill.py ./skill-packages/data-reporter.zip
```

预期结果：

- 技能安装到 `~/.nexus/skills/_my-custom-skill/<skill-name>/`。
- 安装脚本写入或刷新 `_sudowork_meta.json`，确保 `source_type: "upload"`、`is_builtin: false`、`enabled: true`。
- 技能出现在 `我的技能 > 自定义技能`。
- 技能默认启用，除非用户手动禁用。

若同名技能已经存在，先确认这是用户想覆盖的目标，再使用：

```bash
scripts/install_skill.py <path/to/staged-skill-or-zip> --replace
```

安装后重启或 reload Sudowork，使运行时重新扫描技能。如果环境权限阻止安装，最终回复必须说明具体阻塞点和应执行的完整安装命令。

### 8. 迭代

真实使用后：

1. 识别 agent 卡住、误判或低效的位置。
2. 更新 `SKILL.md`、脚本、references 或 assets。
3. 重新运行校验。
4. 重新打包并导入 zip 或文件夹。

## 更新已有自定义技能

当用户要求修改已创建的自定义技能时，先把技能复制到当前会话临时空间中更新，完成后再用 `scripts/install_skill.py --replace` 安装回 `~/.nexus/skills/_my-custom-skill/<skill-name>/`。常见修改包括：

- 技能 name：更新文件夹名、`SKILL.md` frontmatter 的 `name`、`_sudowork_meta.json` 的 `name`。
- 技能 description：同时更新 `SKILL.md` frontmatter 的 `description` 和 `_sudowork_meta.json` 的 `description`，确保触发说明与 UI 展示一致。
- 技能头像 / icon：替换 `icon.svg`、`icon.png` 等文件，并更新 `_sudowork_meta.json` 的 `icon` 字段。
- 技能显示名称：更新 `_sudowork_meta.json` 的 `display_name`，不一定需要改技能 `name`。
- 技能标题：更新 `SKILL.md` 的首个 H1 标题，让文件内容与展示名称一致。
- 技能能力：更新 `SKILL.md` 的流程说明、触发场景、质量标准，以及相关 `scripts/`、`references/`、`assets/`。
- 分类、emoji、版本：更新 `_sudowork_meta.json` 的 `category`、`categories`、`emoji`、`installed_version`。

字段边界必须严格：

- 用户说“修改技能名称”“改名”“显示成 XXX”时，默认只修改 UI 展示名称，也就是 `_sudowork_meta.json` 的 `display_name`；可同步更新 `SKILL.md` 首个 H1 标题，但不要修改 `SKILL.md` frontmatter 的 `description` 或 `_sudowork_meta.json` 的 `description`。
- 只有用户明确要求修改“描述”“说明”“触发场景”“适用场景”时，才修改 description。
- 只有用户明确要求修改“技能能力”“执行流程”“怎么做”“规则”时，才修改 `SKILL.md` 正文、`scripts/`、`references/` 或 `assets/`。
- 只有用户明确要求修改 hyphen-case 技能 ID、目录名、内部 name，或给出类似 `ashare-hot-rank` 的名字时，才修改 `SKILL.md` frontmatter 的 `name`、`_sudowork_meta.json` 的 `name` 和目录名。
- 安装或覆盖后，必须读取 `~/.nexus/skills/_my-custom-skill/<skill-name>/_sudowork_meta.json` 和 `~/.nexus/skills/_my-custom-skill/<skill-name>/SKILL.md` 核验最终落盘值。
- 更新完成回复必须只列出安装目录中实际改变的字段；没有修改 description 时，不要声称 description 已修改。如果请求修改 description 但安装目录核验不一致，必须报告失败并继续修正。

### 使用更新脚本

对于 metadata 和头像类更新，优先使用脚本避免漏改字段：

```bash
scripts/update_skill.py <path/to/skill-folder> \
  --name new-skill-name \
  --display-name "新的显示名称" \
  --description "新的技能描述" \
  --icon ./path/to/icon.svg \
  --title "新的文档标题" \
  --category "开发" \
  --emoji "🛠️" \
  --version 1.1.0
```

脚本会：

- 校验新的 hyphen-case `name`。
- 必要时重命名技能目录。
- 仅在传入 `--name` 时更新 `SKILL.md` frontmatter 中的 `name`。
- 仅在传入 `--description` 时更新 `SKILL.md` frontmatter 和 metadata 中的 `description`。
- 更新 `SKILL.md` 的首个 H1 标题；若未传 `--title`，默认跟随 `--display-name` 或 `--name`。
- 更新 `_sudowork_meta.json` 中的展示字段。
- 复制新的 icon 文件到技能目录并更新 `icon` 引用。
- 保持 `source_type: "upload"`、`is_builtin: false`、`enabled: true` 等自定义技能字段。

### 手动更新能力

修改技能本身能力时，不能只改展示 metadata；必须同步更新实际能力来源：

- 改触发和适用场景：更新 `SKILL.md` frontmatter `description`。
- 改执行流程：更新 `SKILL.md` 正文对应章节。
- 改确定性操作：更新或新增 `scripts/`，并实际运行测试。
- 改详细知识：更新 `references/`，并确保 `SKILL.md` 说明什么时候读取。
- 改模板/素材：更新 `assets/`，并删除不再使用的旧资源。

### 更新后的必做检查

每次更新后运行：

```bash
scripts/quick_validate.py <path/to/skill-folder>
scripts/package_skill.py <path/to/skill-folder> ./skill-packages
scripts/install_skill.py <path/to/skill-folder-or-zip> --replace
```

如果技能已经导入 Sudowork：

- 使用 `scripts/install_skill.py --replace` 重新安装到 `~/.nexus/skills/_my-custom-skill/<skill-name>/`。
- 更新后重启或 reload Sudowork。
- 如果修改了 `name`，旧名称对应的已安装技能可能需要先卸载或手动清理，避免新旧技能同时存在。

## 命名规则

- 只使用小写字母、数字和连字符。
- 将用户给出的标题规范化为 hyphen-case，例如 `Plan Mode` 变为 `plan-mode`。
- 名称控制在 64 个字符以内。
- 优先使用短的动作名或领域名，例如 `pdf-redactor`、`salesforce-query`、`brand-review`。

## 交付检查

交付给用户前确认：

- `SKILL.md` 包含有效的 `name` 和 `description`。
- `_sudowork_meta.json` 存在，并与技能内容匹配。
- 未使用的模板资源已删除。
- 如有脚本，已经实际测试。
- 如更新了 name、description、icon 或展示字段，已运行 `scripts/update_skill.py` 或手动同步 `SKILL.md` 与 `_sudowork_meta.json`。
- `scripts/quick_validate.py <skill-dir>` 通过。
- `scripts/package_skill.py <skill-dir>` 能生成 `.zip`。
- `scripts/install_skill.py <skill-dir-or-zip>` 已成功安装到 `~/.nexus/skills/_my-custom-skill/<skill-name>/`；只有用户明确要求不安装或环境权限阻止安装时，才说明未安装原因和是否需要 `--replace`。
