# Sudowork WebUI

独立 Web 服务：不修改 Moss 与桌面端 Sudowork，提供可登录、多用户并发使用的 Moss 远程对话
Web 界面，含智能体、技能库、定时任务、会话历史与四项设置（用户中心 / MCP 服务 / 显示 / 关于）。

- **架构**：浏览器只访问同源的 WebUI 后端；后端以配置的固定 Moss 地址代理 REST/WebSocket，
  按 Cookie 会话隔离用户与 Moss token。Moss 是唯一业务数据源，WebUI 不复制业务数据。
- **技术栈**：Node.js ≥22 <26、Bun、React 19、TypeScript strict、Vite、React Router、
  Arco Design、UnoCSS、SWR、Express 5、ws、PostgreSQL、pg、Zod、Vitest、Supertest、Playwright。
- UI 摘取自 Sudowork 企业端（Apache-2.0，见 `docs/ui-reuse-map.md`）。

## 快速开始（开发）

```bash
# 1) 依赖
bun install

# 2) PostgreSQL（已有实例可跳过；或用 Docker）
docker run -d --name sudowork-webui-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sudowork_webui \
  -p 5432:5432 postgres:16-alpine

# 3) 环境变量（复制 .env.example 为 .env 并填写三个密钥）
cp .env.example .env

# 4) 建表（幂等）
bun run migrate

# 5) 启动（server :25809 + vite :5173，/api 与 /ws 自动代理）
bun run dev
```

打开 http://localhost:5173，用 Moss 账户密码或 API Key 登录。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | WebUI 自有 PostgreSQL（仅存 Web Session / 偏好 / 会话锁） |
| `SESSION_HMAC_KEY` | Cookie token 的 HMAC 密钥（≥32 字节，`openssl rand -hex 32`） |
| `TOKEN_AES_KEY` | Moss access/refresh token 的 AES-256-GCM 密钥（32 字节，`openssl rand -base64 32`） |
| `PUBLIC_ORIGIN` | 对外完整 Origin；生产必须 HTTPS（外部反向代理终结 TLS） |
| `MOSS_BASE_URL` / `MOSS_WS_BASE_URL` | Moss 服务地址（只读访问，不由 WebUI 部署；两者主机必须一致） |
| `PORT` | 服务端口（开发 25809，生产 25808） |

配置文件（`config/sudowork-webui.json`，可 `CONFIG_PATH` 覆盖）提供 server/publicOrigin/
trustProxy/moss/session/upload 段；环境变量优先。

## 生产部署（Docker Compose）

```bash
export SESSION_HMAC_KEY=... TOKEN_AES_KEY=... PUBLIC_ORIGIN=https://webui.example.com \
       MOSS_BASE_URL=http://moss.internal:43127 MOSS_WS_BASE_URL=ws://moss.internal:43127
docker compose up -d --build
```

Compose 启动顺序（计划 3.12）：`postgres`（healthcheck）→ 一次性 `migrate`（成功退出）→
`webui`（`node dist/server/index.js`）。生产要求外部 HTTPS 反向代理；Express 仅在显式
`trustProxy` 时信任代理头。

## 数据库迁移

- `migrations/` 按文件名顺序执行；`schema_migrations` 记录 version/checksum/applied_at。
- 每个 migration 单事务执行，失败回滚并非 0 退出；已应用的 checksum 变化将拒绝启动。
- 空库重复执行 `bun run migrate` 幂等（Compose 的 migrate 服务即依赖此性质）。

## 测试

```bash
bun run typecheck && bun run lint
bun run test:unit          # 单元（含组件）
bun run test:contract      # Moss 请求形状契约（打桩，不依赖真实 Moss）
bun run test:integration   # 集成（需要本地 PostgreSQL，自动建删 sudowork_webui_test 库）
bun run build
bun run test:e2e           # 真实 Moss E2E（见下）
```

### 真实 Moss E2E（计划 3.11）

E2E 只允许专用测试 Moss。必填环境变量（缺失即失败，不 skip）：

```
E2E_BASE_URL=http://127.0.0.1:25808
E2E_USER_A_USERNAME / E2E_USER_A_PASSWORD
E2E_USER_B_USERNAME / E2E_USER_B_PASSWORD
E2E_USER_A_API_KEY
E2E_TEST_PREFIX=webui-e2e-<unique>
```

前置健康检查：两用户可登录、`/api/v1/models/available` 至少一个可用模型。
测试创建的资源一律带 `E2E_TEST_PREFIX` 前缀并在结束时清理；清理失败使 E2E 失败。

## 已知限制（如实保留，不在 WebUI 中伪造成功）

- Moss 无 Session 重命名/删除：WebUI 不提供这两个操作。
- Moss 无普通用户自助改密：用户中心不显示改密。
- 浏览器 WebSocket 无法设置 Moss 要求的 Authorization 头：由 WebUI 后端代理。
- Moss 同一 Session 无多写者协调：WebUI 只保证“经当前实例”的单写（conversation_locks），
  不能约束桌面端、Cron 或 Moss 直连客户端。
- Agent/Skill 同名解析继承 Moss 现状（`assistant_name` / `enabled_skills` 字符串），
  WebUI 在提交前重新核验当前用户可见列表，但不宣称消除同名碰撞。
- WebUI 登出不调用 Moss logout（会影响该用户全部会话的 provider token）；
  Web Session 删除后 Moss token 按自身 TTL 失效。
- 当前上游 WS 协议不发射 thinking 事件、不支持 turn 级 interrupt：WebUI 保留协议兼容位，
  不伪造这两类交互；终止会话走 REST terminate。
- 登录限流为进程内存存储（单实例约束）。

## 范围外（首版明确不做）

Local 会话/终端/浏览器面板/本地知识库/频道/团队/安全中心/充值/成员管理/企业管理/扩展设置；
多实例、Redis、分布式锁、审计平台、outbox、MCP SSE relay、性能压测平台。

## License

Apache-2.0（含自 Sudowork 摘取的样式与组件，保留原始版权头）。
