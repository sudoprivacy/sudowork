export type TBidProjectStatus = 'draft' | 'analyzing' | 'awaiting_confirmation' | 'planning' | 'generating' | 'editing' | 'generated' | 'reviewing' | 'exported';

export type TBidProjectSourceParseStatus = 'pending' | 'success' | 'failed' | 'skipped';

export type TBidProjectFactStatus = 'pending' | 'confirmed' | 'rejected';

export type TBidProjectSourceOrigin = 'upload' | 'master-data' | 'procurement-plan' | 'historical-project' | 'manual';

export type TBidProjectAssetKind = 'template' | 'clause' | 'industry-knowledge' | 'review-rule' | 'regulation' | 'historical-project';

export type TBidProjectFactFieldName = 'name' | 'company' | 'budget' | 'projectType' | 'target' | 'duration' | 'procurementMethod';

export type TBidProjectAiSectionKey = 'notice' | 'instructions' | 'contract' | 'technical' | 'responseFormats';

export type TBidProjectSectionStatus = 'empty' | 'generated' | 'edited' | 'locked' | 'needs_review' | 'needs_regeneration';

export type TBidProjectReviewSeverity = 'high' | 'medium' | 'low';

export type TBidProjectReviewIssueStatus = 'open' | 'applied' | 'ignored';

export interface IBidProjectAiSectionResult {
  sectionKey: TBidProjectAiSectionKey;
  title: string;
  markdown: string;
  fallbackUsed: boolean;
  mode?: 'agent-chat' | 'workflow' | 'rag-only';
  elapsedMs?: number;
  citations?: IBidProjectCitationItem[];
  assetHits?: IBidProjectAssetHit[];
}

export interface IBidProjectAiGenerateInput {
  projectId: string;
  sectionKeys: TBidProjectAiSectionKey[];
  accessToken?: string;
  assistantId?: string;
}

export interface IBidProjectAiGenerateResult {
  detail: IBidProjectDetail;
  generatedSections: IBidProjectAiSectionResult[];
}

export interface IBidProjectSourceFileInput {
  id: string;
  name: string;
  path?: string;
  size: number;
  type: string;
  origin?: TBidProjectSourceOrigin;
}

export interface IBidProjectCreateInput {
  name: string;
  company: string;
  budget: string;
  projectType: string;
  target: string;
  duration: string;
  procurementMethod: string;
  remark: string;
  files: IBidProjectSourceFileInput[];
}

export interface IBidProjectUpdateInput {
  name?: string;
  company?: string;
  budget?: string;
  projectType?: string;
  target?: string;
  duration?: string;
  procurementMethod?: string;
  remark?: string;
  markdown?: string;
  status?: TBidProjectStatus;
  selectedTemplate?: string;
  currentVersion?: string;
}

export interface IBidProjectEntity {
  id: string;
  name: string;
  company: string;
  budget: string;
  projectType: string;
  target: string;
  duration: string;
  procurementMethod: string;
  remark: string;
  status: TBidProjectStatus;
  selectedTemplate: string;
  currentDraftId?: string | null;
  currentVersion: string;
  createdAt: number;
  updatedAt: number;
}

export interface IBidProjectSourceRecord {
  id: string;
  projectId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
  parseStatus: TBidProjectSourceParseStatus;
  parseError?: string | null;
  extractedText?: string | null;
  summary?: string | null;
  origin: TBidProjectSourceOrigin;
  createdAt: number;
  updatedAt: number;
}

export interface IBidProjectFactRecord {
  id: string;
  projectId: string;
  fieldName: TBidProjectFactFieldName;
  candidateValue: string;
  confidence: number;
  sourceFileId?: string | null;
  sourceSnippet?: string | null;
  status: TBidProjectFactStatus;
  createdAt: number;
  updatedAt: number;
}

export interface IBidProjectDraftRecord {
  id: string;
  projectId: string;
  version: string;
  markdown: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface IBidProjectSectionRecord {
  id: string;
  projectId: string;
  draftId: string;
  sectionKey: TBidProjectAiSectionKey;
  sectionTitle: string;
  sortOrder: number;
  contentMarkdown: string;
  status: TBidProjectSectionStatus;
  isLocked: boolean;
  citations: IBidProjectCitationItem[];
  assetHits: IBidProjectAssetHit[];
  createdAt: number;
  updatedAt: number;
}

export interface IBidProjectReviewIssueRecord {
  id: string;
  projectId: string;
  draftId: string;
  sectionKey?: string | null;
  severity: TBidProjectReviewSeverity;
  title: string;
  detail: string;
  basis: string;
  fixSuggestion: string;
  status: TBidProjectReviewIssueStatus;
  citations: IBidProjectCitationItem[];
  assetHits: IBidProjectAssetHit[];
  createdAt: number;
  updatedAt: number;
}

export interface IBidProjectVersionRecord {
  id: string;
  projectId: string;
  draftId: string;
  version: string;
  source: 'system' | 'manual' | 'review-fix' | 'ai-rewrite';
  summary: string;
  createdAt: number;
}

export interface IBidProjectCitationItem {
  title: string;
  snippet?: string;
  sourceId?: string | null;
  sourceType?: 'file' | 'knowledge-base' | 'rule';
}

export interface IBidProjectAssetHit {
  assetKind: TBidProjectAssetKind;
  label: string;
  refId?: string | null;
}

export interface IBidProjectAssistantContext {
  currentSectionKey?: TBidProjectAiSectionKey;
  currentSectionTitle?: string;
  mode: 'section' | 'issue' | 'project';
  contextLabels: string[];
  sourceOrigins: TBidProjectSourceOrigin[];
  assetKinds: TBidProjectAssetKind[];
}

export interface IBidProjectDetail {
  project: IBidProjectEntity;
  sources: IBidProjectSourceRecord[];
  facts: IBidProjectFactRecord[];
  currentDraft: IBidProjectDraftRecord | null;
  sections: IBidProjectSectionRecord[];
  reviewIssues: IBidProjectReviewIssueRecord[];
  versions: IBidProjectVersionRecord[];
  assistantContext: IBidProjectAssistantContext;
}
