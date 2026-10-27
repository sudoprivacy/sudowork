# Sudograph model adapter: first host slice

This implementation connects the existing native conversation and project CLI to
Sudograph's transactional model authoring protocol. It is not a deployment of
the complete integration plan.

## Ownership and storage

`studio_projects` registers each project's model authority: existing projects
remain `rdf`; a host-registered `sudograph` project contains an opaque `modelRef`.
The two authorities cannot overwrite or implicitly replace each other.
`studio_sessions` references this project registry instead of requiring an RDF
payload. Its migration preserves existing sessions and conversation IDs. The
existing conversation registry and reaper continue to own chat lifecycle.

`OntologyStudioDatabase` refuses legacy snapshot reads, saves, resets and deletes
for Sudograph projects. This also protects callers reached through Studio,
imports, legacy authoring commands and restore paths. No empty RDF workspace is created.
Deleting a canonical model needs its own lifecycle adapter; it is not silently
implemented as a legacy snapshot reset.

## Compiler transport and tools

The host deployment configures:

```text
SUDOGRAPH_PYTHON=<pinned Python executable with Sudograph dependencies>
SUDOGRAPH_COMPILER_ROOT=<deployed Sudograph checkout/package root>
SUDOGRAPH_MODEL_DIRECTORY=<host-owned canonical stores>
```

The trusted host calls `OntologyService.registerSudographSourceProject` with its
workspace identity, title, opaque model reference, authorized source,
namespace, operation ID and locale. `SudographModelClient.registerSource` invokes
the private registrar, forces live delivery with zero embedded rows and checks
the compiler's complete-scan receipt before binding project authority. A failed
scan creates no project and no empty RDF snapshot. Retrying the same registration
recovers its durable receipt, including after a lost response between model
creation and host project binding. A different registration cannot rebind the
model. The existing lower-level `registerSudographProject` remains available for
deployment tooling that already owns a registered canonical store.

In a configured Sudograph deployment, the connection form and `register_source`
project command use the same checked registration pipeline. Both accept SQLite,
PostgreSQL and MySQL; neither lets an
author choose model storage, namespace or authority. The source tool returns the
registered project and its `open_path`; connecting another source does not silently
replace the current project's baseline. Partial runtime configuration fails
explicitly; a failed canonical scan is never retried through RDF. Deployments
without any Sudograph runtime configuration retain the existing RDF intake and
portable-package workflow, identified by their returned `rdf` authority. Those
projects do not constitute a complete Sudograph projection.
Users do not run operator commands during normal modelling.

Sudowork owns network drivers and OS-encrypted source credentials. A private,
short-lived loopback transport supplies provider reads to the compiler; YAML holds
only `registered://<opaque identity>`. Reads run in a read-only repeatable-read
transaction and registration rechecks the catalogue before publication. Discovery
exhausts the registered schema's SELECT-visible objects without a row-count cap.
Unsupported consistency, unavailable view definitions and unresolved structure fail
the scan instead of yielding a complete receipt. PG foreign tables and MySQL
non-InnoDB tables currently require another provider contract. Exact decimal, large
integer and binary values have explicit wire encodings for live record pages.

`SudographModelClient` launches a private JSON-lines worker with deployment-owned
paths. The model writer checks source pins, namespace, identity reservations,
definition versions, base revisions and operation IDs. Graph, context and model
advance together only after compilation succeeds. Ordinary model edits do not
use the optional GitLab human-review publisher and do not change source data.

The shared project CLI discovers four canonical model commands and the common
`register_source` command:

- `sudograph_contract`
- `sudograph_apply`
- `sudograph_context`
- `sudograph_context_read`

Tool discovery uses the persisted project authority. Requests require a scoped
builder token and matching project registration on the server. A global legacy
token cannot call the canonical routes. Compiler conflict codes and recovery
details survive both HTTP and the versioned CLI JSON protocol. Successful edits emit
`ontology.model-changed` with the model revision and context digest.

The shared RDF script runtime stores its CLI in a host-owned, content-addressed
read-only blob and links that blob into model artifacts when the filesystem
supports it. Each use still checks its hash, and each sealed package retains its
own checksum. Source rebuilds publish through atomic replacement and cannot
rewrite old artifact bytes. Python discovery runs only when the runtime lock
requires Python and no interpreter is already bound. Full CLI/archive round trips
run as integration tests with a separate budget from browser input tests.

Conversation creation and restoration load the current compiled context instead
of the RDF builder workflow prompt for canonical projects. The renderer no longer
duplicates that host-owned prompt selection.

## Native source intake and project navigation

Configured desktop deployments offer **Connect database** in the existing
library. The host derives model reference, project identity and namespace from
the registration operation. Intake accepts shared read-only database connectors and
refuses caller-selected bindings, unsupported providers and relative SQLite paths.
Database passwords are stored by the host, not model YAML or renderer storage.
Unconfigured deployments retain legacy creation; canonical projects never
fall back to RDF.

The form retains only an opaque operation ID and locale across reloads, without
persisting source paths or credentials in browser storage. Resuming first checks
the host project registry. A completed registration opens the existing project
without rescanning. If no project exists, selecting the source again retries the
same compiler operation, including recovery between model publication and host
binding. The retry handle is cleared after success.

Registration also reserves its host identity before scanning. Concurrent requests
for the same account/source join one operation. A later request recovers that
reservation after interruption; reconnecting with a new name/password retains the
existing project and business edits. Address migration still requires explicit
registration evidence rather than an LLM identity guess.

The library lists both authorities. Canonical details use the private `overview`
operation: current revision/context digest and source registration receipt. They
do not transfer frozen model rows to obtain counts. A complete scan is historical
evidence, not a test of current connection availability. Older stores without
receipts make no coverage claim. Canonical projects have no legacy RDF editor,
save or delete control.

The existing Studio conversation receives the persisted project identity.
Project/model events refresh matching metadata and ignore unrelated projects or
late responses. This creates no second chat implementation or workflow prompt.
The source overview is not the independent graph review page and does not
establish safe active-session context refresh.

## Private authenticated review route

`OntologyService.createStudioReviewSession` is a trusted browser-host entry, not
an IPC provider or builder tool. It resolves the persisted project and Studio
conversation, then prepares a short-lived native review session. Its return value
contains an HttpOnly cookie handoff and must remain inside the trusted host. No
cookie value is placed in a URL, generated graph, prompt or renderer IPC reply.
Credential properties are non-enumerable and frozen: ordinary JSON serialization,
structured clone and bridge redaction only retain the public URL. The trusted
browser adapter must explicitly read the private handoff.

`SudographReviewHost` binds a loopback listener to the current OS profile and
rechecks project/conversation ownership for every request and after each compiler
read, including the current Moss account's ownership of the underlying
conversation. An account switch invalidates the old session even while a read is
in flight. Cookie paths are scoped to their random review reference; knowing the URL
does not grant access. Sessions expire after 30 minutes and can be revoked or
closed. Host/Origin checks, exact resource matching, bounded JSON and `no-store`
responses apply. The registry selects the model; there is no second editable
catalogue, anonymous fallback or export grant. The Python private read worker
reuses Sudograph's checked renderer and version-bound record reader.

The canonical Studio conversation exposes **Open review** after its persisted
conversation is ready. The renderer sends only project and conversation IDs.
Its chat embeds the regular `ChatConversation` shell, including the shared
workspace, browser, terminal and deliverables panels. The browser panel observes
the same conversation-owned browser as the standalone review window; there is no
second graph renderer or review session for the panel. Owned model conversations
also appear in the normal account-scoped history. Opening one through the general
conversation route returns to its owning project and selected model conversation.

The host resolves those identities, prepares the private session and asks
`LocalBrowserSessions.openAuthorizedPage` to install its cookie before navigation.
An unsuccessful browser launch revokes the application session. Credentials do
not enter the public browser action schema, IPC replies or model tools.

The existing engine acknowledgement barrier pauses tools before human control,
including the first browser start. A new review starts owned CDP Chrome headful;
an existing headless session retains its mode and opens the existing authenticated
viewer route in a separate tab. A retry button remains if popup blocking prevents
that viewer from opening. Returning through the ordinary chat message path obtains
a fresh observation before resuming tools. The worker must advertise
`authorizedPageLaunch`; an old runtime or unsupported personal/extension transport
fails explicitly rather than exposing a URL or restarting an existing browser.

The Studio session registry is filtered against the conversation database and
current account; it does not adopt or delete guest/other-account conversations.
Creating, looking up and deleting sessions use that same ownership boundary.
Account transitions first stop the local engines, then close the old browser
workers and revoke their MCP tokens. Admission reopens only after shutdown is
acknowledged, with a new epoch rejecting previously queued prompts. Failure keeps
the fence held. Restoring an older profile with a retired account's browser lease
uses the same checked shutdown path. An explicit Open review action can switch
the review conversation after acknowledged engine pauses, including restart
recovery. Ordinary browser actions and chat cannot take another conversation's lease.

## Default-on private comments

The normal host installs the pinned ShareOne review shell through the standard
development/package scripts and includes its checked assets in `extraResources`.
No caller must remember an environment override. Only an unpackaged developer
build accepts `SUDOWORK_SHAREONE_REVIEW_ASSETS` for isolated review-shell work.
The pinned ShareOne source repository is private. CI builds use
the dedicated Actions secret `SHAREONE_REVIEW_GITHUB_TOKEN` with Contents: read
access limited to `sudoprivacy/shareone`. The generic release `GH_TOKEN` is not a
substitute: its repository selection may exclude ShareOne. Configure the dedicated
credential in Sudowork repository secrets; never put its value in source or logs.
Git receives it through a repository-scoped process environment
header, never a URL or command argument. Frontend installation uses the host Node/npm
layout and drops Electron and cross-compilation target overrides before building
the shell. Local development may use its configured Git credential helper or the
verified `SHAREONE_REVIEW_SOURCE` checkout.

The host serves the real ShareOne composer, sidebar and anchor SDK around local
compiler output. It registers a private owner/collaborator ShareOne comment space
with an empty placeholder document; the database-backed graph and live records
remain on the authorized host. Existing ShareOne login pairs a current user's
credential into the host vault. Provider credentials never enter page config,
sandbox messages or browser replies. Comments default on; missing account pairing
is visible instead of a read-only page claiming to be an integrated review.

The host stamps top-level comments with the actually served revision, project and
conversation. ShareOne's existing durable consumer API supplies comment events.
The existing Studio SQLite registry commits an inbox before ACK; delivery joins
the ordinary conversation queue and agent process. Agent responses are persisted
before posting to the original thread. Failed posting retries the saved reply,
not the LLM turn. A recorded but uncertain interrupted turn is held for explicit
recovery instead of duplicated. Wrong-account callbacks and unrelated shares are
refused. Multiple review sessions do not fan a bound thread into other agents.

Checked edits refresh the same iframe after an active comment draft ends.
Stable source anchors can reveal their target in another view and then read live
records through the authenticated parent gateway. Source data is never modified;
comment resolution alone does not confirm a business definition.

`tests/integration/sudographReviewLaunch.live.ts` exercises the actual compiler,
HTTP host, worker and Chrome in both modes, without fixture cookie installation.
It requires the registered source object in the real accessibility tree, checks
zero record preload, reload, anonymous denial and an unchanged source database,
and preserves a screenshot and receipt. Engine pause/resume uses an explicit
synthetic acknowledgement fixture, not a running agent. The earlier
`tools.accept_review --sudowork <checkout>` fixture still covers paging and
revocation but installs its own cookie and does not establish this handoff.
This is local OS-profile scope, not cloud tenant or row/field authorization.

The cross-repository native-review CI job pins both source runtimes and runs this
same headless/headful journey on Windows and Linux. It does not replace acceptance
of the official installed SDK. The current production SDK pin predates the new
capability, so the entry reports that a runtime update is required until the
corresponding public SDK release and consumer pin are delivered.

## Acceptance boundary

### Local UX review before a public SDK release

An unpackaged Desktop build accepts the host-owned
`SUDOWORK_DEV_BROWSER_PYTHON` environment variable for an existing absolute
interpreter path. Install the candidate browser wheel in an isolated virtual
environment first. The service verifies that interpreter can import the worker,
with `PYTHONPATH` and user-site imports disabled, and does not install packages
into it. Packaged applications ignore this development setting and retain the
official SDK version check and app-owned installer.

Use a separate Electron home and user-data directory for a local UX review;
register the source through the actual connection form. Do not copy another
profile's login tokens or rewrite a candidate package's version to satisfy the
production pin. Test the actual **Open review** button and resulting native
browser, in addition to the component fixtures. This establishes the local entry
and window switching experience; it does not confirm the UX design or establish
production WebUI authentication, comment delivery or a configured chat model.

An additional authenticated trial must use the normal login UI and the actual
Studio chat input. Compare a model's version-bound record reads with an
independent read-only source query, inspect its actual project commands and rendered final
answer, and check the source digest. Read rendered Markdown through its shadow
root; outer `innerText` omits it. Keep credentials and trial transcripts outside
the repository. A live remote model in a local candidate Desktop build is still
not acceptance of the deployed WebUI or the official installed SDK.

### Integration coverage

Unit tests exercise populated legacy-session migration, multiple canonical
sessions without RDF payloads, authority conflicts, guarded legacy writes,
scoped command routing, error propagation and the real project CLI protocol. The
Sudograph `tools.accept_workspace_adapter` command additionally tests this real
TypeScript client against the real Python compiler on unrelated SQLite data.

The native adapter currently runs as the local desktop profile. It does not
establish cloud tenant authorization. Cloud connector UI, deployed WebUI review
launch, active-session context refresh and the Moss/WebUI provider remain
outstanding. Native authenticated paging, two real comment/edit/reply rounds,
automatic graph refresh and stable identity were accepted on isolated fixtures.
These native receipts do not establish production cloud comment delivery or
multi-user authorization. Remaining cloud boundaries must be accepted before claiming
the complete multi-user integration or enabling the adapter as a default UI.
