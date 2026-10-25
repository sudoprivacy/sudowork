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

## Acceptance boundary

Unit tests exercise populated legacy-session migration, multiple canonical
sessions without RDF payloads, authority conflicts, guarded legacy writes,
scoped tool routing, error propagation and the real MCP stdio protocol. The
Sudograph `tools.accept_workspace_adapter` command additionally tests this real
TypeScript client against the real Python compiler on unrelated SQLite data.

The native adapter currently runs as the local desktop profile. It does not
establish cloud tenant authorization. Cloud connector UI, authenticated standalone
review launch and page refresh,
active-session context refresh, ShareOne event delivery, revocation and the
Moss/WebUI provider remain outstanding. These must be accepted before claiming
the complete multi-user integration or enabling the adapter as a default UI.
