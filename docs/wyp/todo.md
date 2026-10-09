# Sudowork 待梳理 TODO（wyp）

> 接手项目后需要进一步搞清楚的两个核心问题。下面已根据初步源码探索填了线索，
> 标 `[ ]` 的是仍需亲自读代码确认的子项，标 `(初步)` 的结论需要再核对。

---

## 1. 本地数据库承载了哪些功能？

**入口文件**：`src/process/database/`（schema.ts / migrations.ts / index.ts）、`src/process/initStorage.ts`
**技术**：SQLite（better-sqlite3），库文件位于用户数据目录（`~/.sudowork/` 或各平台 AppData）。

### 待确认子项

- [ ] **完整表清单**：通读 `src/process/database/schema.ts`，列出所有表及字段。
- [ ] **conversations 表**：会话元数据（id / type=`acp`|`remote-agent` / 工作区 / 时间戳 / extra JSON）——确认 extra 里存了什么。
- [ ] **messages 表**：消息持久化（msg_id / conversation_id / type / content / status / position）——确认与 `common/chatLib.ts` 的 `TMessage` 如何映射。
- [ ] **users 表**：WebUI 账号（username / password_hash(bcrypt) / jwt_secret）。
- [ ] **自定义模型 provider 表**（初步名 `scode_custom_model_providers`）：base_url / api_key / models——确认 api_key 是否加密存储。
- [ ] **channels 相关表**：IM 用户绑定、会话、配对码（`src/channels/types.ts` 里的 IChannelUser / IChannelSession / IChannelPairingRequest）——确认是否都落库、配对码过期清理逻辑。
- [ ] **cron 定时任务**：任务配置存在 DB 还是单独文件？（查 `src/process/services/cron/`）
- [ ] **凭证加密**：`src/channels/utils/credentialCrypto.ts` 加密的 IM 平台凭证存哪、用什么密钥。
- [ ] **配置存储**：哪些走 DB、哪些走 Base64 编码的 txt 文件（`initStorage.ts` 里提到 `sudowork-config.txt` 等）——区分清楚"DB 承载"vs"文件承载"。
- [ ] **迁移机制**：`migrations.ts` 的版本管理方式，升级时如何演进。

### 初步结论（待核对）

| 数据类别 | 存储位置(初步) | 说明 |
|---------|--------------|------|
| 会话 / 消息 | SQLite | 聊天历史核心 |
| WebUI 用户 | SQLite | bcrypt + JWT |
| 自定义模型 provider | SQLite | api_key 加密性待查 |
| IM 绑定 / 配对 | SQLite | channels 模块 |
| 系统配置 / 偏好 | Base64 txt 文件(初步) | 非 DB，需确认边界 |
| 技能 / 助手 | 文件目录 `skills/` `assistants/` | 元数据是否进 DB 待查 |

---

## 2. 哪些功能需要和后端交互？

> "后端"在本项目指**应用进程之外的远程服务**。初步识别出多条外部交互链路，需逐一确认。

### 待确认子项

- [ ] **Moss Server（企业远程 Agent）**：会话类型 `remote-agent` 的核心。
  - 入口：`src/agent/remote/MossWsConnection.ts`、`src/process/task/RemoteAgent.ts`、`src/process/bridge/mossBridge.ts`
  - [ ] 通信协议（WebSocket + 什么消息格式）
  - [ ] 鉴权方式、Server URL 如何配置（查 initStorage 里的 Moss Server URL）
  - [ ] session 创建 / 恢复（mossSessionId）流程
- [ ] **Nexus 服务**：`src/common/nexus/` + `src/process/services/nexus-vfs/`
  - [ ] VFS 虚拟文件系统（gRPC via nexus-napi）——存什么、为谁存
  - [ ] 密钥管理（secret-cache / secret-migration）——API key 是否托管在 Nexus 后端
  - [ ] SSE 流式接口用在哪
- [ ] **AI 模型 Provider**：各家大模型 API 调用
  - [ ] 是 Agent 子进程（CLI）自己直连，还是经过本应用代理？（查 `src/process/providers/`、`authProxy.ts`）
  - [ ] 支持的平台清单（Gemini / Anthropic / OpenAI / Bedrock / 通义 / 智谱 / Kimi / Ollama 等）
- [ ] **IM 平台 API（Channels）**：Telegram / 飞书 / 钉钉 / 企微 / 微信 / 禅道
  - [ ] 各 plugin 的出站调用（发消息、下载附件 `mediaDownloader.ts`）
  - [ ] webhook 还是长轮询 / 长连接
- [ ] **CLI / 二进制下载**：`scripts/download-*.js`（scode / node / nexus-vfs / bdpan / mcporter / claude-code / openclaw）
  - [ ] 从哪个 CDN / 服务下载、是否校验签名
- [ ] **自动更新**：`src/common/update/` + autoUpdater——更新源地址。
- [ ] **遥测 / 崩溃上报**：`src/process/telemetry/`、`src/shared/types/{telemetry,crash}.ts`——上报到哪、上报什么、能否关闭。
- [ ] **MCP 服务器**：`src/process/services/mcp/`——本地 stdio 还是远程 SSE/HTTP MCP，远程的算外部交互。

### 初步结论（待核对）

| 交互链路 | 方向 | 关键文件(初步) | 用途 |
|---------|------|---------------|------|
| Moss Server | WebSocket | `agent/remote/`、`task/RemoteAgent.ts` | 企业远程 Agent |
| Nexus | HTTP / gRPC / SSE | `common/nexus/` | VFS、密钥托管 |
| 大模型 API | HTTPS | Agent 子进程 / `providers/` | 推理（直连 or 代理待查）|
| IM 平台 | HTTPS / 长连接 | `channels/plugins/*` | 机器人收发消息 |
| 二进制下载 | HTTPS | `scripts/download-*.js` | 拉取 CLI 运行时 |
| 自动更新 | HTTPS | `common/update/` | 应用升级 |
| 遥测上报 | HTTPS | `process/telemetry/` | 埋点 / 崩溃 |

---

## 进度记录

- 2026-06-10：创建本 TODO，填入初步线索（来自 `docs/wyp/index.html` 的架构探索）。
