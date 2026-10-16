# External Agent task admission

Desktop and WebUI continue using the common organization directory and conversation components. Administration lives in Moss under 专属智能体 → 外部托管. Dify and Custom HTTP share the same user workflow.

The shared Moss client translates its IPC CreateExternalTask input to the experimental `task.sudo.dev/v1alpha1` SubmitTask envelope. The server creates authenticated TaskSpec/Resolution before any Provider request. A response timeout never causes a second POST with a legacy shape. Rejected policy decisions survive history and event snapshots; terminal empty output is distinct from waiting.

The contract owner is Moss. `packages/contracts/task.source.lock.json` pins exact Stack artifacts and their owner lock. Run `node scripts/check-task-contract.mjs --stack /path/to/stack` and `node --test scripts/check-task-contract.test.mjs`. Never edit generated TypeScript/Schema independently. Desktop bundling uses source aliases for both Task and External Provider contracts and is checked without prebuilt dist.

Roll out Moss before Work. The current profile accepts only approved synthetic text tasks. Custom HTTP is agent-http.sudo.dev/v1alpha1, not arbitrary OpenAI/LangGraph/Coze endpoints. Local HTTP tests do not count as a second real Provider.

Task contracts remain experimental while ADR-003/004 are Proposed. Local catalog principal and reviewed-source snapshot version do not constitute Nexus identity registration or immutable remote execution. Channel management, canonical Nexus Task persistence, production governance and native/private runtime deployment are separate phases. ResourceRef is a type-only import here; Moss performs complete validation with the exact-pinned owner implementation.
