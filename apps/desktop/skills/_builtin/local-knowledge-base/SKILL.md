---
name: local-knowledge-base
description: Search and read the user's local Sudowork knowledge bases. Use when a user asks questions that may be answered by local documents, local wiki, personal knowledge base, or imported knowledge spaces.
---

# Local Knowledge Base

Use the local wiki CLI in this skill to search Sudowork local knowledge bases. The CLI talks to the Sudowork desktop app on loopback only; it does not call a remote server.

## Commands

Run commands from this skill directory:

```bash
node scripts/wiki.mjs list
node scripts/wiki.mjs search "<query>"
node scripts/wiki.mjs search <spaceId> "<query>"
node scripts/wiki.mjs read <spaceId>
node scripts/wiki.mjs read --file chunk-001-topic.md <spaceId>
node scripts/wiki.mjs read --file original-document.pdf <spaceId>
node scripts/wiki.mjs read --doc <docId> <spaceId>
node scripts/wiki.mjs read --list <spaceId>
node scripts/wiki.mjs metadata <spaceId>
```

## Workflow

1. Run `node scripts/wiki.mjs search "<keywords>"` first. This searches all available local knowledge spaces, including imported spaces that have parsed documents but have not built Wiki chunks yet.
2. If you need to narrow scope, run `node scripts/wiki.mjs list`, pick a `spaceId`, then run `node scripts/wiki.mjs search <spaceId> "<keywords>"`.
3. If a result includes `docId`, read the exact parsed document with `node scripts/wiki.mjs read --doc <docId> <spaceId>`. This avoids ambiguity when multiple imported files share the same name.
4. If a result does not include `docId`, read the full file with `node scripts/wiki.mjs read --file <file> <spaceId>`. The file can be either a Wiki chunk file or an original document name returned by search.
5. Use `node scripts/wiki.mjs read <spaceId>` only for broad questions where you need the space overview.
6. Answer from the retrieved content and cite the `local-kb://...` source printed by search.

## Rules

- Do not invent local knowledge base content. If search returns no result, say that no relevant local knowledge base content was found.
- Do not read the raw SQLite database or local knowledge base directories directly. Use `node scripts/wiki.mjs`.
- Prefer global `search "<query>"` before `read`. Use `read` without `--file` only when the question is broad and you need the overview.
- Keep process narration out of the final answer; answer directly once you have enough evidence.
