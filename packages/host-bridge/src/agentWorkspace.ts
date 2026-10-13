import { loginReturnPath, parseAgentWorkspacePath } from '@sudowork/common/loginReturnPath';

let completedWorkspace: string | undefined;
let generation = 0;
let pendingWorkspace: { key: string; task: Promise<void>; controller: AbortController } | undefined;

/** A fresh login must verify the handoff again under its new cookie identity. */
export function resetWebAgentWorkspace(): void {
  generation += 1;
  pendingWorkspace?.controller.abort();
  completedWorkspace = undefined;
  pendingWorkspace = undefined;
}

/** Verify the Agent grant and organization before the shared renderer loads private data. */
export async function prepareWebAgentWorkspace(): Promise<void> {
  if (typeof window === 'undefined') return;
  const route = window.location.hash.slice(1);
  const target = parseAgentWorkspacePath(route) ?? (route === '/login' ? parseAgentWorkspacePath(loginReturnPath(window.history.state?.usr)) : null);
  if (!target?.orgId) return;
  const key = `${target.orgId}:${target.sessionId}`;
  if (completedWorkspace === key) return;
  if (pendingWorkspace?.key === key) return pendingWorkspace.task;
  const controller = new AbortController();
  const currentGeneration = generation;
  const task = (async () => {
    const response = await fetch('/api/auth/agent-workspace', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
      signal: controller.signal,
    });
    // Login restores the same bounded return route and repeats this check.
    if (response.status === 401) return;
    if (!response.ok) throw new Error('Agent workspace access was rejected');
    if (generation === currentGeneration) completedWorkspace = key;
  })();
  pendingWorkspace = { key, task, controller };
  try {
    await task;
  } finally {
    if (pendingWorkspace?.task === task) pendingWorkspace = undefined;
  }
}
