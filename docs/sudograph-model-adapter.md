# Sudograph model adapter: first host slice

This implementation connects the existing native conversation/MCP machinery to
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
imports, legacy MCP tools and restore paths. No empty RDF workspace is created.
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
workspace identity, title, opaque model reference, authorized SQLite source,
namespace, operation ID and locale. `SudographModelClient.registerSource` invokes
the private registrar, forces live delivery with zero embedded rows and checks
the compiler's complete-scan receipt before binding project authority. A failed
scan creates no project and no empty RDF snapshot. Retrying the same registration
recovers its durable receipt, including after a lost response between model
creation and host project binding. A different registration cannot rebind the
model. The existing lower-level `registerSudographProject` remains available for
deployment tooling that already owns a registered canonical store.

There is no agent tool for choosing source paths, changing authority or
registering a different source. Missing configuration fails explicitly, without
RDF fallback. The native library now connects SQLite through the shared form and
typed IPC providers. Pinned runtime packaging remains subsequent work. Users
are not expected to run operator commands during normal modelling.
Complete registration currently supports
SQLite only, independent of legacy connector probe support for other providers.

`SudographModelClient` launches a private JSON-lines worker with deployment-owned
paths. The model writer checks source pins, namespace, identity reservations,
definition versions, base revisions and operation IDs. Graph, context and model
advance together only after compilation succeeds. Ordinary model edits do not
use the optional GitLab human-review publisher and do not change source data.

The existing scoped builder bridge exposes four canonical tools:

- `sudograph_model_contract`
- `sudograph_model_apply`
- `sudograph_context`
- `sudograph_context_read`

Tool discovery uses the persisted project authority. Requests require a scoped
builder token and matching project registration on the server. A global legacy
token cannot call the canonical routes. Compiler conflict codes and recovery
details survive both HTTP and MCP stdio. Successful edits emit
`ontology.model-changed` with the model revision and context digest.

Conversation creation and restoration load the current compiled context instead
of the RDF builder workflow prompt for canonical projects. The renderer no longer
duplicates that host-owned prompt selection.

## Native source intake and project navigation

Configured desktop deployments offer **Connect database** in the existing
library. The host derives model reference, project identity and namespace from
the registration operation. Intake accepts a read-only SQLite connector and
refuses caller-selected bindings, credentials, unsupported providers and relative
paths. Unconfigured deployments retain legacy creation; canonical projects never
fall back to RDF.

The form retains only an opaque operation ID and locale across reloads, without
persisting source paths or credentials in browser storage. Resuming first checks
the host project registry. A completed registration opens the existing project
without rescanning. If no project exists, selecting the source again retries the
same compiler operation, including recovery between model publication and host
binding. The retry handle is cleared after success.

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
read. Cookie paths are scoped to their random review reference; knowing the URL
does not grant access. Sessions expire after 30 minutes and can be revoked or
closed. Host/Origin checks, exact resource matching, bounded JSON and `no-store`
responses apply. The registry selects the model; there is no second editable
catalogue, anonymous fallback or export grant. The Python private read worker
reuses Sudograph's checked renderer and version-bound record reader.

The canonical Studio conversation exposes **Open review** after its persisted
conversation is ready. The renderer sends only project and conversation IDs.
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

### Integration coverage

Unit tests exercise populated legacy-session migration, multiple canonical
sessions without RDF payloads, authority conflicts, guarded legacy writes,
scoped tool routing, error propagation and the real MCP stdio protocol. The
Sudograph `tools.accept_workspace_adapter` command additionally tests this real
TypeScript client against the real Python compiler on unrelated SQLite data.

The native adapter currently runs as the local desktop profile. It does not
establish cloud tenant authorization. Cloud connector UI, deployed WebUI review
launch and automatic page refresh,
active-session context refresh, ShareOne event delivery, revocation and the
Moss/WebUI provider remain outstanding. These must be accepted before claiming
the complete multi-user integration or enabling the adapter as a default UI.
