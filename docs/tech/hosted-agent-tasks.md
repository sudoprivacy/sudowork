# Internal hosted Agent tasks

The organization directory now includes published internally hosted artifacts in
**Agent library → Exclusive agents → Internally hosted**. Desktop and WebUI use
one renderer and one typed Moss client. These are organization catalog entries;
opening one does not install a personal agent or invoke the native scode runtime.

The client submits the experimental Moss-owned `SubmitTask` contract through
`POST /api/v1/tasks`. Its first turn pins the displayed approved version. Further
turns retain the server session's original version. This implementation supports
synthetic independent text turns only; no previous conversation, tools, files or
workspace content are silently added. The page makes that limit visible.

HostedTask, HostedTaskEvent and HostedEventsPage are consumed as their own types.
They are not relabelled ExternalTask responses. The client checks task/session/
artifact association, event sequence and snapshot horizon, and rejects success
without cleanup confirmation. Worker output uses the same restricted Markdown
renderer as external agents.

Before dispatch, the exact request and idempotency key are retained in the tab's
session storage under its Moss account identity and route. An unconfirmed reply
can be retried explicitly using the same key and version after a reload. No
execution is automatically retried. The record is removed only after a confirmed
response. A different account cannot restore that pending request.

History is projected into the common timeline with a `hosted:` route prefix,
separate from `external:` and native runtime IDs. Catalog withdrawal leaves prior
history readable while Moss controls further execution. Cancel is a request until
Moss confirms cleanup. An unknown task preserves partial output, offers cleanup
reconciliation, and requires confirmed cleanup plus a note before closing its
session. Closing does not change its outcome to success.

Desktop uses the current account's authenticated Electron transport. WebUI uses
its authenticated server session and an explicit route allowlist. Both retain
identity fencing and one total request deadline across token refresh; neither
receives provider, IAM or Router credentials.

## Validation and limits

Validation at this checkpoint: full desktop suite 3,334 passed, 30 skipped
(`bun run test --maxWorkers=2`); WebUI route/transport group 15 passed; real
main/renderer Vite source-bundle probes 2 passed. Desktop, renderer and WebUI
typechecks passed. The full WebUI production bundle and server build passed with a 4 GB Node heap
(the local default 2 GB was insufficient). Actual CUA operation using the
isolated WebUI + PostgreSQL + Moss deployment verified organization directory
filtering, shared timeline navigation, persisted rejection and disabled sending
after a page reload. This is negative admission evidence, not a positive L2 run.

Focused client, UI, desktop transport and history tests cover ambiguous acceptance,
account changes, status evidence, unknown cleanup and route identity. WebUI tests
cover route authentication, forwarding and bounded transport. Check final suite
and build logs before release; passing local protocol tests does not establish
complete Agent Management 1.1 or L2 qualification.

Moss requires `MOSS_AGENT_HOSTED_TASKS_ENABLED=1` after every controller sharing
its task database supports hosted runtime isolation. Publication still requires
Nexus admission, an approved exact artifact version, channel promotion and member
authorization. This consumer does not lower that requirement or promote a level.
The actual IM example has been deferred by the user. Installers and signing are
outside this work.
