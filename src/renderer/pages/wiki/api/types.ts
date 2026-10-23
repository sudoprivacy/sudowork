/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types mirroring the moss knowledge API (Document Center v2 + SudoWork private
 * spaces). Records are camelCase; request bodies and wrapper keys are snake_case.
 */

export type KnowledgeScope = 'tenant' | 'private';

/** null = everyone; department_ids / user_ids narrow it. The owner is always included. */
export type VisibleTo = {
  department_ids?: string[] | null;
  user_ids?: string[] | null;
} | null;

export interface DocumentTreeNode {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  scope?: KnowledgeScope;
  ownerId?: string;
}

export interface DocumentRecord {
  id: string;
  orgId: string;
  nodeId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: number;
  scope?: KnowledgeScope;
  ownerId?: string;
}

export type WikiBuildStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface WikiRecord {
  id: string;
  orgId: string;
  nodeId: string | null;
  name: string;
  description: string | null;
  buildStatus: WikiBuildStatus;
  sourceDocumentIds: string[];
  lastBuiltAt: number | null;
  lastBuildError: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  sourceMode: 'files' | 'dir';
  sourceNodeId: string | null;
  sourceNodeIds: string[];
  sourceExcludeNodeIds: string[];
  autoRebuild: boolean;
  needsRebuild?: boolean;
  hasBuilt?: boolean;
  scope?: KnowledgeScope;
  ownerId?: string;
  visibleTo?: VisibleTo;
  enabled?: boolean;
  canManage?: boolean;
  canAdminister?: boolean;
  usable?: boolean;
}

export type WikiBuildJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface WikiBuildJob {
  id: string;
  wikiId: string;
  status: WikiBuildJobStatus;
  progress: number;
  currentStep: string | null;
  errorMessage: string | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface WikiBuildStatusResponse {
  wiki_build_status: WikiBuildStatus;
  last_built_at: number | null;
  last_build_error: string | null;
  latest_job: WikiBuildJob | null;
}

export interface UsableWiki {
  id: string;
  name: string;
  description: string | null;
  scope: KnowledgeScope;
  owner_id: string;
  is_owner: boolean;
  build_status: WikiBuildStatus;
  has_built: boolean;
  updated_at: number;
}

export interface PrivateTree {
  root_id: string;
  nodes: DocumentTreeNode[];
  usage_bytes: number;
  quota_bytes: number;
}

export interface OrgDirectory {
  departments: Array<{ id: string; name: string; parentId: string | null }>;
  users: Array<{ id: string; name: string; displayName: string | null; departmentId: string | null }>;
}

export interface WikiSearchMatch {
  file: string;
  line_no: number;
  line: string;
}

export interface WikiInput {
  name: string;
  description?: string | null;
  source_mode: 'dir' | 'files';
  source_node_ids?: string[];
  source_document_ids?: string[];
  source_exclude_node_ids?: string[];
  visible_to?: VisibleTo;
  auto_rebuild?: boolean;
}

export interface FolderUploadFile {
  relative_path: string;
  mime_type?: string;
  content_base64: string;
}
