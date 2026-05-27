# Enterprise Remote Cron Design

## Background

Sudowork already has a complete local scheduled-task implementation:

- Jobs are stored in local SQLite table `cron_jobs`.
- `CronService` loads enabled jobs on app startup and starts local timers.
- Due jobs create or reuse local conversations, then send the scheduled prompt through local `WorkerManage`.
- The Scheduled tab is built from local conversations plus local cron job records.

Enterprise mode now has two execution modes:

- **Local mode**: run agents locally in Sudowork. Scheduled tasks should keep the existing local storage and execution behavior.
- **Remote mode**: run agents on Moss Server. Scheduled tasks created from Sudowork should be stored, scheduled, executed, and tracked on Moss Server. Sudowork should only manage and display them.

## Goals

1. Preserve current local cron behavior with minimal changes.
2. Add Moss Server as the source of truth for remote-mode cron jobs.
3. Let remote cron jobs continue running when Sudowork is offline.
4. Show remote cron jobs and their execution conversations in Sudowork's Scheduled tab.
5. Add a Moss Server scheduled-task page for viewing jobs and execution status.
6. Keep local and remote cron data isolated so switching modes never mixes records.

## Non-Goals

- Do not migrate existing local cron jobs to Moss automatically.
- Do not use Sudowork local timers for remote cron execution.
- Do not use Moss's existing `.claude/scheduled_tasks.json` mechanism as the primary remote cron store. That mechanism is project-file oriented and does not provide tenant/user isolation, run history, or admin visibility.

## Current Local Behavior

Local cron jobs use these fields:

```ts
metadata.conversationMode?: 'new' | 'reuse';
metadata.conversationId?: string;
state.lastConversationId?: string;
```

### New Conversation Mode

For `conversationMode = 'new'`, each scheduled run creates a new local conversation.

Current flow:

1. Generate a run title like `yyyy/mm/dd hh:mm - job.name`.
2. Call `createConversation({ source: 'cron', extra: { cronJobId, cronJobName } })`.
3. Store the created conversation id in `job.state.lastConversationId`.
4. Build the agent task with `WorkerManage.getTaskByIdRollbackBuild(conversationId, { yoloMode: true })`.
5. Send the scheduled prompt through `task.sendMessage(...)`.

### Reuse Conversation Mode

For `conversationMode = 'reuse'`, local cron chooses a target conversation with this priority:

```ts
const reuseConversationId = job.state.lastConversationId || job.metadata.conversationId;
```

The behavior is:

1. If `lastConversationId` exists and the task can be resumed, use it.
2. Otherwise, if `metadata.conversationId` exists and can be resumed, use it.
3. Otherwise create a new conversation named after the job.
4. Store the new id in `state.lastConversationId`.
5. If the job had no bound `metadata.conversationId`, set it to the newly created conversation id.

Remote cron should preserve this semantic model, replacing local conversation ids with Moss session ids.

## High-Level Architecture

```text
Sudowork Renderer
  -> ipcBridge.cron.*
    -> CronProviderResolver
       -> LocalCronProvider
          -> existing CronService / CronStore / WorkerManage
       -> RemoteCronProvider
          -> MossCronApi
             -> Moss Server Cron API
                -> Moss CronService / CronStore / Session runtime
```

The resolver chooses a provider per request:

- Non-enterprise mode: `LocalCronProvider`
- Enterprise local mode: `LocalCronProvider`
- Enterprise remote mode: `RemoteCronProvider`

The provider must be resolved at call time, not initialization time, because users can switch between local and remote modes while the app is running.

## Sudowork Frontend Design

### Mode Source of Truth

Use the existing enterprise session mode:

```ts
guid.sessionMode: 'remote' | 'local'
```

This is already used by the Guid page for remote/local execution. The cron UI should read the same setting so the Scheduled tab, cron settings page, and conversation creation behavior remain consistent.

### Cron Settings Page

The Cron settings page should become mode-aware.

In enterprise mode, show a segmented control at the top:

- Remote
- Local

Behavior:

- Switching to Remote:
  - Save `guid.sessionMode = 'remote'`.
  - Call `ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'remote' })`.
  - Refetch cron jobs from Moss.
  - Refresh conversation history.
- Switching to Local:
  - Save `guid.sessionMode = 'local'`.
  - Call `ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'local' })`.
  - Refetch cron jobs from local SQLite.
  - Refresh conversation history.

Non-enterprise users should not see the segmented control.

### Creating a Cron Job

The create drawer should keep its current fields:

- Name
- Schedule
- Prompt
- Conversation mode: `new` or `reuse`
- Optional existing conversation for reuse mode
- Workspace
- Assistant

When saving:

- Local mode: call existing local cron IPC behavior.
- Remote mode: call the same IPC method, but the main process routes to `RemoteCronProvider`.

Remote mode payload must include enough data for Moss to run independently:

```ts
{
  name: string;
  schedule: ICronSchedule;
  message: string;
  conversationMode: 'new' | 'reuse';
  conversationId?: string;       // existing Moss session id when user binds one
  conversationTitle?: string;
  workspace?: string;
  presetAssistantId?: string;
  agentType: 'remote-agent';
  createdBy: 'user';
  runtimeMode: 'remote';
}
```

Remote mode must not store local-only paths or local assistant details unless Moss can use them. If a workspace is local-only and not valid on Moss, the UI should either:

- Disable remote cron creation with that workspace, or
- Convert it to a Moss workspace selector before saving.

### Editing, Pausing, Deleting, Triggering

All existing UI actions remain:

- Pause/resume
- Edit
- Delete
- Run now

The IPC call stays the same. Provider resolution decides whether the action updates local SQLite or Moss Server.

### Scheduled Tab

Current Scheduled tab builds groups from:

1. Cron job records.
2. Conversation records tagged with `extra.cronJobId`.

Remote mode should keep the same grouping model but use remote data:

```text
remote mode Scheduled tab
  -> GET remote cron jobs
  -> GET remote cron sessions
  -> map remote sessions to TChatConversation
  -> buildScheduledGroups(conversations, cronJobs)
```

Mapping a Moss cron session to a Sudowork conversation:

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
    cronRunId: session.cronRunId,
  },
}
```

Grouping rules:

- `conversationMode = 'new'`: one cron job group contains all run sessions for that job.
- `conversationMode = 'reuse'`: one cron job group contains the bound or last session.
- Job has never run: show an empty scheduled-task group with a "not run yet" state.

The empty group behavior is new. Current local grouping may only show groups with conversations; it should be adjusted so a newly created cron job is visible before its first execution.

### Conversation Opening

When a remote cron session is clicked:

1. Navigate to the existing conversation route using the mapped conversation id.
2. The remote conversation provider attaches/resumes the Moss session.
3. If local cache is empty, fetch session context from Moss and hydrate the UI.

## Sudowork Main Process Design

### New Provider Interface

Create a provider interface for cron operations:

```ts
export type CronRuntimeMode = 'local' | 'remote';

export interface CronProvider {
  listJobs(): Promise<ICronJob[]>;
  listJobsByConversation(conversationId: string): Promise<ICronJob[]>;
  getJob(jobId: string): Promise<ICronJob | null>;
  addJob(params: ICreateCronJobParams): Promise<ICronJob>;
  updateJob(jobId: string, updates: Partial<ICronJob>): Promise<ICronJob>;
  removeJob(jobId: string): Promise<void>;
  triggerJob(jobId: string): Promise<void>;
  listSessions?(): Promise<TChatConversation[]>;
  listRuns?(jobId: string): Promise<ICronJobRun[]>;
}
```

### Local Provider

`LocalCronProvider` wraps the existing `cronService`:

```ts
class LocalCronProvider implements CronProvider {
  listJobs() {
    return cronService.listJobs();
  }
  addJob(params) {
    return cronService.addJob(params);
  }
}
```

No behavior changes should be introduced here.

### Remote Provider

`RemoteCronProvider` calls `MossCronApi`.

It maps Moss payloads to existing `ICronJob` so the renderer can reuse most UI components.

Important mapping:

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

### Provider Resolver

Resolution logic:

```ts
function getCronProvider(): CronProvider {
  if (!isEnterpriseMode()) return localCronProvider;
  return getCachedSessionMode() === 'remote'
    ? remoteCronProvider
    : localCronProvider;
}
```

`cronBridge.ts` should call `getCronProvider()` inside each provider function.

### MossCronApi

Add `src/process/remote/MossCronApi.ts`.

Methods:

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

It should reuse the same authentication behavior as `MossSessionApi`: use the enterprise JWT bearer token and retry once after token refresh on 401.

## Moss Server Data Model

### `cron_jobs`

```sql
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,

  schedule_kind TEXT NOT NULL,        -- at | every | cron
  schedule_value TEXT NOT NULL,       -- timestamp | ms | cron expression
  schedule_tz TEXT,
  schedule_description TEXT NOT NULL,

  payload_message TEXT NOT NULL,

  conversation_mode TEXT NOT NULL,    -- new | reuse
  bound_session_id TEXT,              -- existing session selected by user
  last_session_id TEXT,               -- latest run session; reuse fallback
  conversation_title TEXT,

  assistant_id TEXT,
  assistant_name TEXT,
  workspace TEXT,
  runtime_json TEXT,

  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,                   -- ok | error | skipped | missed | running
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_cron_jobs_owner ON cron_jobs(org_id, user_id);
CREATE INDEX idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
CREATE INDEX idx_cron_jobs_bound_session ON cron_jobs(bound_session_id);
CREATE INDEX idx_cron_jobs_last_session ON cron_jobs(last_session_id);
```

### `cron_job_runs`

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

  created_at INTEGER NOT NULL,

  FOREIGN KEY(job_id) REFERENCES cron_jobs(id)
);

CREATE INDEX idx_cron_job_runs_job ON cron_job_runs(job_id, created_at DESC);
CREATE INDEX idx_cron_job_runs_session ON cron_job_runs(session_id);
```

### Session Metadata

Moss sessions created or used by cron must include:

```ts
{
  source: 'cron',
  cronJobId: string,
  cronJobName: string,
  cronRunId: string,
  agentMode: 'remote',
}
```

This metadata is required for Sudowork's Scheduled tab.

## Moss Server API

### List Jobs

```http
GET /api/v1/cron/jobs
```

Query params:

- `enabled=true|false`
- `conversation_id=sessionId`
- `limit`
- `cursor`

Response:

```json
{
  "jobs": []
}
```

### Create Job

```http
POST /api/v1/cron/jobs
Idempotency-Key: <uuid>
```

Body:

```json
{
  "name": "Daily report",
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * *",
    "tz": "Asia/Shanghai",
    "description": "Every day at 9:00"
  },
  "message": "Generate today's report",
  "conversationMode": "new",
  "boundSessionId": null,
  "workspace": "/workspace/project",
  "assistantId": "assistant-id",
  "assistantName": "Report assistant"
}
```

### Get Job

```http
GET /api/v1/cron/jobs/:jobId
```

### Update Job

```http
PATCH /api/v1/cron/jobs/:jobId
```

Supports partial updates:

- `name`
- `enabled`
- `schedule`
- `message`
- `conversationMode`
- `boundSessionId`
- `workspace`
- `assistantId`
- `assistantName`

### Delete Job

```http
DELETE /api/v1/cron/jobs/:jobId
```

Deletes or soft-deletes the job. Prefer soft delete if auditability is required.

### Trigger Job Immediately

```http
POST /api/v1/cron/jobs/:jobId/trigger
```

Creates a run immediately, using the same execution path as a scheduled fire.

### List Runs

```http
GET /api/v1/cron/jobs/:jobId/runs
```

### List Cron Sessions

Either add a dedicated endpoint:

```http
GET /api/v1/cron/sessions
```

or extend the existing sessions endpoint:

```http
GET /api/v1/sessions?source=cron
GET /api/v1/sessions?cron_job_id=:jobId
```

The response must include `cronJobId`, `cronJobName`, and `cronRunId`.

## Moss Authorization

Suggested scopes:

- `cron:list`
- `cron:create`
- `cron:update`
- `cron:delete`
- `cron:trigger`
- `cron:list:any`

Rules:

- Normal users can only operate their own jobs.
- Admin users with `cron:list:any` can view jobs for the whole org.
- Cross-org access is never allowed.
- When binding `boundSessionId`, Moss must verify that the user can access that session.

## Moss Scheduler Design

### Startup

On Moss server startup:

1. Load enabled jobs from `cron_jobs`.
2. Compute or validate `next_run_at`.
3. Register timers or start a polling loop.

Use a polling loop if Moss can run multiple instances. It is easier to combine with database leasing.

### Duplicate Execution Protection

Use a DB lease or conditional update before execution.

Example:

```sql
UPDATE cron_jobs
SET last_status = 'running',
    updated_at = :now
WHERE id = :jobId
  AND enabled = 1
  AND next_run_at <= :now
  AND (lease_until IS NULL OR lease_until < :now);
```

If the update affects zero rows, another worker owns the run.

If Moss is single-process only, this can be simpler initially, but the schema should not prevent a future lease.

### Execution Flow

```text
CronScheduler fires
  -> create cron_job_runs row status=queued
  -> choose or create Moss session
  -> update run status=running, session_id=...
  -> send payload_message to session
  -> update run status=ok/error
  -> update cron_jobs last_* fields and next_run_at
```

### New Conversation Mode

Every run creates a new Moss session:

```ts
const session = await createSession({
  cwd: job.workspace,
  assistantName: job.assistantName,
  source: 'cron',
  title: `${formatRunTime(now)} - ${job.name}`,
  metadata: {
    cronJobId: job.id,
    cronJobName: job.name,
    cronRunId: run.id,
  },
});

job.lastSessionId = session.sessionId;
```

### Reuse Conversation Mode

Pick a target session:

```ts
const reuseSessionId = job.lastSessionId || job.boundSessionId;
```

Then:

1. If `reuseSessionId` exists and is accessible, resume it.
2. Otherwise create a new session named `job.name`.
3. Store the created id in `lastSessionId`.
4. If `boundSessionId` was empty, set it to the created id so future runs use the same session.

This matches current Sudowork local semantics.

### Sending the Scheduled Prompt

The message sent to the session should include cron metadata:

```ts
{
  content: job.payloadMessage,
  meta: {
    source: 'cron',
    cronJobId: job.id,
    cronJobName: job.name,
    cronRunId: run.id,
    triggeredAt: now,
  }
}
```

The model response should be written to the normal session transcript so Sudowork can fetch it through existing session context APIs.

### Error Handling

On failure:

- Set `cron_job_runs.status = 'error'`.
- Store the error message in `cron_job_runs.error`.
- Set `cron_jobs.last_status = 'error'`.
- Set `cron_jobs.last_error`.
- Recompute `next_run_at` for recurring schedules.

For busy sessions in reuse mode:

- Retry with the same max retry behavior as local cron, or mark skipped after `max_retries`.
- Store skipped runs in `cron_job_runs` for visibility.

### Missed Runs

Moss should handle missed jobs differently from Sudowork local:

- If Moss was down and a job is overdue at startup, mark the missed window in job state.
- For recurring jobs, compute the next run and optionally execute once immediately depending on product policy.
- For one-shot `at` jobs, mark `missed` and do not run automatically unless product explicitly wants catch-up.

This policy should be documented in the Moss UI.

## Moss Management UI

Add a "Scheduled Tasks" page.

List view:

- Job name
- Owner
- Enabled
- Schedule description
- Next run
- Last run
- Last status
- Last error
- Run count
- Conversation mode

Detail view:

- Prompt
- Workspace
- Assistant
- Bound session / last session
- Execution history
- Error details

Actions:

- Pause/resume
- Run now
- Delete
- Open associated session

Admin view can include user/org filters if the current user has `cron:list:any`.

## Synchronization With Sudowork

Remote mode reads:

```text
Sudowork useAllCronJobs()
  -> ipcBridge.cron.listJobs
  -> RemoteCronProvider.listJobs
  -> GET /api/v1/cron/jobs
```

Remote Scheduled tab reads:

```text
Sudowork history refresh
  -> fetch remote sessions with source=cron
  -> map to TChatConversation
  -> combine with remote cron jobs
  -> build scheduled groups
```

After create/update/delete/trigger:

- Refetch jobs.
- Refetch cron sessions if trigger may create a session.
- Emit `chat.history.refresh`.

Optional later improvement:

- Moss WebSocket/SSE event for `cron.job.updated` and `cron.run.updated`.
- Sudowork subscribes while in remote mode.

## Compatibility Notes

### Local Mode

Local mode should keep using:

- `CronService`
- `CronStore`
- local SQLite
- local `WorkerManage`
- local conversation list

No Moss API calls should happen for local cron jobs.

### Remote Mode

Remote mode should not:

- Start local timers.
- Insert remote cron jobs into local `cron_jobs`.
- Execute remote cron jobs via local `WorkerManage`.

It may cache remote session metadata locally for faster rendering, but Moss remains the source of truth.

## Testing Plan

### Sudowork Unit Tests

- Provider resolver returns local for consumer mode.
- Provider resolver returns local for enterprise local mode.
- Provider resolver returns remote for enterprise remote mode.
- `RemoteCronProvider` maps Moss job payloads to `ICronJob`.
- Scheduled grouping includes empty groups for jobs with no sessions.
- Scheduled grouping separates local and remote data by mode.

### Moss Unit Tests

- Create/update/delete cron job.
- Compute next run for `cron`, `every`, and `at`.
- `new` mode creates a new session per run.
- `reuse` mode reuses `lastSessionId || boundSessionId`.
- Failed run updates both `cron_job_runs` and `cron_jobs`.
- Authorization rejects cross-user and cross-org access.

### Integration Tests

- Enterprise remote mode creates a cron job from Sudowork and stores it on Moss.
- Sudowork remote Scheduled tab shows the newly created job before first run.
- Manual trigger creates a Moss session and Sudowork displays it under the job.
- Recurring remote job fires while Sudowork is closed.
- Switching to local mode shows only local jobs.
- Switching back to remote mode shows only remote jobs.

## Rollout Plan

1. Add Moss DB schema and CRUD API.
2. Add Moss scheduler and run tracking.
3. Add Moss Scheduled Tasks UI.
4. Add Sudowork `MossCronApi` and remote provider.
5. Make Sudowork cron UI and Scheduled tab mode-aware.
6. Add empty scheduled groups for jobs without run sessions.
7. Add tests and verify local mode regression.

## Open Questions

1. Should remote cron allow local filesystem workspaces, or require selecting a Moss workspace?
2. Should missed recurring jobs execute once immediately after Moss restarts, or only mark missed and wait for the next schedule?
3. Should deleting a remote cron job also hide/delete its historical run sessions?
4. Should admins be able to edit other users' cron jobs or only view them?
5. Should Sudowork cache remote cron jobs locally for offline display, or show remote cron as unavailable when Moss cannot be reached?
