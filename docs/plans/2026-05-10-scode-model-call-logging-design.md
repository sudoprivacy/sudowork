# Scode 模型调用日志追踪设计

## 概述

为 scode 添加完整的模型调用日志追踪功能，支持通过 session_id 追踪整个会话的调用链条，日志输出为 JSON 结构化格式。

## 需求

1. **日志输出位置**：
   - 作为 Sudowork 子进程运行时：写入 `~/.nexus/logs/sudoclaw.log`（共享日志文件）
   - 独立运行时：写入 `~/.nexus/logs/scode.log`（独立日志文件）

2. **追踪能力**：
   - 每个会话有唯一的 session_id
   - 能按时间顺序追踪完整的调用链条
   - 记录模型调用、请求/响应状态、token 使用情况

3. **日志内容**：
   - 调用时间、模型名称、请求状态、耗时
   - 输入/输出 token 数、缓存命中情况
   - 请求/响应元数据（不含敏感信息如 API key）

4. **日志格式**：JSON 结构化，每行一个事件

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      scode 启动                              │
├─────────────────────────────────────────────────────────────┤
│  1. 检测运行模式                                             │
│     - 检查环境变量 SUDOWORK_CHILD_PROCESS                    │
│     - 或检查 SCODE_LOG_PATH 环境变量                         │
│                                                             │
│  2. 创建 SessionTracer                                      │
│     - session_id: UUID v4                                   │
│     - sink: SudoclawLogSink                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   SudoclawLogSink                           │
├─────────────────────────────────────────────────────────────┤
│  输出路径:                                                   │
│  - 子进程模式: ~/.nexus/logs/sudoclaw.log (追加)            │
│  - 独立模式: ~/.nexus/logs/scode.log                        │
│                                                             │
│  格式: JSON 每行一个事件                                     │
└─────────────────────────────────────────────────────────────┘
```

## 日志事件结构

### 基础字段

所有日志事件都包含以下字段：

```json
{
  "timestamp": "2026-05-10T18:54:18.123Z",
  "level": "INFO",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "component": "scode",
  "event": "model_call_started",
  "attributes": {}
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| timestamp | string | ISO 8601 格式时间戳 |
| level | string | 日志级别：INFO, WARN, ERROR |
| session_id | string | 会话唯一标识（UUID v4） |
| component | string | 固定为 "scode" |
| event | string | 事件类型 |
| attributes | object | 事件特定属性 |

### 事件类型

| 事件名 | 触发时机 | 关键属性 |
|--------|----------|----------|
| `session_started` | scode 启动 | version, cwd, mode, model |
| `model_call_started` | 发起模型请求 | model, request_id, message_count, max_tokens |
| `model_call_completed` | 模型响应完成 | model, request_id, duration_ms, status |
| `model_call_failed` | 模型请求失败 | model, request_id, error, retryable |
| `token_usage` | token 统计 | input_tokens, output_tokens, cache_read, cache_creation |
| `tool_call_started` | 工具调用开始 | tool_name, tool_id |
| `tool_call_completed` | 工具调用完成 | tool_name, tool_id, duration_ms |
| `session_ended` | scode 退出 | total_turns, total_input_tokens, total_output_tokens |

### 事件示例

#### session_started
```json
{
  "timestamp": "2026-05-10T18:54:18.123Z",
  "level": "INFO",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "component": "scode",
  "event": "session_started",
  "attributes": {
    "version": "0.1.5",
    "cwd": "/Users/yobach/Downloads/sudowork",
    "mode": "standalone",
    "model": "claude-sonnet-4-6"
  }
}
```

#### model_call_started
```json
{
  "timestamp": "2026-05-10T18:54:18.456Z",
  "level": "INFO",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "component": "scode",
  "event": "model_call_started",
  "attributes": {
    "model": "claude-sonnet-4-6",
    "request_id": "req_abc123",
    "message_count": 3,
    "max_tokens": 4096,
    "stream": true,
    "tools_enabled": true
  }
}
```

#### model_call_completed
```json
{
  "timestamp": "2026-05-10T18:54:25.789Z",
  "level": "INFO",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "component": "scode",
  "event": "model_call_completed",
  "attributes": {
    "model": "claude-sonnet-4-6",
    "request_id": "req_abc123",
    "duration_ms": 7333,
    "status": "success",
    "stop_reason": "end_turn"
  }
}
```

#### token_usage
```json
{
  "timestamp": "2026-05-10T18:54:25.790Z",
  "level": "INFO",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "component": "scode",
  "event": "token_usage",
  "attributes": {
    "input_tokens": 1500,
    "output_tokens": 823,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 500
  }
}
```

#### session_ended
```json
{
  "timestamp": "2026-05-10T19:30:00.000Z",
  "level": "INFO",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "component": "scode",
  "event": "session_ended",
  "attributes": {
    "total_turns": 5,
    "total_input_tokens": 8500,
    "total_output_tokens": 3200,
    "duration_ms": 2145000
  }
}
```

## 实现细节

### 1. 新增 SudoclawLogSink

在 `telemetry/src/lib.rs` 中新增：

```rust
pub struct SudoclawLogSink {
    path: PathBuf,
    file: Mutex<File>,
}

impl SudoclawLogSink {
    pub fn new() -> Result<Self, std::io::Error> {
        let path = Self::resolve_log_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    fn resolve_log_path() -> PathBuf {
        // 优先使用环境变量指定的路径
        if let Ok(path) = std::env::var("SCODE_LOG_PATH") {
            return PathBuf::from(path);
        }

        // 检测是否作为 Sudowork 子进程运行
        let is_child_process = std::env::var("SUDOWORK_CHILD_PROCESS").is_ok();

        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        if is_child_process {
            home.join(".nexus/logs/sudoclaw.log")
        } else {
            home.join(".nexus/logs/scode.log")
        }
    }
}
```

### 2. 扩展 TelemetryEvent

在现有事件基础上，增加会话级别事件：

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TelemetryEvent {
    // ... 现有事件保持不变 ...

    SessionStarted {
        session_id: String,
        timestamp_ms: u64,
        version: String,
        cwd: String,
        mode: String,
        model: String,
    },

    SessionEnded {
        session_id: String,
        timestamp_ms: u64,
        total_turns: u32,
        total_input_tokens: u64,
        total_output_tokens: u64,
        duration_ms: u64,
    },
}
```

### 3. 修改 API Client 初始化

在 `rusty-sudocode-cli/src/cli/api_client.rs` 中：

```rust
impl AnthropicRuntimeClient {
    pub(crate) fn new(
        session_id: &str,
        config: &RuntimeConfig,
        tool_registry: GlobalToolRegistry,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        // ... 现有代码 ...

        // 默认启用日志追踪（移除 SCODE_HTTP_DEBUG 条件判断）
        let sink = Arc::new(SudoclawLogSink::new()?);
        let tracer = SessionTracer::new(session_id, sink);
        client = client.with_session_tracer(tracer);

        // ... 现有代码 ...
    }
}
```

### 4. 日志文件轮转

为避免日志文件过大，实现自动轮转：

- 轮转阈值：10MB
- 保留文件数：3
- 轮转命名：`scode.log.1`, `scode.log.2`, `scode.log.3`

```rust
const ROTATE_AFTER_BYTES: u64 = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED_FILES: usize = 3;

fn rotate_if_needed(path: &Path) -> Result<(), std::io::Error> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() >= ROTATE_AFTER_BYTES {
        // 执行轮转逻辑
    }
    Ok(())
}
```

### 5. 敏感信息过滤

在输出日志前，过滤敏感信息：

- API Key：只显示前10个字符，其余用 `***` 替换
- Authorization header：只显示 `Bearer xxx...`
- 不记录完整的请求/响应 body，只记录元数据

```rust
fn mask_api_key(key: &str) -> String {
    if key.len() <= 10 {
        return "***".to_string();
    }
    format!("{}***", &key[..10])
}
```

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `telemetry/src/lib.rs` | 修改 | 新增 SudoclawLogSink、SessionStarted/Ended 事件 |
| `rusty-sudocode-cli/src/cli/api_client.rs` | 修改 | 默认启用日志追踪 |
| `rusty-sudocode-cli/src/main.rs` | 修改 | 在启动和退出时记录 session 事件 |

## 测试计划

1. **单元测试**：
   - SudoclawLogSink 路径解析逻辑
   - JSON 序列化格式正确性
   - 敏感信息过滤

2. **集成测试**：
   - 独立运行时日志输出到 scode.log
   - 子进程模式日志输出到 sudoclaw.log
   - 日志文件轮转

3. **手动验证**：
   - 运行 scode，检查日志文件内容
   - 验证 session_id 贯穿整个会话
   - 验证 token 统计准确性

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 日志文件过大影响性能 | 实现自动轮转，限制文件大小 |
| 敏感信息泄露 | 严格过滤 API Key 等敏感字段 |
| 日志写入失败影响主流程 | 使用非阻塞写入，失败时静默忽略 |
| 并发写入冲突 | 使用 Mutex 保护文件句柄 |
