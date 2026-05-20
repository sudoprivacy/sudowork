# 文件智能分类与追踪系统设计

**日期**: 2026-05-19
**状态**: 设计中
**目标**: 在 sudocode 端实现文件意图识别、智能分类存储、按 Turn 追踪，支持终止时精确清理

---

## 一、问题背景

### 当前问题

1. **文件无追踪**: sudocode 执行 Write/Edit 工具时不记录文件操作
2. **事后清理**: sudowork 需要在 Turn 结束后扫描工作目录进行清理
3. **终止无法清理**: 会话被终止时，执行中的文件无法被清理
4. **无法区分 Turn**: 同一会话多次消息执行，无法区分哪个文件属于哪个 Turn
5. **间接文件产生**: Bash/PowerShell 执行代码时产生的文件无法直接追踪

### 目标

1. **执行时追踪**: 每个文件操作都被记录
2. **智能分类**: 根据文件意图直接写入正确位置（根目录 vs `.drafts/`）
3. **按 Turn 追踪**: 精确记录每个 Turn 创建/修改的文件
4. **终止清理**: 会话终止时，可选择性清理当前 Turn 的草稿文件
5. **间接文件处理**: 支持追踪 Bash/PowerShell 执行产生的文件

---

## 二、核心概念

### 2.1 文件意图 (FileIntent)

```rust
/// 文件意图分类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileIntent {
    /// 最终产物 - 用户直接使用的文件
    /// 保留在工作目录根目录
    Final,

    /// 中间产物/草稿 - 执行过程中的辅助文件
    /// 存放到 .drafts/ 目录
    Draft,
}
```

### 2.2 文件操作类型 (FileOpKind)

```rust
/// 文件操作类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileOpKind {
    /// 新建文件
    Create,

    /// 编辑已有文件
    Edit,
}
```

### 2.3 文件操作记录 (FileOp)

```rust
/// 单次文件操作记录
#[derive(Debug, Clone)]
pub struct FileOp {
    /// 文件路径（实际写入路径）
    pub path: PathBuf,

    /// 操作类型
    pub kind: FileOpKind,

    /// 文件意图
    pub intent: FileIntent,

    /// 原始内容（仅 Edit 操作时保存，用于回滚）
    pub original_content: Option<String>,

    /// 原始请求路径（可能与实际路径不同，如被重定向到 .drafts/）
    pub requested_path: PathBuf,
}
```

### 2.4 Turn 文件追踪器 (TurnFileTracker)

```rust
/// 按 Turn 追踪文件操作
#[derive(Debug, Default)]
pub struct TurnFileTracker {
    /// 当前 Turn ID
    current_turn_id: Option<String>,

    /// Turn ID -> 文件操作列表
    turn_files: HashMap<String, Vec<FileOp>>,

    /// 工作目录根路径
    workspace_root: PathBuf,
}
```

---

## 三、文件意图检测规则

### 3.1 核心原则

**用户明确请求的文件 = Final（最终产物）**

这是最高优先级的判断原则。如果用户在请求中明确提到要创建某个文件，该文件就是最终产物。

### 3.2 检测优先级

```
1. 文件标记 (@final/@draft)         → 最高优先级
2. 用户请求匹配                      → 用户明确要的文件 = Final
3. Final 保护模式                    → 覆盖后续规则
4. Draft 模式                        → 判定为 Draft
5. 默认                              → Final（保守策略）
```

### 3.3 标记检测（优先级最高）

检测文件内容前 10 行的注释标记：

| 标记 | 意图 | 示例 |
|------|------|------|
| `@final` | Final | `# @final` / `// @final` |
| `@draft` | Draft | `# @draft` / `// @draft` |

### 3.4 用户请求匹配（新增）

在检测文件意图时，结合用户原始请求内容判断：

```rust
/// 用户请求意图分析
pub struct UserRequestIntent {
    /// 用户明确请求创建的文件名
    pub requested_files: HashSet<String>,

    /// 用户请求的文件类型关键词
    pub requested_types: HashSet<String>,
}

impl UserRequestIntent {
    /// 从用户请求中提取意图
    pub fn analyze(user_request: &str) -> Self {
        let mut requested_files = HashSet::new();
        let mut requested_types = HashSet::new();

        // 1. 提取明确提到的文件名
        // 例如："创建 process_data.py" → requested_files: ["process_data.py"]
        let file_patterns = [
            r"创建?\s+([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)",
            r"写一个\s+([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)",
            r"生成\s+([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)",
            r"新建\s+([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)",
            r"create\s+([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)",
            r"write\s+([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)",
        ];

        for pattern in &file_patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                for cap in re.captures_iter(user_request) {
                    if let Some(file) = cap.get(1) {
                        requested_files.insert(file.as_str().to_lowercase());
                    }
                }
            }
        }

        // 2. 提取请求的文件类型
        // 例如："写一个 Python 脚本" → requested_types: ["python", "script"]
        let type_patterns = [
            (r"python\s*脚本?", "python"),
            (r"shell\s*脚本?", "shell"),
            (r"bash\s*脚本?", "bash"),
            (r"脚本", "script"),
            (r"工具\s*函数?", "utility"),
            (r"helper", "helper"),
            (r"util", "utility"),
        ];

        for (pattern, type_name) in &type_patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if re.is_match(user_request) {
                    requested_types.insert(type_name.to_string());
                }
            }
        }

        Self { requested_files, requested_types }
    }

    /// 检查文件是否是用户请求的
    pub fn is_requested_file(&self, file_path: &str) -> bool {
        let file_name = Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.to_lowercase())
            .unwrap_or_default();

        // 1. 文件名直接匹配
        if self.requested_files.contains(&file_name) {
            return true;
        }

        // 2. 扩展名匹配请求类型
        let ext = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        match ext.as_str() {
            "py" => self.requested_types.contains("python") || self.requested_types.contains("script"),
            "sh" | "bash" => self.requested_types.contains("shell") || self.requested_types.contains("bash") || self.requested_types.contains("script"),
            "ts" | "js" => self.requested_types.contains("utility") || self.requested_types.contains("script"),
            _ => false,
        }
    }
}
```

### 3.5 文件名模式检测

#### Draft 模式（匹配则视为 Draft）

**注意**：以下模式仅在文件**不是**用户明确请求时才生效。

```rust
const DRAFT_PATTERNS: &[&str] = &[
    // 临时文件前缀（明确是临时的）
    r"^temp[_-]", r"^tmp[_-]", r"^temporary[_-]",

    // 草稿/工作进度
    r"^draft[_-]", r"^wip[_-]", r"^scratch[_-]",
    r"^proto[_-]", r"^poc[_-]",

    // 步骤文件（执行过程中的中间步骤）
    r"^step[_-]?\d+", r"^phase[_-]?\\d+",

    // 后缀标记
    r"[_-]draft$", r"[_-]wip$", r"[_-]temp$",
    r"[_-]backup$", r"[_-]old$",
];
```

**移除的模式**（这些模式太激进，容易误判）：

```rust
// ❌ 移除：用户可能明确请求这些文件
// r"^helper[_-]", r"^util[_-]", r"^tool[_-]",
// r"^working[_-]",
```

#### Final 保护模式（匹配则视为 Final，覆盖 Draft 模式）

```rust
const FINAL_PATTERNS: &[&str] = &[
    r"[_-]final$", r"[_-]result$", r"[_-]output$",
    r"[_-]completed$", r"[_-]done$",
];
```

### 3.6 扩展名规则（重新设计）

**重要变更**：不再将代码文件扩展名默认视为 Draft。

```rust
/// 默认视为 Draft 的扩展名（仅临时文件类型）
const DRAFT_EXTENSIONS: &[&str] = &[
    ".tmp", ".temp", ".bak", ".backup",
    ".log", ".cache",
];

/// 默认视为 Final 的扩展名（用户可能直接使用的文件）
const FINAL_EXTENSIONS: &[&str] = &[
    // 文档
    ".md", ".txt", ".pdf", ".docx", ".pptx",

    // 数据文件
    ".json", ".yaml", ".yml", ".csv", ".xlsx",

    // 代码文件（用户可能明确请求）
    ".py", ".sh", ".bash", ".zsh",
    ".ts", ".tsx", ".js", ".jsx",
    ".rs", ".go", ".java", ".kt",
    ".c", ".cpp", ".h", ".hpp",
    ".rb", ".php", ".lua",

    // 配置文件
    ".toml", ".ini", ".conf", ".cfg",

    // 网页/图片
    ".html", ".css", ".scss",
    ".png", ".jpg", ".svg",
];
```

### 3.7 检测函数（更新）

```rust
/// 检测文件意图
pub fn detect_file_intent(
    path: &str,
    content: &str,
    user_intent: Option<&UserRequestIntent>,
) -> FileIntent {
    // 1. 检测标记（最高优先级）
    if let Some(intent) = detect_intent_marker(content) {
        return intent;
    }

    // 2. 用户请求匹配（新增）
    if let Some(intent) = user_intent {
        if intent.is_requested_file(path) {
            return FileIntent::Final;
        }
    }

    // 3. Final 保护模式
    if matches_final_pattern(path) {
        return FileIntent::Final;
    }

    // 4. Draft 模式
    if matches_draft_pattern(path) {
        return FileIntent::Draft;
    }

    // 5. 扩展名规则
    let ext = Path::new(path).extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();

    if DRAFT_EXTENSIONS.contains(&ext.as_str()) {
        return FileIntent::Draft;
    }

    if FINAL_EXTENSIONS.contains(&ext.as_str()) {
        return FileIntent::Final;
    }

    // 6. 默认 Final（保守策略）
    FileIntent::Final
}
```

### 3.8 示例场景

| 用户请求 | 创建的文件 | 意图判定 | 结果 |
|----------|-----------|----------|------|
| "帮我写一个 Python 脚本处理数据" | `process_data.py` | 用户请求匹配 | Final ✓ |
| "创建一个 deploy.sh 脚本" | `deploy.sh` | 用户请求匹配 | Final ✓ |
| "写一个工具函数" | `utils.ts` | 用户请求匹配 | Final ✓ |
| "分析这个数据" | `temp_analysis.py` | 无请求匹配 + temp 前缀 | Draft |
| "分析这个数据" | `analysis_result.json` | Final 扩展名 | Final ✓ |
| "生成报告" | `report-draft.md` | draft 后缀 | Draft |
| "生成报告" | `report.md` | Final 扩展名 | Final ✓ |
| "测试一下" | `test_script.py` | 无明确请求 + 默认 Final | Final ✓ |

---

## 四、路径重定向

### 4.1 Draft 文件重定向

当文件意图为 Draft 时，自动重定向到 `.drafts/` 目录：

```
原始路径: /workspace/report-draft.md
重定向后: /workspace/.drafts/report-draft.md
```

### 4.2 命名冲突处理

如果 `.drafts/` 中已存在同名文件，追加时间戳：

```
原始路径: /workspace/temp.py
已存在:   /workspace/.drafts/temp.py
重定向后: /workspace/.drafts/temp_1716123456789.py
```

### 4.3 重定向函数

```rust
/// 重定向 Draft 文件到 .drafts/ 目录
pub fn redirect_to_drafts(
    requested_path: &Path,
    workspace_root: &Path,
) -> PathBuf {
    let drafts_dir = workspace_root.join(".drafts");

    // 确保 .drafts/ 目录存在
    let _ = fs::create_dir_all(&drafts_dir);

    // 提取文件名
    let file_name = requested_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("draft");

    let mut dest_path = drafts_dir.join(file_name);

    // 处理命名冲突
    if dest_path.exists() {
        let stem = requested_path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("draft");
        let ext = requested_path.extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);

        dest_path = drafts_dir.join(format!("{}_{}{}", stem, timestamp, ext));
    }

    dest_path
}
```

---

## 五、工具执行改造

### 5.1 扩展 ToolExecutor Trait

```rust
// 当前
pub trait ToolExecutor: Send {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError>;
}

// 改造后
pub trait ToolExecutor: Send {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<ToolResult, ToolError>;
}

/// 工具执行结果
#[derive(Debug)]
pub struct ToolResult {
    /// 工具输出（JSON 字符串）
    pub output: String,

    /// 文件操作记录（仅 Write/Edit 等文件工具）
    pub file_ops: Vec<FileOp>,
}

impl ToolResult {
    /// 创建无文件操作的结果
    pub fn simple(output: String) -> Self {
        Self {
            output,
            file_ops: Vec::new(),
        }
    }

    /// 创建带文件操作的结果
    pub fn with_file_ops(output: String, file_ops: Vec<FileOp>) -> Self {
        Self { output, file_ops }
    }
}
```

### 5.2 改造 write_file 工具

```rust
fn run_write_file(
    input: WriteFileInput,
    workspace_root: &Path,
    tracker: &mut TurnFileTracker,
) -> Result<ToolResult, String> {
    // 1. 读取已有文件内容（如果存在，用于区分 Create/Edit）
    let requested_path = PathBuf::from(&input.path);
    let existing_content = fs::read_to_string(&requested_path).ok();
    let kind = if existing_content.is_some() {
        FileOpKind::Edit
    } else {
        FileOpKind::Create
    };

    // 2. 检测文件意图
    let intent = detect_file_intent(&input.path, &input.content);

    // 3. 根据意图决定实际写入路径
    let actual_path = match intent {
        FileIntent::Draft => redirect_to_drafts(&requested_path, workspace_root),
        FileIntent::Final => requested_path.clone(),
    };

    // 4. 执行写入
    let output = write_file(&StdFsBackend, actual_path.to_str().unwrap(), &input.content)
        .map_err(io_to_string)?;

    // 5. 记录文件操作
    let file_op = FileOp {
        path: actual_path,
        kind,
        intent,
        original_content: existing_content,
        requested_path,
    };
    tracker.record(file_op.clone());

    // 6. 返回结果
    Ok(ToolResult::with_file_ops(
        to_pretty_json(output),
        vec![file_op],
    ))
}
```

### 5.3 改造 edit_file 工具

```rust
fn run_edit_file(
    input: EditFileInput,
    workspace_root: &Path,
    tracker: &mut TurnFileTracker,
) -> Result<ToolResult, String> {
    let requested_path = PathBuf::from(&input.path);

    // 1. 读取原始内容（用于回滚）
    let original_content = fs::read_to_string(&requested_path)
        .map_err(|e| format!("Cannot read file: {}", e))?;

    // 2. 执行编辑（获取编辑后的内容用于意图检测）
    let output = edit_file(
        &StdFsBackend,
        &input.path,
        &input.old_string,
        &input.new_string,
        input.replace_all.unwrap_or(false),
    ).map_err(io_to_string)?;

    // 3. 读取编辑后的内容进行意图检测
    let edited_content = fs::read_to_string(&requested_path).unwrap_or_default();
    let intent = detect_file_intent(&input.path, &edited_content);

    // 4. 如果是 Draft，需要移动到 .drafts/
    let actual_path = if intent == FileIntent::Draft {
        let dest = redirect_to_drafts(&requested_path, workspace_root);
        fs::rename(&requested_path, &dest)
            .map_err(|e| format!("Failed to move to drafts: {}", e))?;
        dest
    } else {
        requested_path.clone()
    };

    // 5. 记录文件操作
    let file_op = FileOp {
        path: actual_path,
        kind: FileOpKind::Edit,
        intent,
        original_content: Some(original_content),
        requested_path,
    };
    tracker.record(file_op.clone());

    // 6. 返回结果
    Ok(ToolResult::with_file_ops(
        to_pretty_json(output),
        vec![file_op],
    ))
}
```

---

## 六、Turn 文件追踪

### 6.1 TurnFileTracker 实现

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::fs;

/// 按 Turn 追踪文件操作
#[derive(Debug, Default)]
pub struct TurnFileTracker {
    /// 当前 Turn ID
    current_turn_id: Option<String>,

    /// Turn ID -> 文件操作列表
    turn_files: HashMap<String, Vec<FileOp>>,

    /// 工作目录根路径
    workspace_root: PathBuf,
}

impl TurnFileTracker {
    /// 创建新的追踪器
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            current_turn_id: None,
            turn_files: HashMap::new(),
            workspace_root,
        }
    }

    /// 开始新的 Turn
    pub fn start_turn(&mut self, turn_id: String) {
        self.current_turn_id = Some(turn_id);
    }

    /// 结束当前 Turn
    pub fn end_turn(&mut self) {
        self.current_turn_id = None;
    }

    /// 记录文件操作
    pub fn record(&mut self, op: FileOp) {
        if let Some(turn_id) = &self.current_turn_id {
            self.turn_files
                .entry(turn_id.clone())
                .or_default()
                .push(op);
        }
    }

    /// 获取指定 Turn 的文件操作
    pub fn get_turn_files(&self, turn_id: &str) -> Option<&Vec<FileOp>> {
        self.turn_files.get(turn_id)
    }

    /// 清理指定 Turn 的 Draft 文件
    pub fn cleanup_turn_drafts(&mut self, turn_id: &str) -> Vec<PathBuf> {
        let mut cleaned = Vec::new();

        if let Some(ops) = self.turn_files.remove(turn_id) {
            for op in ops {
                if op.intent == FileIntent::Draft {
                    if let Err(e) = fs::remove_file(&op.path) {
                        tracing::warn!("Failed to cleanup draft file {:?}: {}", op.path, e);
                    } else {
                        cleaned.push(op.path);
                    }
                }
            }
        }

        cleaned
    }

    /// 回滚指定 Turn 的所有文件操作
    pub fn rollback_turn(&mut self, turn_id: &str) -> Vec<String> {
        let mut rolled_back = Vec::new();

        if let Some(ops) = self.turn_files.remove(turn_id) {
            for op in ops.into_iter().rev() {
                match op.kind {
                    FileOpKind::Create => {
                        // 删除新建的文件
                        if let Err(e) = fs::remove_file(&op.path) {
                            rolled_back.push(format!("Failed to delete {:?}: {}", op.path, e));
                        }
                    }
                    FileOpKind::Edit => {
                        // 恢复原始内容
                        if let Some(original) = op.original_content {
                            if let Err(e) = fs::write(&op.path, original) {
                                rolled_back.push(format!("Failed to restore {:?}: {}", op.path, e));
                            }
                        }
                    }
                }
            }
        }

        rolled_back
    }

    /// 获取当前 Turn ID
    pub fn current_turn(&self) -> Option<&str> {
        self.current_turn_id.as_deref()
    }

    /// 清理所有 Turn 记录（会话结束时调用）
    pub fn clear(&mut self) {
        self.turn_files.clear();
        self.current_turn_id = None;
    }
}
```

### 6.2 集成到 ConversationRuntime

```rust
pub struct ConversationRuntime<C, T> {
    // ... existing fields ...

    /// 文件操作追踪器
    file_tracker: TurnFileTracker,
}

impl<C, T> ConversationRuntime<C, T>
where
    C: ApiClient,
    T: ToolExecutor,
{
    /// 运行一个 Turn
    pub fn run_turn(&mut self, user_message: &str) -> Result<TurnSummary, RuntimeError> {
        // 1. 生成 Turn ID
        let turn_id = format!("turn-{}", uuid::Uuid::new_v4());

        // 2. 开始追踪
        self.file_tracker.start_turn(turn_id.clone());

        // 3. 执行 Turn
        let result = self.run_turn_internal(user_message);

        // 4. 结束追踪
        self.file_tracker.end_turn();

        // 5. 返回结果
        result
    }

    /// 获取文件追踪器
    pub fn file_tracker(&self) -> &TurnFileTracker {
        &self.file_tracker
    }

    /// 获取文件追踪器（可变）
    pub fn file_tracker_mut(&mut self) -> &mut TurnFileTracker {
        &mut self.file_tracker
    }
}
```

---

## 七、间接文件处理（Bash/PowerShell 执行产生的文件）

### 7.1 问题分析

Bash/PowerShell 工具执行代码时可能间接产生文件，例如：

```bash
# 执行 Python 脚本产生输出文件
python -c "import json; json.dump({'result': 42}, open('output.json', 'w'))"

# 执行编译命令产生二进制文件
gcc -o myprogram main.c

# 执行测试产生覆盖率报告
pytest --cov=src --cov-report=html

# 下载文件
curl -o data.csv https://example.com/data.csv
```

这些文件不是通过 Write/Edit 工具直接创建的，sudocode 无法在创建时拦截。

### 7.2 解决方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 快照对比** | 精确追踪所有变化 | 性能开销大，需要存储快照 |
| **B. inotify/fsevents 监听** | 实时感知文件变化 | 跨平台复杂，需要额外依赖 |
| **C. 命令前后扫描** | 简单可靠 | 可能有延迟 |
| **D. 声明式引导** | 无需追踪 | 依赖 Agent 配合 |

### 7.3 推荐方案：命令前后扫描 + 声明式引导

#### 7.3.1 命令前后扫描

在 Bash 工具执行前后扫描工作目录，记录文件变化：

```rust
/// Bash 执行前后的文件变化
#[derive(Debug, Default)]
pub struct FileChangeSnapshot {
    /// 执行前存在的文件
    before: HashSet<PathBuf>,

    /// 执行后存在的文件
    after: HashSet<PathBuf>,

    /// 新增的文件
    pub created: Vec<PathBuf>,

    /// 被修改的文件
    pub modified: Vec<PathBuf>,

    /// 被删除的文件
    pub deleted: Vec<PathBuf>,
}

impl FileChangeSnapshot {
    /// 扫描工作目录
    pub fn scan(workspace_root: &Path) -> HashSet<PathBuf> {
        let mut files = HashSet::new();
        if let Ok(entries) = fs::read_dir(workspace_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && !Self::should_ignore(&path) {
                    files.insert(path);
                }
            }
        }
        files
    }

    /// 忽略的文件/目录
    fn should_ignore(path: &Path) -> bool {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        matches!(name,
            ".git" | "node_modules" | "target" | ".drafts" |
            ".DS_Store" | "Thumbs.db"
        ) || path.starts_with(".drafts")
    }

    /// 记录执行前状态
    pub fn capture_before(workspace_root: &Path) -> Self {
        Self {
            before: Self::scan(workspace_root),
            after: HashSet::new(),
            created: Vec::new(),
            modified: Vec::new(),
            deleted: Vec::new(),
        }
    }

    /// 记录执行后状态并计算差异
    pub fn capture_after(&mut self, workspace_root: &Path) {
        self.after = Self::scan(workspace_root);

        // 新增的文件
        self.created = self.after.difference(&self.before).cloned().collect();

        // 被删除的文件
        self.deleted = self.before.difference(&self.after).cloned().collect();

        // 被修改的文件（需要检查 mtime 或内容）
        for path in self.before.intersection(&self.after) {
            if let Ok(meta_before) = fs::metadata(path) {
                if let Ok(meta_after) = fs::metadata(path) {
                    if meta_before.modified().ok() != meta_after.modified().ok() {
                        self.modified.push(path.clone());
                    }
                }
            }
        }
    }
}
```

#### 7.3.2 集成到 Bash 工具

```rust
fn run_bash(
    input: BashCommandInput,
    workspace_root: &Path,
    tracker: &mut TurnFileTracker,
) -> Result<ToolResult, String> {
    // 1. 执行前快照
    let mut snapshot = FileChangeSnapshot::capture_before(workspace_root);

    // 2. 执行命令
    let output = execute_bash(input)?;

    // 3. 执行后快照
    snapshot.capture_after(workspace_root);

    // 4. 记录新增的文件
    for path in &snapshot.created {
        // 检测文件意图
        let content = fs::read_to_string(path).unwrap_or_default();
        let intent = detect_file_intent(path.to_str().unwrap(), &content);

        // 如果是 Draft，移动到 .drafts/
        let actual_path = if intent == FileIntent::Draft {
            let dest = redirect_to_drafts(path, workspace_root);
            let _ = fs::rename(path, &dest);
            dest
        } else {
            path.clone()
        };

        // 记录到追踪器
        tracker.record(FileOp {
            path: actual_path,
            kind: FileOpKind::Create,
            intent,
            original_content: None,
            requested_path: path.clone(),
        });
    }

    // 5. 记录修改的文件
    for path in &snapshot.modified {
        let content = fs::read_to_string(path).unwrap_or_default();
        let intent = detect_file_intent(path.to_str().unwrap(), &content);

        tracker.record(FileOp {
            path: path.clone(),
            kind: FileOpKind::Edit,
            intent,
            original_content: None, // Bash 修改无法保存原内容
            requested_path: path.clone(),
        });
    }

    Ok(ToolResult::with_file_ops(
        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())?,
        tracker.get_current_turn_ops().to_vec(),
    ))
}
```

#### 7.3.3 声明式引导（Prompt 层面）

在系统提示中引导 Agent 在执行可能产生文件的命令时声明预期输出：

```
当执行可能产生文件的命令时，请在命令中明确指定输出路径：

✅ 推荐：
- 将输出文件放在 .drafts/ 目录（中间产物）
- 使用明确的文件名（最终产物）
- 在命令后注释说明文件用途

示例：
```bash
# 中间产物 → .drafts/
python script.py > .drafts/temp_output.txt

# 最终产物 → 根目录
pytest --cov=src --cov-report=html:coverage-report

# 使用 @draft/@final 标记
echo "# @draft" > temp_data.json
echo "# @final" > final_report.md
```
```

### 7.4 性能优化

#### 7.4.1 增量扫描

只扫描可能变化的目录，忽略大型目录：

```rust
const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist",
    "build", "vendor", ".venv", "venv",
];

fn scan_incremental(workspace_root: &Path) -> HashSet<PathBuf> {
    let mut files = HashSet::new();
    let mut queue = vec![workspace_root.to_path_buf()];

    while let Some(dir) = queue.pop() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if !SKIP_DIRS.contains(&name) {
                        queue.push(path);
                    }
                } else if path.is_file() {
                    files.insert(path);
                }
            }
        }
    }

    files
}
```

#### 7.4.2 缓存文件列表

在 Turn 开始时缓存文件列表，避免重复扫描：

```rust
impl TurnFileTracker {
    /// Turn 开始时的文件快照
    turn_start_snapshot: Option<HashSet<PathBuf>>,

    /// 开始 Turn 时缓存快照
    pub fn start_turn(&mut self, turn_id: String, workspace_root: &Path) {
        self.current_turn_id = Some(turn_id);
        self.turn_start_snapshot = Some(FileChangeSnapshot::scan(workspace_root));
    }
}
```

### 7.5 处理策略

| 文件来源 | 处理方式 |
|----------|----------|
| Write/Edit 工具 | 直接拦截，检测意图，重定向路径 |
| Bash 新增文件 | 扫描检测，按意图移动到 .drafts/ |
| Bash 修改文件 | 记录到追踪器，终止时可回滚 |
| PowerShell 文件 | 同 Bash 处理 |

### 7.6 限制与注意事项

1. **无法保存原内容**: Bash 修改的文件无法保存原始内容，只能删除无法回滚
2. **性能开销**: 扫描大型项目可能有延迟
3. **并发问题**: 多个并发命令可能产生竞态条件
4. **忽略目录**: 某些目录（如 target/）的变化可能被忽略

---

## 八、终止清理机制

### 7.1 终止信号处理

```rust
impl ConversationRuntime {
    /// 处理终止信号
    pub fn handle_abort(&mut self) -> AbortResult {
        let mut result = AbortResult::default();

        // 1. 获取当前 Turn ID
        if let Some(turn_id) = self.file_tracker.current_turn() {
            let turn_id = turn_id.to_string();

            // 2. 清理当前 Turn 的 Draft 文件
            result.cleaned_drafts = self.file_tracker.cleanup_turn_drafts(&turn_id);

            // 3. 可选：回滚所有文件操作
            // result.rollback_errors = self.file_tracker.rollback_turn(&turn_id);
        }

        // 4. 取消正在进行的 API 请求
        // ... existing abort logic ...

        result
    }
}

/// 终止结果
#[derive(Debug, Default)]
pub struct AbortResult {
    /// 清理的 Draft 文件列表
    pub cleaned_drafts: Vec<PathBuf>,

    /// 回滚错误（如果执行了回滚）
    pub rollback_errors: Vec<String>,
}
```

### 7.2 清理策略选择

```rust
/// 清理策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupStrategy {
    /// 仅清理 Draft 文件（默认）
    DraftsOnly,

    /// 回滚所有文件操作（包括 Final 文件）
    FullRollback,

    /// 不清理
    None,
}

impl TurnFileTracker {
    /// 根据策略清理
    pub fn cleanup_with_strategy(&mut self, turn_id: &str, strategy: CleanupStrategy) -> CleanupResult {
        match strategy {
            CleanupStrategy::DraftsOnly => {
                let cleaned = self.cleanup_turn_drafts(turn_id);
                CleanupResult::DraftsCleaned(cleaned)
            }
            CleanupStrategy::FullRollback => {
                let errors = self.rollback_turn(turn_id);
                if errors.is_empty() {
                    CleanupResult::FullRollback
                } else {
                    CleanupResult::RollbackErrors(errors)
                }
            }
            CleanupStrategy::None => {
                CleanupResult::NoAction
            }
        }
    }
}

#[derive(Debug)]
pub enum CleanupResult {
    DraftsCleaned(Vec<PathBuf>),
    FullRollback,
    RollbackErrors(Vec<String>),
    NoAction,
}
```

---

## 九、Token 消耗分析

### 9.1 各组件 Token 消耗

| 组件 | Token 消耗 | 说明 |
|------|------------|------|
| 文件意图检测 | **0** | 本地正则匹配，不调用 LLM |
| 用户请求意图分析 | **0** | 本地正则提取关键词 |
| 文件路径重定向 | **0** | 本地路径操作 |
| Bash 前后扫描 | **0** | 本地文件系统操作 |
| Turn 文件追踪 | **0** | 本地内存数据结构 |
| 终止清理 | **0** | 本地文件删除操作 |

**结论：当前设计完全不消耗 API token，所有操作都在本地执行。**

### 9.2 与 sudowork 追问方案对比

| 方案 | Token 消耗 | 延迟 | 确定性 |
|------|------------|------|--------|
| **sudowork 追问方案** | 150-300 tokens/Turn | 1-3 秒 | 依赖 LLM 输出格式 |
| **sudocode 本地检测** | **0 tokens** | <10ms | 规则明确，100% 确定 |

#### sudowork 追问方案的 token 消耗

```
追问消息：
"[File Classification Task]
本次任务写入的文件：
- report.md
- temp_script.py
请以 JSON 格式回复..."

→ 输入：约 100-200 tokens
→ 输出：约 50-100 tokens
→ 总计：约 150-300 tokens 每次 Turn
```

#### sudocode 本地检测方案

```
本地正则匹配：
- detect_intent_marker(content) → 0 tokens
- matches_draft_pattern(path) → 0 tokens
- UserRequestIntent::analyze(request) → 0 tokens

→ 总计：0 tokens
```

### 9.3 成本节省估算

假设每天 100 次 Turn，每次追问消耗 200 tokens：

| 指标 | sudowork 追问 | sudocode 本地 |
|------|---------------|---------------|
| 每日 token 消耗 | 20,000 tokens | 0 tokens |
| 每月 token 消耗 | 600,000 tokens | 0 tokens |
| 每月成本（$3/1M tokens） | $1.80 | $0 |

### 9.4 性能优势

| 指标 | sudowork 追问 | sudocode 本地 |
|------|---------------|---------------|
| 意图检测延迟 | 1-3 秒（LLM 调用） | <10ms（正则匹配） |
| 错误率 | 5-10%（JSON 格式错误） | 0%（确定性规则） |
| 超时风险 | 有（需要 10 秒超时兜底） | 无 |

---

## 十一、API 扩展

### 8.1 ACP 协议扩展

```rust
/// 会话终止请求（扩展）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CancelSessionRequest {
    pub session_id: String,

    /// 清理策略
    #[serde(default)]
    pub cleanup_strategy: Option<String>,  // "drafts" | "full" | "none"
}

/// 会话终止响应（扩展）
#[derive(Debug, Clone, serde::Serialize)]
pub struct CancelSessionResponse {
    pub success: bool,

    /// 清理的文件列表
    pub cleaned_files: Vec<String>,

    /// 清理错误
    pub errors: Vec<String>,
}
```

### 8.2 CLI 命令扩展

```bash
# 终止会话并清理 Draft 文件（默认）
scode --cancel --cleanup drafts

# 终止会话并回滚所有文件
scode --cancel --cleanup full

# 终止会话但不清理
scode --cancel --cleanup none
```

---

## 十一、文件结构

### 9.1 新增文件

```
rust/crates/runtime/src/
├── file_intent.rs          # 文件意图检测
├── file_tracker.rs         # Turn 文件追踪
└── file_redirect.rs        # 路径重定向
```

### 9.2 修改文件

```
rust/crates/runtime/src/
├── lib.rs                  # 导出新模块
├── conversation.rs         # 集成 TurnFileTracker
└── acp_sdk_server.rs       # 扩展终止 API

rust/crates/tools/src/
└── lib.rs                  # 改造 ToolExecutor, write_file, edit_file
```

---

## 十二、测试计划

### 11.1 单元测试

- [ ] `detect_file_intent` 标记检测
- [ ] `detect_file_intent` 模式匹配
- [ ] `redirect_to_drafts` 路径重定向
- [ ] `redirect_to_drafts` 命名冲突处理
- [ ] `TurnFileTracker::record` 记录操作
- [ ] `TurnFileTracker::cleanup_turn_drafts` 清理 Draft
- [ ] `TurnFileTracker::rollback_turn` 完整回滚
- [ ] `FileChangeSnapshot::scan` 扫描文件
- [ ] `FileChangeSnapshot::capture_after` 计算差异

### 11.2 集成测试

- [ ] Write 工具创建 Final 文件
- [ ] Write 工具创建 Draft 文件（重定向到 .drafts/）
- [ ] Edit 工具修改 Final 文件
- [ ] Edit 工具将文件改为 Draft（移动到 .drafts/）
- [ ] Bash 工具产生新文件，自动检测并分类
- [ ] Bash 工具修改已有文件，记录到追踪器
- [ ] 多 Turn 场景：Turn 1 文件不受 Turn 2 终止影响
- [ ] 终止时清理当前 Turn 的 Draft 文件
- [ ] 终止时回滚当前 Turn 的所有文件

### 11.3 E2E 测试

- [ ] 用户发送消息创建文件，正常结束，文件保留
- [ ] 用户发送消息创建 Draft 文件，正常结束，文件在 .drafts/
- [ ] 用户发送消息执行 Bash 命令产生文件，自动分类
- [ ] 用户发送消息创建文件，终止，Draft 文件被清理
- [ ] 用户发送两次消息，第二次终止，第一次的文件保留
- [ ] Bash 执行 Python 脚本产生输出，终止后清理

---

## 十三、兼容性考虑

### 12.1 向后兼容

- 无标记文件默认视为 Final，保留在根目录
- 现有代码无需修改即可正常工作
- 新功能通过 opt-in 启用

### 12.2 sudowork 端适配

- sudowork 的 `draftsCleanup.ts` 可简化或移除
- 保留降级逻辑作为兜底
- 通过 ACP 协议获取清理结果

### 12.3 配置选项

```json
{
  "fileTracking": {
    "enabled": true,
    "defaultIntent": "final",
    "cleanupOnAbort": "drafts",
    "bashScanEnabled": true,
    "skipDirs": ["target", "node_modules", ".git"]
  }
}
```

---

## 十四、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 意图检测误判 | 提供手动标记机制，默认 Final |
| .drafts/ 目录权限问题 | 创建失败时回退到根目录 |
| 大文件内容保存内存开销 | 仅保存前 10 行用于检测 |
| 并发写入冲突 | 使用文件锁或原子操作 |
| 终止时清理失败 | 记录日志，提供手动清理命令 |
| Bash 扫描性能开销 | 增量扫描，忽略大型目录 |
| Bash 修改文件无法回滚 | 仅支持删除新建文件 |
| 并发命令竞态条件 | 使用 Turn 级别的文件锁 |

---

## 十五、实施步骤

### Phase 1: 基础设施（2-3 天）

1. 创建 `file_intent.rs` - 意图检测
2. 创建 `file_redirect.rs` - 路径重定向
3. 创建 `file_tracker.rs` - Turn 追踪
4. 创建 `file_snapshot.rs` - 文件快照扫描
5. 单元测试

### Phase 2: 工具改造（2-3 天）

1. 扩展 `ToolExecutor` trait
2. 改造 `write_file` 工具
3. 改造 `edit_file` 工具
4. 改造 `bash` 工具（前后扫描）
5. 改造 `powershell` 工具
6. 集成测试

### Phase 3: 运行时集成（1-2 天）

1. 集成到 `ConversationRuntime`
2. 扩展终止 API
3. 集成测试

### Phase 4: 端到端测试（1-2 天）

1. E2E 测试
2. 性能测试（大型项目扫描）
3. 文档更新

**总计约 6-10 天**

---

## 十六、总结

本设计通过在 sudocode 端实现：

1. **文件意图检测** - 自动识别 Final/Draft
2. **智能路径重定向** - Draft 文件直接写入 .drafts/
3. **按 Turn 追踪** - 精确记录每个文件操作
4. **间接文件处理** - Bash/PowerShell 执行前后扫描，追踪产生的文件
5. **终止清理** - 支持选择性清理或回滚

解决了当前事后清理、无法区分 Turn、终止无法清理、间接文件无法追踪等问题，同时保持向后兼容。
