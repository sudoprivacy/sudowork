/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EnterpriseMcpClient } from '@/renderer/pages/settings/enterprise_mcps/api/client';
import type { DocumentRecord, DocumentTreeNode, FolderUploadFile, OrgDirectory, PrivateTree, UsableWiki, WikiBuildStatusResponse, WikiInput, WikiRecord, WikiSearchMatch } from './types';

const enc = encodeURIComponent;

/** Wiki file paths may contain sub-directories; encode each segment, keep the slashes. */
function encodePath(path: string): string {
  return path.split('/').map(enc).join('/');
}

export function createWikiApi(client: EnterpriseMcpClient) {
  return {
    // ---- Private space: folder tree ----
    getMyTree: () => client.request<PrivateTree>('/api/v1/me/documents/tree'),

    createNode: (input: { parent_id?: string; name: string; description?: string }) => client.request<DocumentTreeNode>('/api/v1/me/documents/nodes', { method: 'POST', body: input }),

    updateNode: (id: string, input: { name?: string; parent_id?: string; description?: string | null }) => client.request<DocumentTreeNode>(`/api/v1/me/documents/nodes/${enc(id)}`, { method: 'PATCH', body: input }),

    deleteNode: (id: string) => client.request<{ ok: boolean }>(`/api/v1/me/documents/nodes/${enc(id)}`, { method: 'DELETE' }),

    // ---- Private space: documents ----
    listDocuments: async (nodeId: string, isRecursive = false) => {
      const res = await client.request<{ documents: DocumentRecord[] }>(`/api/v1/me/documents/nodes/${enc(nodeId)}/documents`, { query: isRecursive ? { recursive: 1 } : undefined });
      return res.documents ?? [];
    },

    uploadDocument: (nodeId: string, input: { file_name: string; mime_type?: string; content_base64: string }) => client.request<DocumentRecord>(`/api/v1/me/documents/nodes/${enc(nodeId)}/documents`, { method: 'POST', body: input }),

    uploadFolder: (nodeId: string, input: { folder_name?: string; on_conflict?: 'replace' | 'skip'; files: FolderUploadFile[] }) => client.request<{ node_id: string; documents: DocumentRecord[]; skipped: number }>(`/api/v1/me/documents/nodes/${enc(nodeId)}/folder`, { method: 'POST', body: input }),

    deleteDocument: (docId: string) => client.request<{ ok: boolean }>(`/api/v1/me/documents/${enc(docId)}`, { method: 'DELETE' }),

    // ---- Private wikis ----
    listMyWikis: async () => {
      const res = await client.request<{ wikis: WikiRecord[] }>('/api/v1/me/wikis');
      return res.wikis ?? [];
    },

    createWiki: (input: WikiInput & { build?: boolean }) => client.request<WikiRecord & { build_job_id?: string }>('/api/v1/me/wikis', { method: 'POST', body: input }),

    updateWiki: (id: string, input: Partial<WikiInput>) => client.request<WikiRecord>(`/api/v1/me/wikis/${enc(id)}`, { method: 'PATCH', body: input }),

    deleteWiki: (id: string) => client.request<{ ok: boolean }>(`/api/v1/me/wikis/${enc(id)}`, { method: 'DELETE' }),

    setWikiEnabled: (id: string, isEnabled: boolean) => client.request<WikiRecord>(`/api/v1/me/wikis/${enc(id)}/enabled`, { method: 'PATCH', body: { enabled: isEnabled } }),

    buildWiki: (id: string) => client.request<{ job_id: string; wiki_id: string }>(`/api/v1/me/wikis/${enc(id)}/build`, { method: 'POST' }),

    getBuildStatus: (id: string) => client.request<WikiBuildStatusResponse>(`/api/v1/me/wikis/${enc(id)}/build-status`),

    cancelBuildJob: (jobId: string) => client.request<{ job_id: string; status: string }>(`/api/v1/me/wiki-build-jobs/${enc(jobId)}/cancel`, { method: 'POST' }),

    /** Server-sent build progress; `progress` and `done` events carry a WikiBuildStatusResponse. */
    subscribeBuildEvents: (id: string) => client.openEventStream(`/api/v1/me/wikis/${enc(id)}/build-events`),

    // ---- Wikis the user may use (tenant + shared + own) ----
    listUsableWikis: async () => {
      const res = await client.request<{ wikis: UsableWiki[] }>('/api/v1/wikis/usable');
      return res.wikis ?? [];
    },

    listWikiFiles: async (id: string) => {
      const res = await client.request<{ wiki_id: string; files: string[] }>(`/api/v1/agent/wikis/${enc(id)}/files`);
      return res.files ?? [];
    },

    readWikiFile: async (id: string, path: string) => {
      const res = await client.request<{ wiki_id: string; path: string; content: string }>(`/api/v1/agent/wikis/${enc(id)}/files/${encodePath(path)}`);
      return res.content ?? '';
    },

    searchWiki: async (id: string, query: string) => {
      const res = await client.request<{ wiki_id: string; query: string; matches: WikiSearchMatch[] }>(`/api/v1/agent/wikis/${enc(id)}/search`, { query: { q: query } });
      return res.matches ?? [];
    },

    getDirectory: () => client.request<OrgDirectory>('/api/v1/directory'),
  };
}

export type WikiApi = ReturnType<typeof createWikiApi>;
