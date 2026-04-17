# Phase 1 Spike — Openclaw exec internals

## Bundle layout

- Gateway entry: `~/.nexus/sudoclaw/cli/package/openclaw.mjs` (ESM).
- Large deps chunked under `~/.nexus/sudoclaw/cli/package/dist/`, loaded via static `import`.
- All modules are ES module format (not CJS). `Module.prototype.require` monkey-patch has no effect on static ESM imports; functions are bound at module load.

## Exec pipeline

1. `dist/exec-B5_AYfQG.js` — `runCommandWithTimeout(argv, {timeoutMs, cwd, env, ...})` at line 213. Spawns via `node:child_process.spawn`. Accumulates `stdout`/`stderr` via `on('data')` into plain strings.
2. `dist/pi-embedded-CbCYZxIb.js:72962` — `runExecProcess(opts)`. This is the tool-level runner. Also uses `spawn`. Sanitizes output with `sanitizeBinaryOutput` then `appendOutput`. Session carries `aggregated`, `tail`, `pendingStdout/stderr`, `maxOutputChars`, `truncated`.
3. `dist/pi-embedded-CbCYZxIb.js:74526` — `buildExecForegroundResult(params)` returns `{content: [{type:'text', text: <aggregated>|"(no output)"}], details: {status, exitCode, durationMs, aggregated, cwd}}`. This is the LLM-facing tool-result.

## Truncation levers

- `DEFAULT_MAX_OUTPUT = 200_000` chars. Env override: `PI_BASH_MAX_OUTPUT_CHARS` (clamped 1000–200000). Applied in `appendOutput` via `trimWithCap(aggregated + chunk, maxOutputChars)`.
- `DEFAULT_PENDING_OUTPUT_CHARS = 30_000` — streaming pending buffer cap.
- `TOOL_RESULT_MAX_CHARS = 8_000` at `pi-embedded-CbCYZxIb.js:172895` — hard-coded, no env. Applied in `sanitizeToolResult` → `truncateToolText`. Produces the `sanitizedResult` used for (a) WS `tool_call` event `data.result`, (b) `after_tool_call` hooks. The LLM's own tool-result return value is the **unsanitized** `result` (up to 200KB).

## WS event shape (sudowork → gateway subscription)

`emitAgentEvent({stream: 'tool', runId, sessionKey, data})` at `pi-embedded-CbCYZxIb.js:94691`.

On `phase === 'result'`, `data = {phase: 'result', name, toolCallId, meta, isError, result: sanitizedResult}`.

`meta` is the short description (e.g. `"run python, \`python -m ai_dev_browser.tools.page_screenshot ...\`"`). Built by `extendExecMeta` + `inferToolMetaFromArgs`. `result.content` carries the full text capped at 8 KB.

## sudowork-side observation

`src/process/task/OpenClawAgent.ts:789-858` reads `toolData.content` and `toolData.meta` but never `toolData.result.content`. That is why the UI currently shows the `meta` description — the full content from openclaw's `sanitizedResult` is arriving on the wire but is dropped by sudowork.

- A minimal UI fix would be to read `toolData.result` on `phase === 'result'`. But the text would be capped at 8 KB via `TOOL_RESULT_MAX_CHARS`.
- The sidechannel path (plan Phase 2) bypasses the 8 KB cap and gives us the raw bytes plus structured JSON and PNG metadata.

## Decision for Phase 3 LLM injection

Option A (patch `buildExecForegroundResult`) is infeasible: ESM static imports mean the symbol is already bound in every call site at module evaluation time; no `require`/globalThis lever.

Workable path: monkey-patch `child_process.spawn` itself. When an ai-dev-browser invocation is detected we tee `child.stdout` into the sidechannel but **do not modify** what openclaw reads — openclaw then aggregates the full bytes (well under 200 KB) into the LLM-facing result through its normal path. The 8 KB `TOOL_RESULT_MAX_CHARS` cap affects only the sanitized WS event (UI) — sudowork rewrites that path via sidechannel in Phase 2, so both UI and LLM receive the real text.

No env lever needs toggling.

## Summary

- Openclaw: ESM bundle. Exec runs through `spawn`. LLM gets 200 KB cap; WS/UI gets 8 KB sanitized cap. No plugin/MCP hook for result rewriting.
- Phase 3 Option A as written is not viable; falling back to spawn-level tee is sufficient because the 200 KB LLM cap is never hit for ai-dev-browser outputs (JSON under 4 KB).
- If a future ai-dev-browser tool prints > 200 KB, the spawn-level fallback would still need either stdout mutation (risky, breaks openclaw bookkeeping) or a post-install bundle patch. For now, not needed.

## Phase 3.2 decision

Option A (ESM serializer monkey-patch) rejected — the bundle statically imports `buildExecForegroundResult` and `sanitizeToolResult`, so the symbols are bound at module load with no interception point. `Module.prototype.require` only intercepts CJS requires; `globalThis` isn't used.

Option B (pipe-level tee with terminator marker) rejected as premature — the LLM already receives openclaw's `aggregated` (capped at 200 KB) via the normal exec tool-result path; ai-dev-browser outputs are well under 4 KB. The spawn-level capture in `AdbStdoutCapture` is non-invasive (adds a `'data'` listener, doesn't steal bytes from openclaw), so openclaw's aggregation continues to work and the LLM continues to see the real stdout.

Net: no additional LLM-side code is required. Goal 2 is satisfied by openclaw's existing 200 KB aggregation path, verified unmodified by the spawn interceptor. If Goal 2 ever regresses (e.g. openclaw shrinks the cap), escalate to (a) a post-install bundle patch in `SudoclawInstallService`, or (b) replacing the `child.stdout` stream with a controlled passthrough that reshapes output before openclaw reads it.
