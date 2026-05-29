# Scode 模型调用日志追踪实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 scode 添加完整的模型调用日志追踪功能，支持通过 session_id 追踪整个会话的调用链条。

**Architecture:** 扩展现有 telemetry 模块，新增 SudoclawLogSink 支持自动检测运行模式并输出到对应日志文件。复用 SessionTracer 的追踪能力，增加会话级别事件。

**Tech Stack:** Rust, serde_json, telemetry crate

---

## Task 1: 新增 SudoclawLogSink 结构体

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudocode/rust/crates/telemetry/src/lib.rs`

**Step 1: 添加必要的 imports 和常量**

在文件顶部 `use` 语句后添加：

```rust
use std::sync::Mutex;

const SUDOCLAW_LOG_ROTATE_AFTER_BYTES: u64 = 10 * 1024 * 1024; // 10MB
const SUDOCLAW_LOG_MAX_ROTATED_FILES: usize = 3;
```

**Step 2: 添加 SudoclawLogSink 结构体**

在 `JsonlTelemetrySink` 之后添加：

```rust
/// Telemetry sink that writes to sudoclaw.log or scode.log based on runtime mode.
///
/// When running as a Sudowork child process (detected via SUDOWORK_CHILD_PROCESS
/// environment variable), logs are written to ~/.nexus/logs/sudoclaw.log.
/// Otherwise, logs go to ~/.nexus/logs/scode.log.
pub struct SudoclawLogSink {
    path: PathBuf,
    file: Mutex<File>,
}

impl Debug for SudoclawLogSink {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SudoclawLogSink")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl SudoclawLogSink {
    /// Creates a new sink, automatically detecting the appropriate log path.
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

    /// Creates a new sink with an explicit path (for testing).
    pub fn with_path(path: impl AsRef<Path>) -> Result<Self, std::io::Error> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    /// Resolves the log file path based on runtime mode.
    ///
    /// Priority:
    /// 1. SCODE_LOG_PATH environment variable (explicit override)
    /// 2. SUDOWORK_CHILD_PROCESS environment variable (child process mode)
    /// 3. Default standalone mode
    fn resolve_log_path() -> PathBuf {
        // Priority 1: Explicit override
        if let Ok(path) = std::env::var("SCODE_LOG_PATH") {
            return PathBuf::from(path);
        }

        // Priority 2: Child process mode
        let is_child_process = std::env::var("SUDOWORK_CHILD_PROCESS").is_ok();

        // Priority 3: Default paths
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        if is_child_process {
            home.join(".nexus/logs/sudoclaw.log")
        } else {
            home.join(".nexus/logs/scode.log")
        }
    }

    /// Returns the current log file path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Rotates the log file if it exceeds the size threshold.
    fn rotate_if_needed(&self) -> Result<(), std::io::Error> {
        let metadata = std::fs::metadata(&self.path)?;
        if metadata.len() >= SUDOCLAW_LOG_ROTATE_AFTER_BYTES {
            self.rotate_log_file()?;
        }
        Ok(())
    }

    fn rotate_log_file(&self) -> Result<(), std::io::Error> {
        // Close current file
        drop(self.file.lock().unwrap());

        // Rotate existing files
        for i in (1..SUDOCLAW_LOG_MAX_ROTATED_FILES).rev() {
            let old_path = self.path.with_extension(format!("log.{}", i));
            let new_path = self.path.with_extension(format!("log.{}", i + 1));
            if old_path.exists() {
                std::fs::rename(&old_path, &new_path)?;
            }
        }

        // Rename current to .1
        let rotated = self.path.with_extension("log.1");
        std::fs::rename(&self.path, &rotated)?;

        // Reopen file
        let file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        *self.file.lock().unwrap() = file;

        Ok(())
    }
}
```

**Step 3: 实现 TelemetrySink trait**

在 `SudoclawLogSink` impl 块之后添加：

```rust
impl TelemetrySink for SudoclawLogSink {
    fn record(&self, event: TelemetryEvent) {
        // Attempt rotation before writing
        let _ = self.rotate_if_needed();

        // Format as JSON with timestamp and level
        let log_entry = format_log_entry(&event);

        let mut file = self
            .file
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = writeln!(file, "{}", log_entry);
        let _ = file.flush();
    }
}

fn format_log_entry(event: &TelemetryEvent) -> String {
    use serde_json::json;

    let (level, session_id, event_name, mut attributes) = extract_event_info(event);

    let entry = json!({
        "timestamp": format_timestamp(current_timestamp_ms()),
        "level": level,
        "session_id": session_id,
        "component": "scode",
        "event": event_name,
        "attributes": attributes
    });

    entry.to_string()
}

fn extract_event_info(event: &TelemetryEvent) -> (&'static str, String, String, Map<String, Value>) {
    match event {
        TelemetryEvent::HttpRequestStarted { session_id, attempt, method, path, attributes } => {
            let mut attrs = attributes.clone();
            attrs.insert("attempt".to_string(), Value::from(*attempt));
            attrs.insert("method".to_string(), Value::String(method.clone()));
            attrs.insert("path".to_string(), Value::String(path.clone()));
            ("INFO", session_id.clone(), "model_call_started".to_string(), attrs)
        }
        TelemetryEvent::HttpRequestSucceeded { session_id, attempt, method, path, status, request_id, attributes } => {
            let mut attrs = attributes.clone();
            attrs.insert("attempt".to_string(), Value::from(*attempt));
            attrs.insert("method".to_string(), Value::String(method.clone()));
            attrs.insert("path".to_string(), Value::String(path.clone()));
            attrs.insert("status".to_string(), Value::from(*status));
            if let Some(rid) = request_id {
                attrs.insert("request_id".to_string(), Value::String(rid.clone()));
            }
            ("INFO", session_id.clone(), "model_call_completed".to_string(), attrs)
        }
        TelemetryEvent::HttpRequestFailed { session_id, attempt, method, path, error, retryable, attributes } => {
            let mut attrs = attributes.clone();
            attrs.insert("attempt".to_string(), Value::from(*attempt));
            attrs.insert("method".to_string(), Value::String(method.clone()));
            attrs.insert("path".to_string(), Value::String(path.clone()));
            attrs.insert("error".to_string(), Value::String(error.clone()));
            attrs.insert("retryable".to_string(), Value::Bool(*retryable));
            ("ERROR", session_id.clone(), "model_call_failed".to_string(), attrs)
        }
        TelemetryEvent::HttpResponseUsage { session_id, timestamp_ms, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } => {
            let attrs = serde_json::Map::from_iter([
                ("input_tokens".to_string(), Value::from(*input_tokens)),
                ("output_tokens".to_string(), Value::from(*output_tokens)),
                ("cache_creation_input_tokens".to_string(), Value::from(*cache_creation_input_tokens)),
                ("cache_read_input_tokens".to_string(), Value::from(*cache_read_input_tokens)),
            ]);
            ("INFO", session_id.clone(), "token_usage".to_string(), attrs)
        }
        TelemetryEvent::HttpRequestDebug { session_id, timestamp_ms, url, method, headers, body } => {
            let mut attrs = serde_json::Map::new();
            attrs.insert("url".to_string(), Value::String(url.clone()));
            attrs.insert("method".to_string(), Value::String(method.clone()));
            attrs.insert("headers".to_string(), Value::Object(headers.clone()));
            attrs.insert("body".to_string(), body.clone());
            ("DEBUG", session_id.clone(), "http_request_debug".to_string(), attrs)
        }
        TelemetryEvent::Analytics(analytics_event) => {
            let mut attrs = analytics_event.properties.clone();
            attrs.insert("namespace".to_string(), Value::String(analytics_event.namespace.clone()));
            attrs.insert("action".to_string(), Value::String(analytics_event.action.clone()));
            ("INFO", String::new(), "analytics".to_string(), attrs)
        }
        TelemetryEvent::SessionTrace(record) => {
            ("INFO", record.session_id.clone(), record.name.clone(), record.attributes.clone())
        }
    }
}

fn format_timestamp(ts_ms: u64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = std::time::Duration::from_millis(ts_ms);
    let datetime: chrono::DateTime<chrono::Utc> =
        chrono::DateTime::from(SystemTime::UNIX_EPOCH + duration);
    datetime.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}
```

**Step 4: 添加 chrono 依赖**

在 `/Users/yobach/VSCodeProject/sudocode/rust/crates/telemetry/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
chrono = "0.4"
dirs = "5.0"
```

**Step 5: 运行测试验证编译**

Run: `cd /Users/yobach/VSCodeProject/sudocode/rust && cargo check -p telemetry`

Expected: 编译通过

---

## Task 2: 添加会话级别事件

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudocode/rust/crates/telemetry/src/lib.rs`

**Step 1: 添加 SessionStarted 和 SessionEnded 事件**

在 `TelemetryEvent` enum 中添加新变体（在 `SessionTrace` 之后）：

```rust
    /// Emitted when a scode session starts.
    SessionStarted {
        session_id: String,
        timestamp_ms: u64,
        version: String,
        cwd: String,
        mode: String,
        model: String,
    },
    /// Emitted when a scode session ends.
    SessionEnded {
        session_id: String,
        timestamp_ms: u64,
        total_turns: u32,
        total_input_tokens: u64,
        total_output_tokens: u64,
        duration_ms: u64,
    },
```

**Step 2: 更新 extract_event_info 函数**

在 `extract_event_info` 函数中添加对新事件的处理：

```rust
        TelemetryEvent::SessionStarted { session_id, timestamp_ms, version, cwd, mode, model } => {
            let attrs = serde_json::Map::from_iter([
                ("version".to_string(), Value::String(version.clone())),
                ("cwd".to_string(), Value::String(cwd.clone())),
                ("mode".to_string(), Value::String(mode.clone())),
                ("model".to_string(), Value::String(model.clone())),
            ]);
            ("INFO", session_id.clone(), "session_started".to_string(), attrs)
        }
        TelemetryEvent::SessionEnded { session_id, timestamp_ms, total_turns, total_input_tokens, total_output_tokens, duration_ms } => {
            let attrs = serde_json::Map::from_iter([
                ("total_turns".to_string(), Value::from(*total_turns)),
                ("total_input_tokens".to_string(), Value::from(*total_input_tokens)),
                ("total_output_tokens".to_string(), Value::from(*total_output_tokens)),
                ("duration_ms".to_string(), Value::from(*duration_ms)),
            ]);
            ("INFO", session_id.clone(), "session_ended".to_string(), attrs)
        }
```

**Step 3: 添加 SessionTracer 辅助方法**

在 `SessionTracer` impl 块中添加：

```rust
    pub fn record_session_started(
        &self,
        version: impl Into<String>,
        cwd: impl Into<String>,
        mode: impl Into<String>,
        model: impl Into<String>,
    ) {
        self.sink.record(TelemetryEvent::SessionStarted {
            session_id: self.session_id.clone(),
            timestamp_ms: current_timestamp_ms(),
            version: version.into(),
            cwd: cwd.into(),
            mode: mode.into(),
            model: model.into(),
        });
    }

    pub fn record_session_ended(
        &self,
        total_turns: u32,
        total_input_tokens: u64,
        total_output_tokens: u64,
        duration_ms: u64,
    ) {
        self.sink.record(TelemetryEvent::SessionEnded {
            session_id: self.session_id.clone(),
            timestamp_ms: current_timestamp_ms(),
            total_turns,
            total_input_tokens,
            total_output_tokens,
            duration_ms,
        });
    }
```

**Step 4: 运行测试验证编译**

Run: `cd /Users/yobach/VSCodeProject/sudocode/rust && cargo check -p telemetry`

Expected: 编译通过

---

## Task 3: 编写单元测试

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudocode/rust/crates/telemetry/src/lib.rs`

**Step 1: 在 tests 模块中添加测试**

在 `#[cfg(test)] mod tests` 块中添加：

```rust
    #[test]
    fn sudoclaw_log_sink_resolves_child_process_path() {
        std::env::set_var("SUDOWORK_CHILD_PROCESS", "1");
        let path = super::SudoclawLogSink::resolve_log_path();
        assert!(path.to_string_lossy().contains("sudoclaw.log"));
        std::env::remove_var("SUDOWORK_CHILD_PROCESS");
    }

    #[test]
    fn sudoclaw_log_sink_resolves_standalone_path() {
        std::env::remove_var("SUDOWORK_CHILD_PROCESS");
        std::env::remove_var("SCODE_LOG_PATH");
        let path = super::SudoclawLogSink::resolve_log_path();
        assert!(path.to_string_lossy().contains("scode.log"));
    }

    #[test]
    fn sudoclaw_log_sink_respects_env_override() {
        std::env::set_var("SCODE_LOG_PATH", "/custom/path.log");
        let path = super::SudoclawLogSink::resolve_log_path();
        assert_eq!(path.to_string_lossy(), "/custom/path.log");
        std::env::remove_var("SCODE_LOG_PATH");
    }

    #[test]
    fn sudoclaw_log_sink_writes_json_events() {
        let temp_dir = std::env::temp_dir();
        let log_path = temp_dir.join(format!("test-sudoclaw-{}.log", current_timestamp_ms()));

        let sink = super::SudoclawLogSink::with_path(&log_path).expect("sink should create file");
        sink.record(super::TelemetryEvent::SessionStarted {
            session_id: "test-session".to_string(),
            timestamp_ms: 1234567890,
            version: "0.1.0".to_string(),
            cwd: "/test".to_string(),
            mode: "standalone".to_string(),
            model: "claude-sonnet-4-6".to_string(),
        });

        let contents = std::fs::read_to_string(&log_path).expect("log should be readable");
        assert!(contents.contains("\"event\":\"session_started\""));
        assert!(contents.contains("\"session_id\":\"test-session\""));
        assert!(contents.contains("\"model\":\"claude-sonnet-4-6\""));

        let _ = std::fs::remove_file(log_path);
    }

    #[test]
    fn format_log_entry_produces_valid_json() {
        let event = super::TelemetryEvent::HttpRequestStarted {
            session_id: "session-123".to_string(),
            attempt: 1,
            method: "POST".to_string(),
            path: "/v1/messages".to_string(),
            attributes: serde_json::Map::new(),
        };

        let entry = super::format_log_entry(&event);
        let parsed: serde_json::Value = serde_json::from_str(&entry).expect("should be valid JSON");

        assert_eq!(parsed["level"], "INFO");
        assert_eq!(parsed["session_id"], "session-123");
        assert_eq!(parsed["event"], "model_call_started");
        assert_eq!(parsed["component"], "scode");
    }
```

**Step 2: 运行测试**

Run: `cd /Users/yobach/VSCodeProject/sudocode/rust && cargo test -p telemetry`

Expected: 所有测试通过

---

## Task 4: 修改 API Client 启用日志追踪

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudocode/rust/crates/rusty-sudocode-cli/src/cli/api_client.rs`

**Step 1: 更新 imports**

在文件顶部添加：

```rust
use telemetry::SudoclawLogSink;
```

**Step 2: 修改 AnthropicRuntimeClient::new 方法**

将现有的条件日志追踪改为默认启用：

```rust
impl AnthropicRuntimeClient {
    pub(crate) fn new(
        session_id: &str,
        config: &RuntimeConfig,
        tool_registry: GlobalToolRegistry,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let sudocode_config = &config.sudocode_config;
        let effective_mode = config.auth_mode;

        let resolved = api::resolve_provider_from_config(
            &config.model,
            Some(effective_mode),
            sudocode_config,
        )?;
        let mut client = ApiProviderClient::from_resolved(&resolved, Some(effective_mode))?
            .with_prompt_cache(PromptCache::new(session_id));

        // 默认启用日志追踪
        let sink = Arc::new(SudoclawLogSink::new()?);
        let tracer = SessionTracer::new(session_id, sink);
        client = client.with_session_tracer(tracer);

        Ok(Self {
            runtime: tokio::runtime::Runtime::new()?,
            client,
            session_id: session_id.to_string(),
            model: config.model.clone(),
            enable_tools: config.enable_tools,
            emit_output: config.emit_output,
            allowed_tools: config.allowed_tools.clone(),
            tool_registry,
            progress_reporter: config.progress_reporter.clone(),
            reasoning_effort: None,
            spinner_pause: None,
        })
    }
```

**Step 3: 运行编译验证**

Run: `cd /Users/yobach/VSCodeProject/sudocode/rust && cargo check -p rusty-sudocode-cli`

Expected: 编译通过

---

## Task 5: 在会话启动和结束时记录事件

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudocode/rust/crates/rusty-sudocode-cli/src/main.rs`

**Step 1: 找到会话启动位置**

搜索 `session_id` 创建的位置，在创建 `SessionTracer` 后添加：

```rust
// 记录会话启动
let is_child_process = std::env::var("SUDOWORK_CHILD_PROCESS").is_ok();
let mode = if is_child_process { "child" } else { "standalone" };
tracer.record_session_started(
    env!("CARGO_PKG_VERSION"),
    std::env::current_dir().unwrap_or_default().to_string_lossy(),
    mode,
    &config.model,
);
```

**Step 2: 找到会话结束位置**

在程序退出前添加：

```rust
// 记录会话结束
let duration_ms = start_time.elapsed().unwrap_or_default().as_millis() as u64;
tracer.record_session_ended(
    total_turns,
    total_input_tokens,
    total_output_tokens,
    duration_ms,
);
```

**Step 3: 运行编译验证**

Run: `cd /Users/yobach/VSCodeProject/sudocode/rust && cargo check -p rusty-sudocode-cli`

Expected: 编译通过

---

## Task 6: 集成测试

**Files:**
- Create: `/Users/yobach/VSCodeProject/sudocode/rust/crates/telemetry/tests/sudoclaw_sink_integration.rs`

**Step 1: 创建集成测试文件**

```rust
use telemetry::{SudoclawLogSink, TelemetryEvent, TelemetrySink};
use std::path::PathBuf;
use std::sync::Arc;

fn temp_log_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("sudoclaw-integration-{}-{}.log", name, std::process::id()))
}

#[test]
fn sink_creates_log_file_and_directory() {
    let path = temp_log_path("create-dir");
    let nested = path.join("nested").join("dir").join("test.log");

    let sink = SudoclawLogSink::with_path(&nested).expect("should create nested path");

    assert!(nested.exists());
    let _ = std::fs::remove_file(nested);
    let _ = std::fs::remove_dir(path.join("nested").join("dir"));
    let _ = std::fs::remove_dir(path.join("nested"));
}

#[test]
fn sink_appends_to_existing_file() {
    let path = temp_log_path("append");

    // First write
    let sink1 = SudoclawLogSink::with_path(&path).expect("sink1 should work");
    sink1.record(TelemetryEvent::SessionStarted {
        session_id: "session-1".to_string(),
        timestamp_ms: 1000,
        version: "0.1.0".to_string(),
        cwd: "/test".to_string(),
        mode: "standalone".to_string(),
        model: "claude-sonnet".to_string(),
    });

    // Second write (append)
    let sink2 = SudoclawLogSink::with_path(&path).expect("sink2 should work");
    sink2.record(TelemetryEvent::SessionStarted {
        session_id: "session-2".to_string(),
        timestamp_ms: 2000,
        version: "0.1.0".to_string(),
        cwd: "/test".to_string(),
        mode: "standalone".to_string(),
        model: "claude-sonnet".to_string(),
    });

    let contents = std::fs::read_to_string(&path).expect("should read log");
    assert!(contents.contains("session-1"));
    assert!(contents.contains("session-2"));

    let _ = std::fs::remove_file(path);
}

#[test]
fn multiple_events_in_sequence() {
    let path = temp_log_path("sequence");

    let sink = SudoclawLogSink::with_path(&path).expect("sink should work");

    // Simulate a complete session
    sink.record(TelemetryEvent::SessionStarted {
        session_id: "trace-test".to_string(),
        timestamp_ms: 1000,
        version: "0.1.5".to_string(),
        cwd: "/workspace".to_string(),
        mode: "standalone".to_string(),
        model: "claude-sonnet-4-6".to_string(),
    });

    sink.record(TelemetryEvent::HttpRequestStarted {
        session_id: "trace-test".to_string(),
        attempt: 1,
        method: "POST".to_string(),
        path: "/v1/messages".to_string(),
        attributes: serde_json::Map::new(),
    });

    sink.record(TelemetryEvent::HttpRequestSucceeded {
        session_id: "trace-test".to_string(),
        attempt: 1,
        method: "POST".to_string(),
        path: "/v1/messages".to_string(),
        status: 200,
        request_id: Some("req-123".to_string()),
        attributes: serde_json::Map::new(),
    });

    sink.record(TelemetryEvent::HttpResponseUsage {
        session_id: "trace-test".to_string(),
        timestamp_ms: 2000,
        input_tokens: 500,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100,
    });

    sink.record(TelemetryEvent::SessionEnded {
        session_id: "trace-test".to_string(),
        timestamp_ms: 3000,
        total_turns: 1,
        total_input_tokens: 500,
        total_output_tokens: 200,
        duration_ms: 2000,
    });

    let contents = std::fs::read_to_string(&path).expect("should read log");
    let lines: Vec<&str> = contents.lines().collect();

    assert_eq!(lines.len(), 5);

    // Verify each line is valid JSON with correct session_id
    for line in &lines {
        let parsed: serde_json::Value = serde_json::from_str(line).expect("each line should be JSON");
        assert_eq!(parsed["session_id"], "trace-test");
        assert_eq!(parsed["component"], "scode");
    }

    // Verify event order
    let events: Vec<String> = lines.iter().map(|l| {
        let parsed: serde_json::Value = serde_json::from_str(l).unwrap();
        parsed["event"].as_str().unwrap().to_string()
    }).collect();

    assert_eq!(events, vec![
        "session_started",
        "model_call_started",
        "model_call_completed",
        "token_usage",
        "session_ended"
    ]);

    let _ = std::fs::remove_file(path);
}
```

**Step 2: 运行集成测试**

Run: `cd /Users/yobach/VSCodeProject/sudocode/rust && cargo test -p telemetry --test sudoclaw_sink_integration`

Expected: 所有测试通过

---

## Task 7: 手动验证

**Step 1: 编译 scode**

Run: `cd /Users/yobach/VSCodeProject/sudocode/rust && cargo build --release -p rusty-sudocode-cli`

**Step 2: 运行 scode 并检查日志**

Run: `./target/release/scode --version`

检查 `~/.nexus/logs/scode.log` 是否存在并包含 `session_started` 事件。

**Step 3: 验证子进程模式**

Run: `SUDOWORK_CHILD_PROCESS=1 ./target/release/scode --version`

检查日志是否写入 `~/.nexus/logs/sudoclaw.log`。

---

## 文件改动清单

| 文件 | 改动类型 |
|------|----------|
| `telemetry/src/lib.rs` | 修改 - 新增 SudoclawLogSink、SessionStarted/Ended 事件 |
| `telemetry/Cargo.toml` | 修改 - 添加 chrono, dirs 依赖 |
| `telemetry/tests/sudoclaw_sink_integration.rs` | 新建 - 集成测试 |
| `rusty-sudocode-cli/src/cli/api_client.rs` | 修改 - 默认启用日志追踪 |
| `rusty-sudocode-cli/src/main.rs` | 修改 - 记录会话启动/结束事件 |
