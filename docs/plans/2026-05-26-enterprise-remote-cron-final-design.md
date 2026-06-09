# 企业模式 Remote/Local 定时任务最终设计方案

## 结论

采用 **主进程 Cron Provider 分层 + Moss 原生 Cron 服务 + session metadata 驱动会话列表**。

这个方案保留 Sudowork 当前本地定时任务能力，同时让企业 Remote 模式下的定时任务真正由 Moss Server 托管、调度、执行和记录状态。

核心原则：

- Local 模式：保持现有本地 SQLite、本地 timer、本地 `WorkerManage` 执行逻辑。
- Remote 模式：Sudowork 只负责创建、管理和展示；Moss 负责存储、调度、执行和状态记录。
- remote/local 数据严格隔离，切换模式时切换数据源，不迁移、不混查。
- Moss cron 执行产生的会话必须是真实 Moss session，并写入 cron metadata，方便 Sudowork 会话列表展示。

## 整体架构

```text
Sudowork Renderer Cron UI
  -> ipcBridge.cron.*
    -> CronProviderResolver
       -> LocalCronProvider
          -> existing CronService / CronStore / WorkerManage
       -> RemoteCronProvider
          -> MossCronApi
             -> Moss Server Cron API
                -> Moss CronService / CronStore / Session Runtime
```

Provider 放在 Sudowork **主进程**，不要放在 Renderer。

原因：

- Moss token 和刷新逻辑属于主进程边界。
- 现有 local `CronService` 在主进程。
- Renderer 不应该直接感知 Moss API 的认证和服务端细节。

## 模式选择

继续使用现有企业模式的 session mode：

```ts
guid.sessionMode: 'remote' | 'local'
```

Provider 每次 IPC 调用时动态解析，不在初始化时固定：

```ts
function getCronProvider(): CronProvider {
  if (!isEnterpriseMode()) return localProvider;

  return getCachedSessionMode() === 'remote'
    ? remoteProvider
    : localProvider;
}
```

这样用户在运行时切换 Remote/Local 后，Cron 页面和 Scheduled tab 会立即切换数据源。

## Sudowork 前端设计

### 轻量 session mode hook

不要在 Cron 页面直接复用 `useGuidAgentSelection()`。该 hook 是 Guid 页 agent 选择逻辑，依赖 assistant、model、agent selection 等状态，直接复用会引入不必要副作用。

应抽一个轻量 hook：

```ts
useEnterpriseSessionMode()
```

职责：

- 读取 `guid.sessionMode`
- 设置 `guid.sessionMode`
- 调用 `ipcBridge.eeclaw.setSessionMode.invoke({ mode })`
- 触发 cron job refetch
- 触发 `chat.history.refresh`

### Cron 设置页

企业模式下，Cron 设置页顶部展示 Remote / Local segmented control。

切换到 Remote：

1. 保存 `guid.sessionMode = 'remote'`。
2. 调用 `ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'remote' })`。
3. `useAllCronJobs()` 重新拉 Moss 数据。
4. Scheduled tab 拉 remote cron sessions。
5. 刷新会话列表。

切换到 Local：

1. 保存 `guid.sessionMode = 'local'`。
2. 调用 `ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'local' })`。
3. Cron 列表走本地 SQLite。
4. Scheduled tab 走本地 conversations + local cron jobs。
5. 刷新会话列表。

非企业用户不展示这个切换控件。

### 创建定时任务

UI 字段保持现有体验：

- 任务名
- 调度规则
- Prompt
- `new` / `reuse`
- 可选绑定已有会话
- Workspace
- Assistant

保存时仍然调用：

```ts
ipcBridge.cron.addJob.invoke(...)
```

主进程根据当前 mode 路由：

- Local mode -> `LocalCronProvider`
- Remote mode -> `RemoteCronProvider`

Remote mode payload 需要让 Moss 能独立运行：

```ts
{
  name: string;
  schedule: ICronSchedule;
  message: string;
  conversationMode: 'new' | 'reuse';
  conversationId?: string;       // remote 下代表 Moss session id
  conversationTitle?: string;
  workspace?: string;
  presetAssistantId?: string;
  agentType: 'remote-agent';
  createdBy: 'user';
  runtimeMode: 'remote';
}
```

Remote 模式下需要注意 workspace：

- 如果 workspace 是本地路径且 Moss 无法访问，应禁止创建 remote cron。
- 或者提供 Moss workspace 选择器，确保传给 Moss 的 workspace 是服务端可用路径。

### 编辑、暂停、删除、立即执行

保留现有 UI 操作：

- 暂停/恢复
- 编辑
- 删除
- 立即运行

Renderer 调同一组 IPC；主进程 provider 决定操作本地 SQLite 还是 Moss API。

## Sudowork 主进程设计

### CronProvider 接口

```ts
export type CronRuntimeMode = 'local' | 'remote';

export interface CronProvider {
  readonly type: CronRuntimeMode;

  listJobs(): Promise<ICronJob[]>;
  listJobsByConversation(conversationId: string): Promise<ICronJob[]>;
  getJob(jobId: string): Promise<ICronJob | null>;
  addJob(params: ICreateCronJobParams): Promise<ICronJob>;
  updateJob(jobId: string, updates: Partial<ICronJob>): Promise<ICronJob>;
  removeJob(jobId: string): Promise<void>;
  triggerJob(jobId: string): Promise<void>;

  listRuns?(jobId: string): Promise<ICronJobRun[]>;
  listCronSessions?(): Promise<TChatConversation[]>;
}
```

### LocalCronProvider

`LocalCronProvider` 只包装现有 `cronService`。

不改变本地行为：

- 本地 SQLite `cron_jobs`
- 本地 timer
- 本地 `WorkerManage`
- 本地 Scheduled tab 数据源

### RemoteCronProvider

`RemoteCronProvider` 通过 `MossCronApi` 调 Moss Server。

它负责把 Moss job 映射为现有 `ICronJob`，以便 Renderer 复用现有组件。

映射关系：

```ts
MossCronJob.id               -> ICronJob.id
MossCronJob.enabled          -> ICronJob.enabled
MossCronJob.schedule         -> ICronJob.schedule
MossCronJob.payloadMessage   -> ICronJob.target.payload.text
MossCronJob.conversationMode -> ICronJob.metadata.conversationMode
MossCronJob.boundSessionId   -> ICronJob.metadata.conversationId
MossCronJob.lastSessionId    -> ICronJob.state.lastConversationId
MossCronJob.nextRunAt        -> ICronJob.state.nextRunAtMs
MossCronJob.lastRunAt        -> ICronJob.state.lastRunAtMs
MossCronJob.lastStatus       -> ICronJob.state.lastStatus
MossCronJob.lastError        -> ICronJob.state.lastError
```

### MossCronApi

新增：

```text
src/process/remote/MossCronApi.ts
```

方法：

```ts
class MossCronApi {
  listJobs(): Promise<MossCronJob[]>;
  listJobsByConversation(sessionId: string): Promise<MossCronJob[]>;
  getJob(jobId: string): Promise<MossCronJob | null>;
  createJob(params: CreateRemoteCronJobParams): Promise<MossCronJob>;
  updateJob(jobId: string, updates: UpdateRemoteCronJobParams): Promise<MossCronJob>;
  deleteJob(jobId: string): Promise<void>;
  triggerJob(jobId: string): Promise<void>;
  listRuns(jobId: string): Promise<MossCronRun[]>;
  listCronSessions(): Promise<MossCronSession[]>;
}
```

认证逻辑复用 `MossSessionApi`：

- 使用企业 JWT Bearer token。
- 401 后强制刷新 token 并重试一次。

## Moss Server 数据模型

不要照搬 Sudowork 本地 `conversation_id` 命名。Moss 里应使用 session 语义。

### cron_jobs

```sql
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,

  schedule_kind TEXT NOT NULL,        -- at | every | cron
  schedule_value TEXT NOT NULL,
  schedule_tz TEXT,
  schedule_description TEXT,

  payload_message TEXT NOT NULL,

  conversation_mode TEXT NOT NULL,    -- new | reuse
  bound_session_id TEXT,              -- 用户显式绑定的 Moss session
  last_session_id TEXT,               -- 最近一次执行 session / reuse fallback

  assistant_id TEXT,
  assistant_name TEXT,
  workspace TEXT,
  runtime_json TEXT,

  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  run_count INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_cron_jobs_org_user ON cron_jobs(org_id, user_id);
CREATE INDEX idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
CREATE INDEX idx_cron_jobs_bound_session ON cron_jobs(bound_session_id);
CREATE INDEX idx_cron_jobs_last_session ON cron_jobs(last_session_id);
```

### cron_job_runs

```sql
CREATE TABLE cron_job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  session_id TEXT,
  status TEXT NOT NULL,               -- queued | running | ok | error | skipped | missed
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  summary TEXT,

  created_at INTEGER NOT NULL
);

CREATE INDEX idx_cron_job_runs_job ON cron_job_runs(job_id, created_at DESC);
CREATE INDEX idx_cron_job_runs_session ON cron_job_runs(session_id);
```

## Moss Server API

基础 API：

```http
GET    /api/v1/cron/jobs
POST   /api/v1/cron/jobs
GET    /api/v1/cron/jobs/:id
PATCH  /api/v1/cron/jobs/:id
DELETE /api/v1/cron/jobs/:id
POST   /api/v1/cron/jobs/:id/trigger
GET    /api/v1/cron/jobs/:id/runs
```

会话列表 API：

```http
GET /api/v1/sessions?source=cron
GET /api/v1/sessions?cron_job_id=:jobId
```

也可以新增专用接口：

```http
GET /api/v1/cron/sessions
```

创建任务建议支持：

```http
Idempotency-Key: <uuid>
```

避免 Sudowork 网络重试导致重复创建任务。

## Moss Server 执行逻辑

### new 模式

每次触发创建一个新的 Moss session。

流程：

1. 创建 `cron_job_runs`，状态为 `queued`。
2. 创建新的 Moss session。
3. session title 类似：`2026/05/26 09:00 - 每日报告`。
4. 写入 session cron metadata。
5. 将 `cron_job_runs.session_id` 更新为新 session id。
6. 向 session 投递 `payload_message`。
7. 更新 run 和 job 状态。

### reuse 模式

保持和 Sudowork 本地语义一致。

目标 session 选择：

```ts
const targetSessionId = job.last_session_id || job.bound_session_id;
```

执行策略：

1. 如果 `targetSessionId` 存在且可访问，resume/attach 这个 session。
2. 如果不存在或不可用，创建新 session。
3. 写回 `last_session_id`。
4. 如果没有 `bound_session_id`，也写入新 session，作为任务专属复用会话。
5. 向 session 投递 `payload_message`。

### session metadata

Moss 创建或复用 cron session 时，必须写：

```ts
{
  source: 'cron',
  cronJobId: job.id,
  cronJobName: job.name,
  cronRunId: run.id,
  agentMode: 'remote'
}
```

这是 Sudowork remote Scheduled tab 能看到定时任务会话的关键。

### 发送消息 metadata

发送到 Agent 的消息也应带 cron meta：

```ts
{
  content: job.payload_message,
  meta: {
    source: 'cron',
    cronJobId: job.id,
    cronJobName: job.name,
    cronRunId: run.id,
    triggeredAt: Date.now()
  }
}
```

## Moss 调度可靠性

初版建议使用 DB lease / conditional update，不强依赖 Redis。

执行前抢占：

```sql
UPDATE cron_jobs
SET last_status = 'running',
    updated_at = :now
WHERE id = :jobId
  AND enabled = 1
  AND next_run_at <= :now
  AND (lease_until IS NULL OR lease_until < :now);
```

更新成功才执行，避免多实例重复触发。

如果 Moss 部署环境已经稳定提供 Redis，可二期抽象 `CronLock`，增加 Redis lock 实现。

执行结果：

- 成功：`cron_job_runs.status = 'ok'`，更新 `last_status`、`last_run_at`、`run_count`。
- 失败：`cron_job_runs.status = 'error'`，写入 `error`，更新 `last_error`。
- 会话忙：按本地 `maxRetries` 逻辑重试，超限标记 `skipped`。
- Moss 重启后 missed job：记录 `missed`，recurring job 计算下一次；是否立即补跑作为产品策略配置。

## Sudowork Scheduled Tab 展示

Remote 模式 Scheduled tab 数据来源：

```text
GET /api/v1/cron/jobs
GET /api/v1/sessions?source=cron
```

将 Moss session 映射成 `TChatConversation`：

```ts
{
  id: session.sessionId,
  name: session.title,
  type: 'remote-agent',
  source: 'cron',
  modifyTime: session.lastActiveAt,
  extra: {
    sessionModeParam: 'remote',
    mossSessionId: session.sessionId,
    cronJobId: session.cronJobId,
    cronJobName: session.cronJobName,
    cronRunId: session.cronRunId
  }
}
```

然后复用现有分组逻辑：

```ts
buildScheduledGroups(conversations, cronJobs)
```

需要增强：

- `new`：一个 cron job group 下展示所有 run sessions。
- `reuse`：一个 cron job group 下展示 `bound_session_id || last_session_id` 对应 session。
- 任务尚未执行：也显示空任务组，提示“尚未执行”。

不建议只用 `cron_job_runs` 构造伪 conversation。

原因：

- `reuse` 模式下同一 session 可能有多条 run，按 run 构造会重复显示同一个会话。
- 会话列表应展示真实会话，执行历史应作为详情信息展示。

## Moss 管理后台

新增 “定时任务” 管理页面。

列表字段：

- 任务名
- 所属用户
- 启用状态
- 调度规则
- 下一次执行时间
- 上次执行时间
- 上次状态
- 错误信息
- 执行次数
- 会话模式

详情页：

- Prompt
- Workspace
- Assistant
- `bound_session_id`
- `last_session_id`
- 执行历史 `cron_job_runs`
- 错误详情

操作：

- 暂停/恢复
- 立即执行
- 删除
- 打开关联 session

统计能力可以二期做：

- 成功率
- 平均执行耗时
- 失败趋势

## 权限设计

建议 scopes：

- `cron:list`
- `cron:create`
- `cron:update`
- `cron:delete`
- `cron:trigger`
- `cron:list:any`

规则：

- 普通用户只能管理自己的 cron jobs。
- 管理员带 `cron:list:any` 可查看组织内所有 cron jobs。
- 跨 org 禁止访问。
- 绑定 `bound_session_id` 时，Moss 必须校验用户有该 session 的访问权限。

## 不建议采用的设计

不要在 Cron 页面直接调用 `useGuidAgentSelection()`。

原因：

- 它是 Guid 页 agent selection hook。
- 依赖 assistant、model、availableAgents 等状态。
- 会带来不必要副作用，例如默认 agent 重置、历史刷新、模型状态变动。

不要只依赖 `cron_job_executions` 构造会话列表。

原因：

- execution/run 是执行历史，不是真实会话。
- `reuse` 模式会导致同一 session 多次重复展示。
- Sudowork 现有 Scheduled tab 更适合基于真实 session metadata 分组。

不要初版强依赖 Redis lock。

原因：

- Moss 当前部署是否必备 Redis 不明确。
- DB lease 能先满足单库和多数多实例场景。
- Redis lock 可以作为二期可插拔实现。

## 实施顺序

1. Moss 新增 `cron_jobs`、`cron_job_runs` 表。
2. Moss 新增 Cron CRUD API。
3. Moss 新增 CronService 调度器和 DB lease。
4. Moss 执行 cron 时创建/复用 session，并写 cron metadata。
5. Moss 暴露 cron sessions 查询能力。
6. Sudowork 新增 `MossCronApi`。
7. Sudowork 新增 `RemoteCronProvider`、`LocalCronProvider`、`CronProviderResolver`。
8. Sudowork `cronBridge` 改为按 mode 路由。
9. Sudowork Cron UI 接入轻量 `useEnterpriseSessionMode()`。
10. Sudowork Scheduled tab 支持 remote cron jobs + remote cron sessions + 空任务组。
11. Moss 管理后台新增定时任务页面。
12. 补测试并验证 local 模式不回归。

## 测试计划

### Sudowork

- 非企业模式始终使用 local provider。
- 企业 Local 模式使用 local provider。
- 企业 Remote 模式使用 remote provider。
- mode 切换后 cron job list refetch 正确。
- local 和 remote Scheduled tab 不串数据。
- remote cron session 能映射为 `TChatConversation`。
- 未执行过的 remote cron job 也能显示空任务组。

### Moss

- Cron job CRUD。
- `new` 模式每次执行创建新 session。
- `reuse` 模式复用 `last_session_id || bound_session_id`。
- session metadata 正确写入。
- run 状态成功/失败/跳过正确记录。
- 权限隔离：普通用户不能访问他人任务。
- DB lease 避免重复执行。

### 集成

- Sudowork Remote 模式创建任务，Moss 成功存储。
- Sudowork Local 模式创建任务，本地 SQLite 存储。
- Remote 任务到点执行，Sudowork 关闭时 Moss 仍执行。
- Remote 任务执行后，Sudowork Scheduled tab 能看到执行会话。
- `new` 和 `reuse` 两种模式会话展示正确。

## 开放问题

1. Remote cron 是否允许使用本地 workspace，还是必须选择 Moss workspace？
2. Moss 重启后 missed recurring job 是否需要立即补跑一次？
3. 删除 remote cron job 时，历史 run 和关联 session 是否保留？
4. 管理员是否允许编辑他人 cron job，还是只读查看？
5. Sudowork 是否需要离线缓存 remote cron jobs，还是 Moss 不可用时直接显示不可用状态？
