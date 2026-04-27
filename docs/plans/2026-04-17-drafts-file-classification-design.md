# 文件草稿箱智能整理设计

**日期**: 2026-04-17
**状态**: 已确认

---

## 目标

将 Agent 执行过程中的**中间产物**自动归类到 `.drafts/` 目录，将用户**最终意图的文件**保留在工作目录根目录。

---

## 现有问题

现有 `draftsCleanup.ts` 采用**事后清理**模式：

1. Agent Turn 结束后，扫描工作目录根目录
2. 根据固定的扩展名/模式规则判断文件类型
3. 将匹配的文件移动到 `.drafts/`

**问题**：
- 判断规则简单固定，容易漏判/误判
- 文件在根目录短暂存在，用户可能误操作
- 无法理解用户意图，只能靠文件名猜测

---

## 新方案：追问引导 + 智能判断

### 核心流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Turn 执行过程                            │
├─────────────────────────────────────────────────────────────────────┤
│  1. 用户发送消息 → sendMessage                                       │
│     → 保存原始用户请求内容                                            │
│     → 重置文件追踪集合                                                │
├─────────────────────────────────────────────────────────────────────┤
│  2. Agent 执行 → handleToolCallEvent                                 │
│     → 检测写入类工具 (write, edit, create 等)                        │
│     → phase === 'result' 时提取文件路径                              │
│     → 添加到 writtenFilesThisTurn                                    │
├─────────────────────────────────────────────────────────────────────┤
│  3. Turn 结束 → handleEndTurn                                        │
│     → 检查 writtenFilesThisTurn 是否有文件                           │
│     → 有文件：发送追问消息                                            │
│     → 无文件：正常结束                                                │
├─────────────────────────────────────────────────────────────────────┤
│  4. 追问处理                                                          │
│     → 设置状态 awaitingFileClassification = true                    │
│     → 发送追问消息（用户不可见）                                       │
│     → 启动 10 秒超时计时器                                            │
├─────────────────────────────────────────────────────────────────────┤
│  5a. Agent 正常响应                                                   │
│     → 解析 JSON 格式结果                                              │
│     → 执行文件移动                                                    │
│     → 重置状态，结束 Turn                                             │
├─────────────────────────────────────────────────────────────────────┤
│  5b. 超时/格式错误                                                    │
│     → 降级到现有规则判断（扩展名/模式匹配）                            │
│     → 执行文件移动                                                    │
│     → 重置状态，结束 Turn                                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 追问消息格式

```
[File Classification Task]

原始用户请求：
"{原始用户消息内容}"

本次任务写入的文件：
- {workspace}/report.md
- {workspace}/temp_script.py
- {workspace}/helper.py
- {workspace}/data.json

判断标准：
- 最终产物：直接满足用户请求，用户会直接使用或查看的文件（报告、结果数据、完成的文档）
- 中间产物：执行过程中的辅助文件（脚本、临时数据、草稿、步骤输出）

请以以下 JSON 格式回复（仅回复 JSON，不要其他内容）：
{
  "finalFiles": ["<最终产物完整路径>"],
  "intermediateFiles": ["<中间产物完整路径>"]
}
```

---

### JSON 响应格式

Agent 返回：

```json
{
  "finalFiles": ["{workspace}/report.md", "{workspace}/data.json"],
  "intermediateFiles": ["{workspace}/temp_script.py", "{workspace}/helper.py"]
}
```

---

### 执行逻辑

sudowork 解析 JSON 后：

| 分类 | 操作 |
|------|------|
| `finalFiles` | 保留在根目录（如已在 `.drafts/` 则移回根目录） |
| `intermediateFiles` | 移动到 `.drafts/`（处理命名冲突） |

---

### 降级规则

超时（10秒）或 JSON 格式错误时，使用以下规则判断：

#### 中间产物扩展名

```typescript
const INTERMEDIATE_EXTENSIONS = new Set([
  // 脚本文件（执行过程中的辅助代码）
  '.py', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.psm1',
  '.rb', '.pl', '.lua', '.js', '.ts', '.awk', '.sed',
  '.sql',                   // 数据处理脚本
  '.r', '.R',               // R 语言脚本
  '.m', '.mat',             // MATLAB 脚本

  // 临时文件
  '.tmp', '.temp', '.bak', '.backup',
  '.old', '.orig',          // 原始备份
  '.swp', '.swo',           // Vim 交换文件

  // 草稿/工作进度
  '.draft', '.wip', '.todo',
  '.partial', '.incomplete',

  // 日志/调试
  '.log', '.debug', '.trace',

  // 中间数据（处理过程中的临时数据）
  '.cache', '.cached',
  '.intermediate', '.interim',
]);
```

#### 中间产物命名模式

```typescript
const INTERMEDIATE_PATTERNS = [
  // 临时文件前缀
  /^temp[_-]/i, /^tmp[_-]/i,
  /^temporary[_-]/i,

  // 草稿/工作进度
  /^draft[_-]/i, /^wip[_-]/i,
  /^scratch[_-]/i, /^scratchpad[_-]/i,
  /^working[_-]/i, /^work[_-]/i,
  /^proto[_-]/i, /^prototype[_-]/i,
  /^poc[_-]/i,              // Proof of Concept
  /^concept[_-]/i,

  // 辅助/帮助文件
  /^helper[_-]/i, /^util[_-]/i, /^utils[_-]/i,
  /^assist[_-]/i, /^assistant[_-]/i,
  /^tool[_-]/i, /^tools[_-]/i,
  /^lib[_-]/i, /^library[_-]/i,
  /^common[_-]/i, /^shared[_-]/i,

  // 步骤/阶段文件
  /^step[_-]?\d+/i,         // step_1, step2, step-03
  /^phase[_-]?\d+/i,        // phase_1, phase2
  /^stage[_-]?\d+/i,        // stage_1, stage2
  /^round[_-]?\d+/i,        // round_1, round2
  /^iter[_-]?\d+/i, /^iteration[_-]?\d+/i,
  /^pass[_-]?\d+/i,

  // 测试/实验文件
  /^test[_-]/i, /^tests[_-]/i,
  /^experiment[_-]/i, /^exp[_-]/i,
  /^trial[_-]/i, /^attempt[_-]/i,
  /^sample[_-]/i, /^example[_-]/i,
  /^demo[_-]/i, /^playground[_-]/i,

  // 中间版本
  /[_-]v?\d+[_-]draft/i,    // report_v1_draft.md
  /[_-]draft$/i,            // report-draft.md
  /[_-]wip$/i,              // data-wip.csv
  /[_-]temp$/i,             /[_-]tmp$/i,
  /[_-]backup$/i,           /[_-]bak$/i,
  /[_-]old$/i,              /[_-]orig$/i,
  /[_-]partial$/i,          /[_-]incomplete$/i,

  // 处理阶段标记
  /[_-]raw[_-]/i,           // data_raw_processed.csv (原始数据是中间产物)
  /[_-]source[_-]/i,        // data_source_final.csv
  /[_-]input[_-]/i,         // script_input_output.py
  /[_-]pre[_-]/i,           // data_pre_final.csv
  /[_-]intermediate$/i,     // result_intermediate.json
];
```

#### 最终产物保护规则

以下文件**不应**被移动到 `.drafts/`（即使匹配中间产物规则）：

```typescript
const FINAL_FILE_PATTERNS = [
  // 最终结果标记
  /[_-]final$/i,            // report-final.md
  /[_-]final[_-]/i,         // data_final_processed.csv
  /[_-]result$/i,           // analysis_result.json
  /[_-]output$/i,           // task_output.csv
  /[_-]completed$/i,        // report_completed.md
  /[_-]done$/i,             // task_done.txt
  /[_-]finished$/i,         // analysis_finished.md

  // 用户明确请求的文件名模式（如用户说"创建 report.md"）
  // 此规则需要结合用户原始请求动态判断
];

const FINAL_FILE_EXTENSIONS = new Set([
  // 通常作为最终产物的文档格式
  '.md', '.txt', '.pdf', '.docx', '.doc',
  '.xlsx', '.xls', '.csv',           // 数据表格（可能是最终数据）
  '.json', '.yaml', '.yml',          // 配置/数据（可能是最终配置）
  '.html', '.htm', '.pptx', '.ppt',  // 演示/网页
  '.png', '.jpg', '.jpeg', '.gif',   // 图片（可能是最终输出）
  '.svg', '.webp',
]);
```

#### 排除文件（永不移动）

```typescript
const EXCLUDED_NAMES = new Set([
  // 目录
  DRAFTS_DIR_NAME, '.git', '.gitignore', '.github',
  'node_modules', '.node_modules',
  '.drafts', 'drafts',         // 草稿目录本身

  // 配置文件
  '.env', '.env.local', '.env.production',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml',
  'tsconfig.json', 'jsconfig.json',
  '.npmrc', '.yarnrc', '.yarnrc.yml',
  'Cargo.toml', 'go.mod', 'go.sum',
  'requirements.txt', 'pyproject.toml',
  'Makefile', 'Dockerfile', 'docker-compose.yml',

  // 文档/说明
  'README.md', 'readme.md', 'README.txt',
  'LICENSE', 'license', 'LICENSE.md',
  'CHANGELOG.md', 'changelog.md',
  'CONTRIBUTING.md',
]);
```

#### 判断优先级

```
1. 排除文件 → 永不移动
2. 最终产物保护规则 → 保留在根目录（即使匹配中间产物规则）
3. 中间产物扩展名 → 移动到 .drafts/
4. 中间产物命名模式 → 移动到 .drafts/
5. 默认 → 保留在根目录（保守策略）
```

#### 示例判断

| 文件名 | 判断结果 | 原因 |
|--------|----------|------|
| `report.md` | 保留 | 最终产物扩展名 `.md` |
| `report-final.md` | 保留 | 匹配最终产物保护规则 `[_-]final$` |
| `report-draft.md` | 移动 | 匹配中间产物规则 `[_-]draft$` |
| `temp_script.py` | 移动 | 匹配中间产物规则 `^temp[_-]` + 扩展名 `.py` |
| `helper.py` | 移动 | 匹配中间产物规则 `^helper[_-]` |
| `step_1_data.json` | 移动 | 匹配中间产物规则 `^step[_-]?\d+` |
| `data_final.csv` | 保留 | 匹配最终产物保护规则 `[_-]final[_-]` |
| `data_raw.json` | 移动 | 匹配中间产物规则 `[_-]raw[_-]` |
| `package.json` | 保留 | 排除文件 |
| `analysis_result.json` | 保留 | 匹配最终产物保护规则 `[_-]result$` |

---

### 状态管理

```typescript
interface FileClassificationState {
  awaitingFileClassification: boolean;      // 是否等待追问响应
  writtenFilesThisTurn: Set<string>;        // 本轮写入的文件路径
  originalUserRequest: string | null;       // 原始用户请求
  classificationTimeoutId: NodeJS.Timeout | null;  // 超时计时器
}
```

---

### 用户可见性

| 内容 | 用户可见性 |
|------|------------|
| 追问消息 | 不可见（内部发送） |
| Agent JSON 响应 | 不可见（拦截处理） |
| 文件整理结果 | 可见（可选：显示系统提示"已整理 X 个文件到草稿箱"） |

---

### 实现要点

1. **文件追踪**
   - 在 `handleToolCallEvent` 中检测写入类工具
   - 使用 `inferToolKind` 判断工具类型（'edit' 类型）
   - 从 `args` 中提取文件路径

2. **追问发送**
   - 使用内部 WebSocket 发送，不通过正常消息通道
   - 追问消息标记为系统消息，不存入聊天历史

3. **响应拦截**
   - 检测 JSON 格式响应（以 `{` 开头，以 `}` 结尾）
   - 在状态 `awaitingFileClassification === true` 时拦截处理
   - 不转发给 UI 显示

4. **超时处理**
   - 使用 `setTimeout` 设置 10 秒超时
   - 超时后立即降级到规则判断
   - 清理状态并结束 Turn

5. **文件移动**
   - 使用 `fs.rename` 移动文件
   - 处理命名冲突（追加时间戳）
   - 确保 `.drafts/` 目录存在

---

### 影响范围

| 文件 | 修改内容 |
|------|----------|
| `OpenClawAgent.ts` | 添加文件追踪、追问发送、响应拦截、状态管理 |
| `draftsCleanup.ts` | 保留降级规则逻辑，移除自动执行（改为按需调用） |
| `agentUtils.ts` | `buildDraftsInstruction` 可简化或移除 |

---

### 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Agent 返回非 JSON 格式 | 降级到规则判断 |
| Agent 未响应追问 | 10 秒超时后降级 |
| 文件路径不在工作目录 | 过滤非工作目录路径 |
| JSON 中文件路径不匹配 | 使用模糊匹配或忽略不存在的路径 |

---

## 下一步

进入实现阶段，创建详细的实现计划。