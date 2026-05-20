# Turn 级别文件追踪与精确清理方案

## 问题

当前实现：用户终止时删除整个 `.drafts/` 目录，会误删其他对话/历史遗留的草稿文件。

期望实现：只删除当前对话 Turn 中生成的文件。

---

## 方案设计

### 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        sudocode (Rust)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TurnFileTracker                                                │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ turn_id: "turn-xxx-123"                                     ││
│  │ files: [                                                    ││
│  │   { path: ".drafts/temp.py", intent: Draft },              ││
│  │   { path: ".drafts/analyze.py", intent: Draft },           ││
│  │   { path: "final_report.md", intent: Final },              ││
│  │ ]                                                           ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  API: get_current_turn_files() → Vec<FileOp>                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ ACP Protocol
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       sudowork (TypeScript)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AcpAgent                                                       │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ currentTurnFiles: Set<string>  // 当前 Turn 写入的文件路径  ││
│  │                                                            ││
│  │ onToolCall(toolName, input):                               ││
│  │   if (toolName === 'write_file' || 'edit_file'):          ││
│  │     currentTurnFiles.add(resolvedPath)                     ││
│  │                                                            ││
│  │ stop():                                                    ││
│  │     cleanupTrackedFiles(currentTurnFiles)                  ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 实现方案

### 方案 A：sudowork 端追踪（推荐）

**优点**：
- 不需要修改 ACP 协议
- 实现简单
- 立即可用

**实现步骤**：

#### 1. 在 AcpAgent 中添加文件追踪

```typescript
// src/process/task/AcpAgent.ts

class AcpAgent extends BaseAgent {
  // 新增：当前 Turn 写入的文件
  private currentTurnFiles: Map<string, { path: string; intent: 'draft' | 'final' }> = new Map();
  
  // 处理 tool_call_update 事件
  private handleToolCallUpdate(update: ToolCallUpdate): void {
    // ... 现有逻辑 ...
    
    // 追踪文件写入
    if (update.toolName === 'write_file' || update.toolName === 'edit_file') {
      const input = update.rawInput as { path: string; content: string };
      if (input?.path) {
        const intent = this.detectFileIntentFromToolCall(input);
        this.currentTurnFiles.set(input.path, { 
          path: input.path, 
          intent 
        });
      }
    }
  }
  
  // 从工具调用检测文件意图
  private detectFileIntentFromToolCall(input: { path: string; content: string }): 'draft' | 'final' {
    // 1. 检查内容标记
    if (input.content) {
      const markerResult = detectFileIntent(input.path, input.content);
      if (markerResult.intent !== 'unknown') {
        return markerResult.intent;
      }
    }
    
    // 2. 检查文件名模式
    if (matchesDraftPattern(input.path)) {
      return 'draft';
    }
    
    // 3. 默认 Final
    return 'final';
  }
  
  // 清理追踪的文件
  private async cleanupTrackedFiles(): Promise<number> {
    let removedCount = 0;
    
    for (const [_, file] of this.currentTurnFiles) {
      if (file.intent === 'draft') {
        try {
          const fullPath = path.join(this.workspace, file.path);
          if (fsSync.existsSync(fullPath)) {
            await fs.unlink(fullPath);
            removedCount++;
            mainLog('[AcpAgent]', `[CLEANUP] Removed tracked draft file: ${file.path}`);
          }
        } catch (err) {
          mainError('[AcpAgent]', `Failed to remove ${file.path}:`, err);
        }
      }
    }
    
    // 清空追踪
    this.currentTurnFiles.clear();
    
    return removedCount;
  }
  
  async stop(): Promise<void> {
    // ... 现有逻辑 ...
    
    // 替换原来的 cleanupDraftsOnCancel
    if (this.workspace) {
      await this.cleanupTrackedFiles();
    }
    
    // ... 后续逻辑 ...
  }
}
```

#### 2. 处理 Bash 产生的文件

```typescript
// 追踪 Bash 执行产生的文件
private async handleBashToolCall(update: ToolCallUpdate): Promise<void> {
  // Bash 执行完成后，扫描新增文件
  const beforeFiles = this.getWorkspaceFiles();
  
  // ... 执行 Bash ...
  
  const afterFiles = this.getWorkspaceFiles();
  const newFiles = afterFiles.filter(f => !beforeFiles.includes(f));
  
  // 将新文件加入追踪
  for (const file of newFiles) {
    const intent = matchesDraftPattern(file) ? 'draft' : 'final';
    this.currentTurnFiles.set(file, { path: file, intent });
  }
}
```

---

### 方案 B：sudocode 端追踪 + API 暴露

**优点**：
- 追踪更准确（在写入时就知道实际路径）
- 可以利用现有的 `TurnFileTracker`

**缺点**：
- 需要修改 ACP 协议
- 需要新增 API

**实现步骤**：

#### 1. 在 sudocode 中暴露追踪 API

```rust
// crates/runtime/src/conversation.rs

impl ConversationRuntime {
    /// Get files written in current turn
    pub fn get_current_turn_files(&self) -> Vec<FileOp> {
        self.file_tracker.get_current_turn_ops()
    }
    
    /// Cleanup draft files for current turn
    pub fn cleanup_current_turn_drafts(&mut self) -> Vec<PathBuf> {
        if let Some(turn_id) = self.current_turn_id.clone() {
            self.file_tracker.cleanup_turn_drafts(&turn_id)
        } else {
            Vec::new()
        }
    }
}
```

#### 2. 添加 ACP 方法

```rust
// 新增 ACP 方法: session/get_turn_files
// 返回当前 Turn 写入的文件列表
```

#### 3. sudowork 调用 API

```typescript
async stop(): Promise<void> {
  // 获取当前 Turn 的文件列表
  const turnFiles = await this.connection.getTurnFiles();
  
  // 只清理 Draft 文件
  for (const file of turnFiles) {
    if (file.intent === 'draft') {
      await fs.unlink(file.path);
    }
  }
}
```

---

## 推荐方案

**短期（立即可用）**：方案 A - sudowork 端追踪
- 在 `tool_call_update` 事件中追踪 `write_file`/`edit_file`
- 在 `stop()` 中只清理追踪到的 Draft 文件

**长期（更完善）**：方案 B - sudocode 端追踪
- 利用现有的 `TurnFileTracker`
- 通过 ACP 协议暴露文件列表
- 支持更精确的回滚

---

## 文件追踪数据结构

```typescript
interface TrackedFile {
  path: string;           // 实际写入路径
  requestedPath: string;  // 用户请求路径
  intent: 'draft' | 'final';
  kind: 'create' | 'edit';
  timestamp: number;
}

class TurnFileTracker {
  private files: Map<string, TrackedFile> = new Map();
  
  // 记录文件操作
  record(op: TrackedFile): void {
    this.files.set(op.path, op);
  }
  
  // 获取所有 Draft 文件
  getDraftFiles(): string[] {
    return Array.from(this.files.values())
      .filter(f => f.intent === 'draft')
      .map(f => f.path);
  }
  
  // 清理 Draft 文件
  async cleanupDrafts(): Promise<number> {
    let count = 0;
    for (const file of this.getDraftFiles()) {
      try {
        await fs.unlink(file);
        count++;
      } catch {}
    }
    return count;
  }
  
  // 清空追踪（Turn 结束时）
  clear(): void {
    this.files.clear();
  }
}
```

---

## 执行流程

```
Turn 开始
    │
    ├─ currentTurnFiles.clear()
    │
    ▼
Tool Call: write_file("temp_data.csv")
    │
    ├─ detectFileIntent() → Draft
    ├─ currentTurnFiles.set("temp_data.csv", { intent: 'draft' })
    ├─ 实际写入到 .drafts/temp_data.csv
    │
    ▼
Tool Call: write_file("final_report.md")
    │
    ├─ detectFileIntent() → Final
    ├─ currentTurnFiles.set("final_report.md", { intent: 'final' })
    ├─ 写入到 final_report.md
    │
    ▼
用户点击终止
    │
    ├─ stop() 被调用
    │
    ├─ cleanupTrackedFiles():
    │   ├─ 遍历 currentTurnFiles
    │   ├─ 只删除 intent === 'draft' 的文件
    │   └─ temp_data.csv 被删除
    │
    ├─ final_report.md 保留（intent === 'final'）
    │
    ▼
清理完成
```

---

## 边界情况处理

### 1. 文件被重定向到 .drafts/

```typescript
// 用户请求: write_file("temp.py")
// 实际写入: .drafts/temp.py

// 追踪时记录实际路径
currentTurnFiles.set(".drafts/temp.py", { 
  path: ".drafts/temp.py",
  requestedPath: "temp.py",
  intent: 'draft' 
});

// 清理时删除实际路径
await fs.unlink(".drafts/temp.py");
```

### 2. Bash 产生的间接文件

```typescript
// Bash 执行: python script.py
// 产生文件: output.csv

// 方案 1: 在 Bash 执行前后扫描文件变化
// 方案 2: 不追踪，依赖文件名模式匹配
```

### 3. 多次写入同一文件

```typescript
// 第一次: write_file("temp.py") → Draft
// 第二次: write_file("temp.py") → Final (用户修改了内容)

// 追踪最后一次的 intent
currentTurnFiles.set("temp.py", { intent: 'final' });
// 清理时不会删除
```

---

## 下一步

1. 实现方案 A（sudowork 端追踪）
2. 测试验证
3. 考虑是否需要方案 B（sudocode 端追踪）
