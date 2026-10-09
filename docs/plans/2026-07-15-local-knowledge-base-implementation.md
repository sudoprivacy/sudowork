# Local Knowledge Base Implementation Plan

## Goal

Add a personal local knowledge base to the Sudowork desktop client without changing the existing remote knowledge/RAG flow or reusing Moss runtime directories.

The local implementation should follow Moss's proven wiki pattern:

- parse local documents on the client machine,
- build wiki-like markdown output with the local scode agent,
- store generated wiki files and vector sidecars on local disk,
- support grep-only fallback when vector dependencies are unavailable,
- expose management UI in the main Sudowork interface.

## Reference Points

Moss implementation to use as design reference:

- `src/server/documentStore.ts`
- `src/channels/gateway/WikiJobExecutor.ts`
- `src/server/sources/docParsers.ts`
- `src/server/wikiIndex/build.ts`
- `src/server/wikiIndex/chunkSplitter.ts`
- `src/server/wikiIndex/embedder.ts`
- `src/server/wikiIndex/query.ts`
- `admin/src/pages/document-center-page.tsx`
- `admin/lib/api/document-center.ts`
- `assistants/wiki-builder/wiki-builder.md`

Sudowork implementation areas:

- `src/process/services/local-kb/*`
- `src/process/services/knowledge/KnowledgeRetrievalService.ts`
- `src/process/database/*`
- `src/common/ipcBridge.ts`
- `src/process/bridge/*`
- `src/renderer/pages/local-knowledge-base/*`
- `src/renderer/router.tsx`
- main sidebar/layout entry
- bid-project integration in `BidProjectService`

## Local Storage Layout

Use Sudowork's own local namespace. Do not write to `~/.moss`.

```text
~/.nexus/sudowork/local-kb/
  docs/
    <docId>/
      original/<filename>
      extracted/<docId>.md
      meta.json
  spaces/
    <spaceId>/
      SPACE.md
      chunk-001-<topic>.md
      chunk-002-<topic>.md
      images/
      _sudowork_images.md
      _sudowork_meta.json
      _sudowork_index.bin
      _sudowork_index.jsonl
  models/
    <modelId>/...
  .stage/
    <spaceId>.<jobId>/
```

## Dependency Strategy

Small dependencies are bundled with the app. Large or brittle dependencies are installed on demand using a flow similar to the existing LibreOffice service.

### Bundled Dependencies

- `mammoth` for docx parsing. Already present.
- `jszip` for OOXML image extraction. Already present.
- `sharp` for image operations. Already present.
- `pdf-parse` for PDF text extraction. Add as a small npm dependency.

### Existing Installable Runtime

- LibreOffice / `soffice`
  - Reuse `LibreOfficeService`.
  - Required only for fallback conversion of `.doc`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`, `.rtf`.
  - Missing LibreOffice must not block `.md`, `.txt`, `.docx`, or PDF text parsing.

### New Installable Large Dependencies

- Embedding model, default `Xenova/multilingual-e5-small`.
  - Store under `~/.nexus/sudowork/local-kb/models/`.
  - Download online through a new `EmbeddingModelService`.
  - Download the COS-hosted model archive from `model/Xenova.zip`.
  - Do not expose a client-side local archive upload/install entry.
  - Extracted model directory must resolve to `Xenova/multilingual-e5-small/`.
  - Required files: `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`, `onnx/model_quantized.onnx`.
  - Missing model means grep-only mode.

- Poppler tools.
  - `pdftotext` and `pdfimages`.
  - Make this optional and later-phase.
  - Missing Poppler means PDF image extraction is skipped; PDF text still uses `pdf-parse`.

### Native Runtime Risk

- `@xenova/transformers` and `onnxruntime-node` are required for local vector search.
- `onnxruntime-node` must be verified across Electron package targets.
- If loading fails, mark vector retrieval unavailable for this process and keep grep-only retrieval working.

## Data Model

Add local-only tables in the main-process database.

### `local_kb_categories`

Used by the main UI to organize knowledge spaces.

- `id`
- `name`
- `description`
- `sort_order`
- `created_at`
- `updated_at`

### `local_kb_spaces`

- `id`
- `category_id`
- `name`
- `description`
- `source_mode` (`files` | `directory` | `mixed`)
- `root_path`
- `build_status` (`idle` | `queued` | `running` | `ready` | `failed`)
- `retrieval_mode` (`grep-only` | `hybrid`)
- `last_built_at`
- `last_build_error`
- `created_at`
- `updated_at`

### `local_kb_documents`

- `id`
- `space_id`
- `file_name`
- `relative_path`
- `absolute_path`
- `mime_type`
- `size_bytes`
- `content_hash`
- `source_type` (`file` | `directory`)
- `parse_status` (`pending` | `parsed` | `failed`)
- `parse_error`
- `last_indexed_at`
- `created_at`
- `updated_at`

### `local_kb_build_jobs`

- `id`
- `space_id`
- `mode` (`full` | `incremental`)
- `status` (`queued` | `running` | `success` | `failed` | `cancelled`)
- `progress`
- `current_step`
- `error_message`
- `started_at`
- `finished_at`
- `created_at`

### `local_kb_query_logs` Optional

- `id`
- `space_id`
- `query`
- `mode`
- `hit_count`
- `created_at`

## Main UI Requirements

Add a first-class Local Knowledge Base page in the Sudowork main interface.

Reference Moss AdminHub's Document Center, adapted for a desktop client:

- left side: category/space tree,
- right side: selected category or space detail,
- document list,
- wiki build task controls,
- task history and current progress,
- local dependency status indicators.

### Page Capabilities

- create, rename, delete categories,
- create knowledge space under a category,
- select local files,
- select a local directory,
- show imported documents,
- show parse status for each document,
- trigger wiki build,
- show current build task with progress/current step,
- show build job history,
- show last build error,
- show retrieval mode: `grep-only` or `hybrid`,
- run a test search against the selected space,
- show dependency status:
  - scode agent,
  - local LLM availability,
  - LibreOffice,
  - embedding model,
  - vector runtime,
  - optional Poppler.

### UI Entry Points

- Add router entry for local knowledge base.
- Add sidebar/menu item.
- Add dialogs:
  - create category,
  - create/edit space,
  - select files,
  - select directory,
  - build task detail,
  - dependency install status.

## Build Pipeline

The local build should preserve Moss's staging and rollback behavior.

```text
queue build job
  -> create .stage/<spaceId>.<jobId>
  -> copy/parse source docs into input/
  -> run local scode agent with wiki-builder prompt
  -> validate SPACE.md and chunk files
  -> best-effort vector index build
  -> write _sudowork_meta.json
  -> atomic publish to spaces/<spaceId>
  -> update job and space status
```

Use the same conceptual split as Moss:

- scode agent generates wiki chunks,
- programmatic splitter generates vector passages,
- embedding model builds vector sidecars.

## Search Pipeline

Implement local search in phases.

### Grep-only

- Search `SPACE.md` and `chunk-*.md`.
- Return line-level matches.
- This is the mandatory baseline.

### Hybrid

- Load `_sudowork_index.bin` and `_sudowork_index.jsonl`.
- Embed query locally.
- Run brute-force cosine topK.
- Fuse grep and vector hits with RRF.
- If anything fails, return grep-only results.

## IPC and WebUI API

Expose local KB through the same main-process service layer.

### IPC Group

Add `ipcBridge.localKnowledgeBase`:

- `listCategories`
- `createCategory`
- `updateCategory`
- `deleteCategory`
- `listSpaces`
- `createSpace`
- `updateSpace`
- `deleteSpace`
- `addFiles`
- `setDirectory`
- `queueBuild`
- `getBuildStatus`
- `listBuildJobs`
- `search`
- `getDependencyStatus`
- `installEmbeddingModel`

### WebUI API

Add equivalent local API routes when WebUI is running:

- `GET /api/v1/local-kb/categories`
- `POST /api/v1/local-kb/categories`
- `GET /api/v1/local-kb/spaces`
- `POST /api/v1/local-kb/spaces`
- `POST /api/v1/local-kb/spaces/:id/files`
- `POST /api/v1/local-kb/spaces/:id/directory`
- `POST /api/v1/local-kb/spaces/:id/build`
- `GET /api/v1/local-kb/spaces/:id/build-status`
- `GET /api/v1/local-kb/spaces/:id/build-jobs`
- `GET /api/v1/local-kb/spaces/:id/search?q=...`

## Phased Delivery

### Phase 0: Branch, Schema, Paths

- Create feature branch.
- Add local KB path helpers.
- Add DB tables and migrations.
- Add service skeleton.
- No UI yet except hidden smoke IPC if needed.

### Phase 1: Management UI Skeleton

- Add Local Knowledge Base page.
- Add sidebar entry and route.
- Implement categories and spaces CRUD.
- Implement file/directory selection UI.
- Show dependency status panel.

This phase is included early because the feature is product-facing and needs Moss-like management UX from the start.

### Phase 2: Document Import and Parsing

- Store selected files/directories in `docs/`.
- Parse `.md`, `.txt`, `.docx`, and `.pdf`.
- Use LibreOffice fallback for supported Office formats if available.
- Store parse status and errors per document.
- Show parsed/failed states in the UI.

### Phase 3: Local scode Wiki Build

- Add `LocalKnowledgeBuildExecutor`.
- Queue and run build jobs.
- Run scode agent in the staging directory.
- Use wiki-builder prompt adapted to output `SPACE.md` and `_sudowork_*`.
- Show live job progress in UI.
- Publish atomically on success.

### Phase 4: Grep Search

- Implement grep search.
- Add test search panel.
- Add IPC/WebUI search APIs.
- Mark spaces as usable in `grep-only` mode.

### Phase 5: Embedding Model Installer

- Add `EmbeddingModelService`.
- Detect installed model.
- Online download and install under local KB `models/`.
- Support local archive import.
- Expose progress events and install status.

### Phase 6: Vector Sidecar and Hybrid Search

- Add embedder singleton.
- Add chunk splitter and vector build.
- Write `_sudowork_index.bin/jsonl`.
- Add RRF fusion.
- UI shows `hybrid` when vector sidecar is usable.
- Missing or failed vector runtime falls back to grep-only.

### Phase 7: Knowledge Retrieval Integration

- Add `KnowledgeRetrievalService`.
- Merge remote RAG and local KB results.
- Preserve source labels.
- Integrate first with bid-project analysis/editor.
- Later integrate with general assistant context.

### Phase 8: Optional Image and Poppler Enhancements

- Add optional Poppler installer if needed.
- Extract PDF images with `pdfimages`.
- Generate `_sudowork_images.md` only when a vision-capable local model is available.
- Never fabricate image details when vision is unavailable.

## Verification

Minimum end-to-end checks:

- create a category,
- create a space,
- add local files,
- run parse,
- queue a build,
- verify `SPACE.md`, `chunk-*.md`, `_sudowork_meta.json`,
- search in grep-only mode,
- install embedding model,
- rebuild vector sidecars,
- search in hybrid mode,
- verify bid-project retrieval still works with existing remote knowledge.

Required project checks after code changes:

- `bunx tsc --noEmit`
- lint only changed TS/TSX files with `bunx eslint <path> --fix`
- targeted unit tests for parser, query, RRF, and build state transitions
