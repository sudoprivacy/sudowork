# 草稿箱文件逻辑与用户终止清理逻辑文档

## 概述

本文档详细描述了文件意图检测、草稿文件处理、以及用户终止执行时的**精确清理逻辑**。

**重要更新**: 用户终止时现在只清理当前 Turn 追踪到的草稿文件，而不是删除整个 `.drafts/` 目录。

---

## 一、文件意图分类

### 1.1 文件意图类型

| 类型 | 说明 | 处理方式 |
|------|------|----------|
| **Final** | 最终产物，用户直接使用的文件 | 保留在工作空间根目录 |
| **Draft** | 中间产物，执行过程中的辅助文件 | 移动到 `.drafts/` 目录 |

### 1.2 意图检测优先级

```
1. 文件标记 (@final/@draft)     → 最高优先级
2. 用户请求匹配                  → 用户明确请求的文件 = Final
3. Final 模式匹配                → 覆盖 Draft 规则
4. Draft 模式匹配                → 匹配草稿文件名模式
5. 扩展名规则                    → 根据文件扩展名判断
6. 默认 Final                    → 保守默认策略
```

---

## 二、文件意图检测逻辑

### 2.1 文件标记检测

**位置**: 文件内容前 10 行

**支持的标记**:
```typescript
FILE_INTENT_MARKERS = {
  final: ['@final', '@output', '@deliverable', '@result'],
  draft: ['@draft', '@intermediate', '@temp', '@scratch'],
}
```

**注释语法映射**:
```typescript
COMMENT_SYNTAX_MAP = {
  '.py': '#',      // Python
  '.sh': '#',      // Shell
  '.js': '//',     // JavaScript
  '.ts': '//',     // TypeScript
  '.rs': '//',     // Rust
  '.go': '//',     // Go
  '.md': '<!--',   // Markdown
  '.html': '<!--', // HTML
  default: '#',
}
```

**检测示例**:
```python
# @draft
import csv
# 此文件会被识别为 Draft
```

```javascript
// @final
export function process() {
  // 此文件会被识别为 Final
}
```

### 2.2 文件名模式检测

**Draft 文件名模式**:

| 类型 | 模式 | 示例 |
|------|------|------|
| 前缀 | `temp_`, `temp-`, `tmp_`, `tmp-` | `temp_data.csv`, `tmp-cache.json` |
| 前缀 | `draft_`, `draft-`, `wip_`, `wip-` | `draft_report.md`, `wip-analysis.py` |
| 前缀 | `scratch_`, `proto_`, `poc_` | `scratch_test.py`, `poc_demo.sh` |
| 前缀 | `step_`, `step-`, `step1`, `step2`... | `step1_output.txt`, `step-2.py` |
| 前缀 | `phase_`, `phase-`, `phase1`... | `phase1_data.csv` |
| 后缀 | `_draft`, `-draft`, `_wip`, `-wip` | `report-draft.md`, `analysis_wip.py` |
| 后缀 | `_temp`, `-temp`, `_tmp`, `-tmp` | `data_temp.csv`, `output-tmp.txt` |
| 后缀 | `_backup`, `-backup`, `_bak`, `-bak` | `config_backup.json` |
| 后缀 | `_old`, `-old` | `version_old.py` |

**Draft 文件扩展名**:
```typescript
DRAFT_EXTENSIONS = ['.tmp', '.temp', '.bak', '.backup', '.log', '.cache']
```

**Final 文件名模式**:

| 类型 | 模式 | 示例 |
|------|------|------|
| 后缀 | `_final`, `-final` | `report-final.md` |
| 后缀 | `_result`, `-result` | `analysis_result.json` |
| 后缀 | `_output`, `-output` | `data_output.csv` |
| 后缀 | `_completed`, `-completed` | `task_completed.txt` |
| 后缀 | `_done`, `-done` | `build_done.log` |

**Final 文件扩展名**:
```typescript
FINAL_EXTENSIONS = [
  // 文档
  '.md', '.txt', '.pdf', '.docx', '.pptx',
  // 数据文件
  '.json', '.yaml', '.yml', '.csv', '.xlsx',
  // 代码文件
  '.py', '.sh', '.bash', '.zsh', '.ts', '.tsx', '.js', '.jsx',
  '.rs', '.go', '.java', '.kt', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php', '.lua',
  // 配置文件
  '.toml', '.ini', '.conf', '.cfg',
  // Web/图片
  '.html', '.css', '.scss', '.png', '.jpg', '.svg',
]
```

### 2.3 用户请求匹配

**检测逻辑**:
```typescript
// 从用户消息中提取明确请求的文件名
// 例如: "创建 process_data.py" → requested_files = ["process_data.py"]
// 例如: "写一个 Python 脚本" → requested_types = ["python", "script"]

// 匹配规则
if (requested_files.contains(file_name)) → Final
if (file_extension matches requested_types) → Final
```

---

## 三、文件写入流程

### 3.1 sudocode (Rust) 写入流程

**文件**: `crates/tools/src/lib.rs`

```
用户请求 → write_file 工具
    ↓
run_write_file(input)
    ↓
detect_file_intent(path, content, None)
    ↓
┌─────────────────────────────────────┐
│ intent == Draft?                    │
│   → redirect_to_drafts(path, cwd)   │
│   → actual_path = .drafts/filename  │
│ intent == Final?                     │
│   → actual_path = original_path     │
└─────────────────────────────────────┘
    ↓
write_file(backend, actual_path, content)
    ↓
返回结果
```

**代码实现**:
```rust
fn run_write_file(input: WriteFileInput) -> Result<String, String> {
    // 1. 检测文件意图
    let intent = runtime::detect_file_intent(&input.path, &input.content, None);
    
    // 2. 根据意图决定实际路径
    let actual_path = match intent {
        runtime::FileIntent::Draft => {
            let workspace_root = std::env::current_dir().unwrap_or_default();
            runtime::redirect_to_drafts(&PathBuf::from(&input.path), &workspace_root)
        }
        runtime::FileIntent::Final => PathBuf::from(&input.path),
    };
    
    // 3. 写入文件
    to_pretty_json(write_file(&StdFsBackend, actual_path.to_str().unwrap(), &input.content)?)
}
```

### 3.2 sudowork (TypeScript) 后置清理流程

**文件**: `src/process/task/draftsCleanup.ts`

**触发时机**: 每个 Agent turn 完成后

```
turn 完成
    ↓
cleanupIntermediateFiles(workspace)
    ↓
遍历工作空间根目录文件
    ↓
对每个文件:
    ├─ 读取文件内容 (前10行)
    ├─ 检测文件标记 (@final/@draft)
    ├─ 检测文件名模式 (matchesDraftPattern/matchesFinalPattern)
    └─ 决策: 移动到 .drafts/ 或 保留
    ↓
执行文件移动
    ↓
日志记录
```

**决策逻辑代码**:
```typescript
for (const entry of entries) {
  // 1. 尝试读取文件内容检测标记
  if (content) {
    const intentResult = detectFileIntent(filePath, content);
    if (intentResult.intent === 'draft') {
      filesToMove.push({ name, reason: 'Detected @draft marker' });
      continue;
    }
    if (intentResult.intent === 'final') {
      filesToKeep.push({ name, reason: 'Detected @final marker' });
      continue;
    }
  }
  
  // 2. 检测 Final 模式 (覆盖 Draft 规则)
  if (matchesFinalPattern(name)) {
    filesToKeep.push({ name, reason: 'Matches final pattern' });
    continue;
  }
  
  // 3. 检测 Draft 模式
  if (matchesDraftPattern(name)) {
    filesToMove.push({ name, reason: 'Matches draft pattern' });
    continue;
  }
  
  // 4. 默认保留 (保守策略)
  filesToKeep.push({ name, reason: 'Default final' });
}
```

---

## 四、用户终止清理逻辑（精确清理）

### 4.1 核心设计

**问题**: 之前的实现会删除整个 `.drafts/` 目录，误删其他对话/历史遗留的草稿文件。

**解决方案**: Turn 级别文件追踪 - 只清理当前 Turn 写入的草稿文件。

### 4.2 文件追踪机制

**数据结构**:
```typescript
// AcpAgent 类中的追踪字段
private currentTurnFiles: Map<string, {
  path: string;           // 实际写入路径
  intent: 'draft' | 'final';
  kind: 'create' | 'edit';
}> = new Map();
```

**追踪时机**: 每次 `write_file` / `edit_file` 工具调用完成时

```typescript
// 在 tool_call_update completed 事件中
if (n === 'write_file' || n === 'edit_file') {
  const inputPath = rawInput?.path;
  const content = rawInput?.content;
  
  // 检测文件意图
  let intent: 'draft' | 'final' = 'final';
  if (content) {
    const intentResult = detectFileIntent(inputPath, content);
    if (intentResult.intent === 'draft') {
      intent = 'draft';
    } else if (intentResult.intent === 'final') {
      intent = 'final';
    } else {
      intent = matchesDraftPattern(inputPath) ? 'draft' : 'final';
    }
  }
  
  // 计算实际路径
  const actualPath = intent === 'draft'
    ? path.join(workspace, '.drafts', basename(inputPath))
    : path.join(workspace, inputPath);
  
  // 记录到追踪 Map
  currentTurnFiles.set(inputPath, { path: actualPath, intent, kind });
}
```

**重要**: Turn 结束时清空追踪

```typescript
// AcpAgent: handleEndTurn() 中清空
private handleEndTurn(): void {
  // ... 其他逻辑 ...
  
  // Clear turn-level file tracking for next turn
  this.currentTurnFiles.clear();
  mainLog('[AcpAgent]', '[END_TURN] Cleared currentTurnFiles for next turn');
}

// RemoteAgent: finish 消息处理中清空
if (msg.type === 'finish') {
  this.status = 'finished';
  this.currentTurnFiles.clear();
  mainLog('RemoteAgent', '[FINISH] Cleared currentTurnFiles for next turn');
}
```

这样确保每个 Turn 只追踪当前 Turn 的文件，不会累积历史文件。

### 4.3 触发时机

```
用户点击终止按钮
    ↓
ipcBridge.conversation.stop.emit()
    ↓
conversationBridge 处理
    ↓
task.stop()  // AcpAgent 或 RemoteAgent
    ↓
cleanupTrackedDraftFiles()  // 精确清理追踪到的文件
```

### 4.4 AcpAgent.stop() 流程（更新版）

**文件**: `src/process/task/AcpAgent.ts`

```typescript
async stop(): Promise<void> {
  // 1. 遥测记录
  endConversationUserCancel(this.conversation_id);
  
  // 2. 标记用户取消状态
  this.userCancelled = true;
  
  // 3. 清空流式缓冲区
  this.streamTextBuffer.flushAll();
  
  // 4. 拒绝待处理的权限请求
  for (const [callId, pending] of this.pendingPermissions) {
    pending.reject(new Error('Cancelled'));
  }
  
  // 5. 清空待处理的问题
  for (const [, pending] of this.pendingQuestions) {
    this.emitQuestionCancelled(pending.msgId);
    pending.reject(new Error('Cancelled'));
  }
  
  // 6. 清除确认 UI
  for (const confirmation of this.confirmations) {
    ipcBridge.conversation.confirmation.remove.emit({...});
  }
  
  // 7. 发送取消请求到后端
  let result = await this.connection.cancel(5000);
  
  // 8. 如果后端未响应，强制断开
  if (result === 'abandoned' || result === 'disconnected') {
    await this.connection.disconnect();
  }
  
  // 9. ★ 精确清理追踪到的草稿文件
  if (this.workspace && this.currentTurnFiles.size > 0) {
    this.cleanupTrackedDraftFiles().catch((err) => {
      mainError('[AcpAgent]', 'Failed to cleanup tracked draft files:', err);
    });
  }
  
  // 10. 清除未完成的工具调用
  this.emitClearIncompleteTools();
  
  // 11. 发送用户取消消息
  this.emitUserCancelledMessage();
  
  // 12. 发送 finish 事件
  this.handleStreamEvent({ type: 'finish', ... });
}
```

### 4.5 RemoteAgent.stop() 流程（更新版）

**文件**: `src/process/task/RemoteAgent.ts`

RemoteAgent 同样实现了 Turn 级别文件追踪：

```typescript
class RemoteAgent extends BaseAgent<RemoteAgentData> {
  // Turn-level file tracking for precise cleanup on cancel
  private currentTurnFiles: Map<string, { path: string; intent: 'draft' | 'final'; kind: 'create' | 'edit' }> = new Map();

  async stop(): Promise<void> {
    // 1. 发送中断到 Moss Server 并等待确认
    const confirmed = (await this.connection?.sendInterruptAndWait()) ?? false;

    // 2. ★ 精确清理追踪到的草稿文件
    if (this.workspace && this.currentTurnFiles.size > 0) {
      this.cleanupTrackedDraftFiles().catch((err) => {
        mainError('RemoteAgent', 'Failed to cleanup tracked draft files:', err);
      });
    }

    // 3. 发送用户取消消息
    this.emitUserCancelledMessage();

    // 4. 发送 finish 事件
    this.emitFinishMessage();
  }
}
```

**文件追踪逻辑** (在 `handleStreamMessage` 中):

```typescript
private handleStreamMessage(msg: IResponseMessage): void {
  // ... 现有逻辑 ...

  // ★ Track file operations for precise cleanup on cancel
  if (msg.type === 'acp_tool_call') {
    this.trackFileOperation(msg.data as any);
  }
}

private trackFileOperation(toolCallData: any): void {
  if (!toolCallData) return;

  const toolName = toolCallData.title?.toLowerCase() || '';
  const rawInput = toolCallData.rawInput;
  const status = toolCallData.status;

  // Only track completed write_file/edit_file operations
  if (status !== 'completed') return;
  if (toolName !== 'write_file' && toolName !== 'edit_file') return;

  const inputPath = rawInput?.path as string | undefined;
  const content = rawInput?.content as string | undefined;
  if (!inputPath) return;

  // Detect file intent
  let intent: 'draft' | 'final' = 'final';
  if (content) {
    const intentResult = detectFileIntent(inputPath, content);
    if (intentResult.intent === 'draft') {
      intent = 'draft';
    } else if (intentResult.intent === 'final') {
      intent = 'final';
    } else {
      intent = matchesDraftPattern(inputPath) ? 'draft' : 'final';
    }
  } else {
    intent = matchesDraftPattern(inputPath) ? 'draft' : 'final';
  }

  // Track the file
  const actualPath = intent === 'draft'
    ? nodePath.join(this.workspace, '.drafts', nodePath.basename(inputPath))
    : nodePath.join(this.workspace, inputPath);

  this.currentTurnFiles.set(inputPath, {
    path: actualPath,
    intent,
    kind: toolName === 'write_file' ? 'create' : 'edit',
  });
  mainLog('RemoteAgent', `[TRACK] File: ${inputPath}, intent: ${intent}, actualPath: ${actualPath}`);
}
```

### 4.5 cleanupTrackedFiles() 精确清理逻辑

**文件**: `src/process/task/AcpAgent.ts` 和 `src/process/task/RemoteAgent.ts`

**重要变更**: 用户终止时清理当前 Turn 写入的**所有文件**（包括 draft 和 final），而不是只清理 draft 文件。

原因：
1. 用户终止意味着任务没有完成，所有生成的文件都是不完整的
2. 文件可能被重定向到 `.drafts/`，也可能直接写入工作空间根目录
3. 用户期望终止后工作空间恢复到执行前的状态

```typescript
/**
 * Clean up all tracked files from current turn (both draft and final)
 * 清理当前 Turn 追踪到的所有文件（包括 draft 和 final）
 */
private async cleanupTrackedFiles(): Promise<number> {
  let removedCount = 0;

  for (const [requestedPath, file] of this.currentTurnFiles) {
    try {
      const fullPath = file.path;
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        removedCount++;
        mainLog('[AcpAgent]', `[CLEANUP] Removed tracked file: ${requestedPath} (intent: ${file.intent}, actual: ${fullPath})`);
      } else {
        mainLog('[AcpAgent]', `[CLEANUP] File already removed: ${fullPath}`);
      }
    } catch (err) {
      mainError('[AcpAgent]', `Failed to remove file ${requestedPath}:`, err);
    }
  }

  // Clear tracking
  this.currentTurnFiles.clear();

  if (removedCount > 0) {
    mainLog('[AcpAgent]', `[CLEANUP] Total tracked files removed: ${removedCount}`);
  }

  return removedCount;
}
```

### 4.6 精确清理流程图

```
用户终止执行
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                      AcpAgent.stop()                         │
├──────────────────────────────────────────────────────────────┤
│  1. 标记 userCancelled = true                                │
│  2. 清空流式缓冲区                                            │
│  3. 拒绝待处理请求                                            │
│  4. 发送取消到后端                                            │
│  5. 精确清理追踪到的所有文件 ←──────────────────────────────┐ │
└──────────────────────────────────────────────────────────────┘ │
                               │                                 │
                               ▼                                 │
┌──────────────────────────────────────────────────────────────┐ │
│              cleanupTrackedFiles()                            │ │
├──────────────────────────────────────────────────────────────┤ │
│                                                              │ │
│  ┌─────────────────────────────────────────────────────────┐ │ │
│  │ 遍历 currentTurnFiles Map                                │ │ │
│  │                                                         │ │ │
│  │   currentTurnFiles:                                     │ │ │
│  │   ├── "temp_data.csv" → { intent: 'draft', path: '.drafts/temp_data.csv' }│ │
│  │   │                    → 删除                           │ │ │
│  │   ├── "analyze.py"    → { intent: 'draft', path: '.drafts/analyze.py' }   │ │
│  │   │                    → 删除                           │ │ │
│  │   └── "final.md"      → { intent: 'final', path: 'final.md' }             │ │
│  │                        → 删除 (终止时删除所有文件)        │ │ │
│  │                                                         │ │ │
│  └─────────────────────────────────────────────────────────┘ │ │
│                                                              │ │
│  结果: 删除当前 Turn 写入的所有文件                            │ │
│        (包括 draft 和 final)                                  │ │
│        其他历史遗留的文件保留                                  │ │
│                                                              │ │
└──────────────────────────────────────────────────────────────┘ │
                                                                 │
       ┌─────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                        清理完成                               │
│                                                              │
│  日志输出:                                                   │
│  [AcpAgent] [TRACK] File: temp_data.csv, intent: draft      │
│  [AcpAgent] [TRACK] File: analyze.py, intent: draft         │
│  [AcpAgent] [TRACK] File: final.md, intent: final           │
│  [AcpAgent] [CLEANUP] Removed tracked file: temp_data.csv (intent: draft)│
│  [AcpAgent] [CLEANUP] Removed tracked file: analyze.py (intent: draft)│
│  [AcpAgent] [CLEANUP] Removed tracked file: final.md (intent: final)│
│  [AcpAgent] [CLEANUP] Total tracked files removed: 3        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.7 对比：旧方案 vs 新方案

| 方面 | 旧方案 (cleanupDraftsOnCancel) | 新方案 (cleanupTrackedFiles) |
|------|-------------------------------|-----------------------------------|
| 清理范围 | 整个 `.drafts/` 目录 | 只清理当前 Turn 追踪到的文件 |
| 清理类型 | 只清理 draft 文件 | 清理所有文件 (draft + final) |
| 历史文件 | 全部删除 | 保留 |
| 精确度 | 低 | 高 |
| 误删风险 | 高 | 低 |
| 实现复杂度 | 简单 | 中等 |
| 追踪开销 | 无 | 轻微 (Map 存储) |

---

## 五、完整执行流程示例
│  ┌─────────────────────────────────────────────────────────┐ │ │
│  │ 第二步: 清理根目录 Draft 文件                            │ │ │
│  │                                                         │ │ │
│  │   workspace/                                             │ │ │
│  │   ├── temp_data.csv      → 匹配 temp_ 模式 → 删除       │ │ │
│  │   ├── step1_output.txt   → 匹配 step 模式 → 删除        │ │ │
│  │   ├── final_report.md    → 不匹配 → 保留                │ │ │
│  │   └── process.py         → 不匹配 → 保留                │ │ │
│  │                                                         │ │ │
│  └─────────────────────────────────────────────────────────┘ │ │
│                                                              │ │
└──────────────────────────────────────────────────────────────┘ │
                                                                 │
                                                                 │
       ┌─────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                        清理完成                               │
│                                                              │
│  日志输出:                                                   │
│  [draftsCleanup] [CANCEL] Removed draft file: process_data.py│
│  [draftsCleanup] [CANCEL] Removed draft file: analyze.py     │
│  [draftsCleanup] [CANCEL] Removed draft file from root: temp_│
│  [draftsCleanup] [CANCEL] Total draft files removed: 3       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 五、完整执行流程示例

### 5.1 正常执行流程

```
用户: "创建一个临时文件 temp_data.csv，然后生成最终报告 final_report.md"
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Agent 开始执行                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Tool Call 1: write_file                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ path: "temp_data.csv"                                  │  │
│  │ content: "id,value\n1,100\n2,200"                      │  │
│  │                                                         │  │
│  │ detect_file_intent():                                   │  │
│  │   - 无标记                                              │  │
│  │   - 匹配 "temp_" 前缀 → Draft                          │  │
│  │                                                         │  │
│  │ actual_path = ".drafts/temp_data.csv"                  │  │
│  │ 写入成功                                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Tool Call 2: write_file                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ path: "final_report.md"                                │  │
│  │ content: "# Final Report\n..."                         │  │
│  │                                                         │  │
│  │ detect_file_intent():                                   │  │
│  │   - 无标记                                              │  │
│  │   - 匹配 ".md" 扩展名 → Final                          │  │
│  │                                                         │  │
│  │ actual_path = "final_report.md"                        │  │
│  │ 写入成功                                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Turn 完成                                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  cleanupIntermediateFiles(workspace)                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 扫描工作空间:                                           │  │
│  │   - .drafts/temp_data.csv → 已在 .drafts/ → 跳过       │  │
│  │   - final_report.md → Final → 保留                     │  │
│  │                                                         │  │
│  │ 结果: 无需移动                                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    最终文件结构                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  workspace/                                                  │
│  ├── .drafts/                                                │
│  │   └── temp_data.csv      ← Draft 文件                    │
│  └── final_report.md        ← Final 文件                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 用户终止流程

```
用户: "创建多个临时文件..."
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Agent 执行中                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  已完成:                                                     │
│  - .drafts/process_data.py                                   │
│  - .drafts/analyze.py                                        │
│  - workspace/temp_output.csv                                 │
│                                                              │
│  执行中:                                                     │
│  - 正在写入 final_report.md...                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
       │
       │ 用户点击终止按钮
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    AcpAgent.stop()                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. userCancelled = true                                     │
│  2. connection.cancel(5000)                                  │
│  3. cleanupDraftsOnCancel(workspace)                         │
│     │                                                        │
│     ├─ 删除 .drafts/process_data.py                          │
│     ├─ 删除 .drafts/analyze.py                               │
│     └─ 删除 workspace/temp_output.csv (匹配 temp_ 模式)      │
│                                                              │
│  4. emitUserCancelledMessage()                               │
│  5. emitFinish()                                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    清理后文件结构                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  workspace/                                                  │
│  ├── .drafts/                ← 空目录                        │
│  └── (无其他文件)            ← 所有 Draft 已清理             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 六、关键代码位置

| 功能 | 文件 | 关键函数/方法 |
|------|------|---------------|
| 文件意图检测 (Rust) | `crates/runtime/src/file_intent.rs` | `detect_file_intent()` |
| 路径重定向 (Rust) | `crates/runtime/src/file_redirect.rs` | `redirect_to_drafts()` |
| 写入工具 (Rust) | `crates/tools/src/lib.rs` | `run_write_file()`, `run_edit_file()` |
| 文件标记检测 (TS) | `src/process/task/draftsCleanup.ts` | `detectFileIntent()` |
| 模式匹配 (TS) | `src/process/task/draftsCleanup.ts` | `matchesDraftPattern()`, `matchesFinalPattern()` |
| 后置清理 (TS) | `src/process/task/draftsCleanup.ts` | `cleanupIntermediateFiles()` |
| 终止清理 (TS) | `src/process/task/draftsCleanup.ts` | `cleanupDraftsOnCancel()` (旧方案) |
| Agent 终止 (TS) | `src/process/task/AcpAgent.ts` | `stop()`, `cleanupTrackedDraftFiles()` |
| Agent 终止 (TS) | `src/process/task/RemoteAgent.ts` | `stop()`, `cleanupTrackedDraftFiles()`, `trackFileOperation()` |
| 常量定义 (TS) | `src/common/constants.ts` | `DRAFT_FILE_PATTERNS`, `FINAL_FILE_PATTERNS` |

---

## 七、配置与扩展

### 7.1 添加新的 Draft 模式

编辑 `src/common/constants.ts`:

```typescript
export const DRAFT_FILE_PATTERNS = {
  prefixes: [
    // 添加新的前缀模式
    'test_', 'demo_', 'example_',
    // ... 现有模式
  ],
  suffixes: [
    // 添加新的后缀模式
    '_test', '-test', '_demo', '-demo',
    // ... 现有模式
  ],
};
```

### 7.2 添加新的文件标记

编辑 `src/common/constants.ts`:

```typescript
export const FILE_INTENT_MARKERS = {
  final: ['@final', '@output', '@deliverable', '@result', '@production'],
  draft: ['@draft', '@intermediate', '@temp', '@scratch', '@prototype'],
};
```

### 7.3 添加新的注释语法

编辑 `src/common/constants.ts`:

```typescript
export const COMMENT_SYNTAX_MAP = {
  // ... 现有映射
  '.rkt': ';',      // Racket
  '.clj': ';',      // Clojure
  '.ex': '#',       // Elixir
};
```

---

## 八、日志格式

### 8.1 正常执行日志

```
[draftsCleanup] [MARKER] process_data.py: @draft detected at line 1, will move to .drafts/
[draftsCleanup] [PATTERN] temp_data.csv: matches draft pattern, will move to .drafts/
[draftsCleanup] [DEFAULT] analysis_report.txt: no marker/pattern, treating as final (safe default)
[draftsCleanup] Cleanup completed: moved 2 draft file(s), kept 3 final file(s)
```

### 8.2 终止清理日志

```
[draftsCleanup] [CANCEL] Removed draft file: process_data.py
[draftsCleanup] [CANCEL] Removed draft file: analyze.py
[draftsCleanup] [CANCEL] Removed draft file from root: temp_data.csv
[draftsCleanup] [CANCEL] Total draft files removed: 3
```

---

## 九、注意事项

1. **保守默认策略**: 无标记且不匹配任何模式的文件默认视为 Final，避免误删用户文件

2. **Final 优先**: Final 模式匹配优先于 Draft 模式，例如 `temp-final.py` 会被识别为 Final

3. **用户请求优先**: 用户明确请求创建的文件强制为 Final

4. **异步清理**: 终止清理是异步执行的，不会阻塞 UI 响应

5. **错误容忍**: 清理过程中的错误会被捕获并记录日志，不会导致程序崩溃

6. **二进制文件处理**: 无法读取内容的文件（二进制文件）仅使用模式匹配检测

---

**文档版本**: 1.1
**更新日期**: 2026-05-20
**作者**: Claude Code

---

## 十、测试验证结果

### 10.1 测试场景：用户终止执行

**测试时间**: 2026-05-20 13:54:37

**测试命令**: 创建 Python 脚本生成 CSV 文件，然后分析

**日志输出**:
```
[INFO] 2026-05-20 13:54:37 [[AcpAgent]] [TURN-START] Reset file tracking, snapshot size: 17
[INFO] 2026-05-20 13:54:43 [[AcpAgent]] [TRACK] File: generate_csv.py, intent: final, actualPath: /Users/yobach/.nexus/scode-temp-1779255597404/generate_csv.py
[INFO] 2026-05-20 13:54:45 [[AcpAgent]] [TRACK] File: analyze-a.py, intent: final, actualPath: /Users/yobach/.nexus/scode-temp-1779255597404/analyze-a.py
[INFO] 2026-05-20 13:54:48 [[AcpAgent]] Ignoring session update after user cancel: sessionUpdate=tool_call
[INFO] 2026-05-20 13:54:52 [[AcpAgent]] Backend cancel result: abandoned, forcing disconnect
[INFO] 2026-05-20 13:54:52 [[AcpAgent]] [STOP] currentTurnFiles size: 2
[INFO] 2026-05-20 13:54:52 [[AcpAgent]] [STOP] Tracked file: generate_csv.py, intent: final
[INFO] 2026-05-20 13:54:52 [[AcpAgent]] [STOP] Tracked file: analyze-a.py, intent: final
[INFO] 2026-05-20 13:54:52 [[AcpAgent]] [CLEANUP] Removed tracked file: generate_csv.py (intent: final, actual: /Users/yobach/.nexus/scode-temp-1779255597404/generate_csv.py)
[INFO] 2026-05-20 13:54:52 [[AcpAgent]] [CLEANUP] Removed tracked file: analyze-a.py (intent: final, actual: /Users/yobach/.nexus/scode-temp-1779255597404/analyze-a.py)
[INFO] 2026-05-20 13:54:52 [[AcpAgent]] [CLEANUP] Total tracked files removed: 2
```

**验证结果**:
- ✅ Turn 开始时重置文件追踪 (`[TURN-START] Reset file tracking`)
- ✅ 文件写入时正确追踪 (`[TRACK] File: generate_csv.py, intent: final`)
- ✅ 用户取消时停止处理后续事件 (`Ignoring session update after user cancel`)
- ✅ 清理时正确删除所有追踪文件 (`[CLEANUP] Removed tracked file`)
- ✅ 清理计数正确 (`Total tracked files removed: 2`)

**注意**: `temp_a.csv` 未被创建是因为用户在 Bash 命令执行前就取消了。两个 Python 脚本写入完成后，用户立即点击终止，Bash 命令（`python3 generate_csv.py`）未执行，因此 `temp_a.csv` 从未生成。

### 10.2 Bash 生成的文件追踪

**当前状态**: Bash 工具生成的文件追踪已实现，但需要 Bash 命令实际执行完成才能触发。

**追踪逻辑**:
```typescript
// 在 Bash tool_call_update completed 时
if (toolName === 'bash') {
  // 扫描工作空间变化，检测新文件
  this.trackBashGeneratedFiles();
}
```

**限制**: 如果用户在 Bash 执行前取消，Bash 生成的文件不会被追踪，因为：
1. Bash 命令未执行 → 无新文件生成
2. `tool_call_update` completed 事件未触发 → `trackBashGeneratedFiles()` 未调用

### 10.3 实现状态总结

| 功能 | 状态 | 说明 |
|------|------|------|
| Turn 级别文件追踪 | ✅ 完成 | 每个 Turn 开始时清空追踪 Map |
| write_file 追踪 | ✅ 完成 | 正确追踪写入的文件 |
| edit_file 追踪 | ✅ 完成 | 正确追踪编辑的文件 |
| 用户取消清理 | ✅ 完成 | 清理所有追踪文件 (draft + final) |
| Bash 文件追踪 | ✅ 完成 | Bash 完成后扫描工作空间变化 |
| 历史文件保护 | ✅ 完成 | 只清理当前 Turn 的文件 |
| 日志输出 | ✅ 完成 | 详细的追踪和清理日志 |
