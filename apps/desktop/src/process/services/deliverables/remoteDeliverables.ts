import type { MossWorkspaceNode } from '@sudowork/host-bridge/ipcBridge';
import { extractExtension } from '@sudowork/common/generatedFiles';
import type { GeneratedFileEntry } from '@sudowork/common/generatedFiles';

export type RemoteWorkspaceSnapshot = Map<string, MossWorkspaceNode>;

/** Read the remote tree, including directories whose children are loaded lazily. */
export async function readRemoteWorkspaceSnapshot(api: { getSessionWorkspaceTree: (id: string, params?: { path?: string }) => Promise<MossWorkspaceNode> }, sessionId: string): Promise<RemoteWorkspaceSnapshot> {
  // This optional index must not indefinitely delay sending the next prompt.
  const deadline = Date.now() + 5000;
  const fetchTree = async (path?: string): Promise<MossWorkspaceNode> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Remote workspace snapshot timed out');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        api.getSessionWorkspaceTree(sessionId, path === undefined ? undefined : { path }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Remote workspace snapshot timed out')), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const files: RemoteWorkspaceSnapshot = new Map();
  const visited = new Set<string>();
  const root = await fetchTree();
  const visit = async (node: MossWorkspaceNode): Promise<void> => {
    const relativePath = node.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (relativePath.split('/').some((part) => part.startsWith('.') || ['node_modules', '__pycache__', 'venv'].includes(part))) return;
    if (node.isFile) {
      if (relativePath && !relativePath.includes('\0')) files.set(relativePath, node);
      return;
    }
    if (visited.has(relativePath)) return;
    visited.add(relativePath);
    const children = node.children ?? (await fetchTree(relativePath)).children ?? [];
    for (const child of children) await visit(child);
  };
  await visit(root);
  return files;
}

/** Only files created or changed after attachments were uploaded are outputs. */
export function diffRemoteDeliverables(before: RemoteWorkspaceSnapshot, after: RemoteWorkspaceSnapshot, createdAt: number): GeneratedFileEntry[] {
  const entries: GeneratedFileEntry[] = [];
  for (const [relativePath, file] of after) {
    const previous = before.get(relativePath);
    if (previous && previous.mtime === file.mtime && previous.size === file.size) continue;
    entries.push({ path: file.fullPath, relativePath, ext: extractExtension(relativePath), kind: previous ? 'edit' : 'create', size: file.size, createdAt });
  }
  return entries;
}
