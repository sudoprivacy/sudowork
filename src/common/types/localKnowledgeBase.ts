export type LocalKbSourceMode = 'files' | 'directory' | 'mixed';
export type LocalKbBuildStatus = 'idle' | 'queued' | 'running' | 'ready' | 'failed';
export type LocalKbRetrievalMode = 'grep-only' | 'hybrid';
export type LocalKbDocumentSourceType = 'file' | 'directory';
export type LocalKbParseStatus = 'pending' | 'parsed' | 'failed';
export type LocalKbBuildJobMode = 'full' | 'incremental';
export type LocalKbBuildJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type LocalKbSearchHitSource = 'grep' | 'vec' | 'both';
export type LocalKbInstallPhase = 'downloading' | 'extracting' | 'verifying' | 'cleanup';

export interface ILocalKbCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ILocalKbSpace {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  sourceMode: LocalKbSourceMode;
  rootPath: string | null;
  buildStatus: LocalKbBuildStatus;
  retrievalMode: LocalKbRetrievalMode;
  lastBuiltAt: number | null;
  lastBuildError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ILocalKbDocument {
  id: string;
  spaceId: string;
  fileName: string;
  relativePath: string | null;
  absolutePath: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  sourceType: LocalKbDocumentSourceType;
  parseStatus: LocalKbParseStatus;
  parseError: string | null;
  lastIndexedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ILocalKbBuildJob {
  id: string;
  spaceId: string;
  mode: LocalKbBuildJobMode;
  status: LocalKbBuildJobStatus;
  progress: number;
  currentStep: string | null;
  errorMessage: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

export interface ILocalKbDependencyStatus {
  scode: {
    installed: boolean;
    path?: string;
  };
  localLlm: {
    available: boolean;
    detail?: string;
  };
  libreOffice: {
    installed: boolean;
    path?: string;
    version?: string;
  };
  embeddingModel: {
    installed: boolean;
    modelId: string;
    path: string;
  };
  vectorRuntime: {
    available: boolean;
    detail?: string;
  };
  poppler: {
    pdftotext: boolean;
    pdfimages: boolean;
  };
}

export interface ILocalKbInstallProgress {
  phase: LocalKbInstallPhase;
  percent?: number;
}

export interface ILocalKbInstallEmbeddingModelInput {
  downloadUrl?: string;
}

export interface ILocalKbSearchHit {
  spaceId: string;
  file: string;
  docId?: string;
  title: string;
  lineNo: number;
  text: string;
  score: number;
  source: LocalKbSearchHitSource;
}

export interface ILocalKbSearchResult {
  mode: LocalKbRetrievalMode;
  hits: ILocalKbSearchHit[];
  tookMs: number;
  spaceIds: string[];
  modelId?: string;
}

export interface ILocalKbCreateCategoryInput {
  name: string;
  description?: string | null;
}

export interface ILocalKbCreateSpaceInput {
  categoryId?: string | null;
  name: string;
  description?: string | null;
  sourceMode?: LocalKbSourceMode;
}

export interface ILocalKbUpdateSpaceInput {
  categoryId?: string | null;
  name?: string;
  description?: string | null;
}

export interface ILocalKbAddFilesInput {
  spaceId: string;
  filePaths: string[];
}

export interface ILocalKbSetDirectoryInput {
  spaceId: string;
  directoryPath: string;
}
