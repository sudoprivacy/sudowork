import type {
  IBidProjectAiSectionResult,
  IBidProjectAssetHit,
  IBidProjectAssistantContext,
  IBidProjectCitationItem,
  IBidProjectDetail,
  IBidProjectEntity,
  IBidProjectFactRecord,
  IBidProjectReviewIssueRecord,
  IBidProjectSectionRecord,
  IBidProjectSourceRecord,
  IBidProjectVersionRecord,
  TBidProjectFactStatus,
  TBidProjectSourceOrigin,
} from '@common/bid-projects/types';

export type IBidProjectFactItem = IBidProjectFactRecord;

export type IBidProjectSourceItem = IBidProjectSourceRecord;

export type IBidProjectSectionItem = IBidProjectSectionRecord;

export type IBidProjectComplianceIssue = IBidProjectReviewIssueRecord;

export type IBidProjectVersionItem = IBidProjectVersionRecord;

export interface IBidProjectAnalysisResult {
  projectType: string;
  industry: string;
  recommendedMethod: string;
  riskHints: string[];
  detectedFields: Array<{ label: string; value: string }>;
  assetHits: IBidProjectAssetHit[];
  sourceOrigins: TBidProjectSourceOrigin[];
}

export interface IBidProjectClauseGroup {
  title: string;
  clauses: string[];
}

export interface IBidProjectDetectedFieldItem {
  label: string;
  value: string;
}

export interface IBidProjectFileItem {
  id: string;
  name: string;
  path?: string;
  size: number;
  type: string;
  origin?: TBidProjectSourceOrigin;
}

export interface IBidProjectDraft {
  id: string;
  name: string;
  company: string;
  budget: string;
  projectType: string;
  target: string;
  duration: string;
  procurementMethod: string;
  remark: string;
  status: string;
  version: string;
  updatedAt: number;
  files: IBidProjectFileItem[];
  facts: IBidProjectFactItem[];
  analysis: IBidProjectAnalysisResult;
  templateOptions: string[];
  selectedTemplate: string;
  clauseGroups: IBidProjectClauseGroup[];
  sections: IBidProjectSectionItem[];
  detectedFields: IBidProjectDetectedFieldItem[];
  sourceSummaries: string[];
  pendingItems: string[];
  markdown: string;
  complianceIssues: IBidProjectComplianceIssue[];
  versions: IBidProjectVersionItem[];
  assistantContext: IBidProjectAssistantContext;
  sourceOrigins: TBidProjectSourceOrigin[];
  assetHits: IBidProjectAssetHit[];
  citations: IBidProjectCitationItem[];
}

export interface IBidProjectDetailView extends IBidProjectDraft {
  sources: IBidProjectSourceItem[];
}

export interface IBidProjectAiGenerateViewResult {
  detail: IBidProjectDetailView;
  generatedSections: IBidProjectAiSectionResult[];
}

export interface IBidProjectFactFieldOption {
  label: string;
  value: string;
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
  files: IBidProjectFileItem[];
}

export type { IBidProjectAssetHit, IBidProjectAssistantContext, IBidProjectCitationItem, IBidProjectDetail, IBidProjectEntity, TBidProjectFactStatus };
