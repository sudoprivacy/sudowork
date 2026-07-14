import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { parseOfficeAsync } from 'officeparser';
import { getDatabase } from '@process/database';
import { callGetEnhancement, callInvokeEnhancement, callStartEnhancementStream } from '@process/bridge/difyBridge';
import { readSudorouterCredentials } from '@process/bridge/imageGenerationBridge';
import { conversionService } from '@process/services/conversionService';
import { SCODE_CONFIG_PATH, SCODE_SETTINGS_PATH } from '@process/services/scode/scodePaths';
import { mainError } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/initStorage';
import { resolveSecret } from '@common/nexus/secret-cache';
import { safeExecFile } from '@process/utils/safeExec';
import type { TProviderWithModel } from '@common/storage';
import type {
  IBidProjectAiGenerateInput,
  IBidProjectAiGenerateResult,
  IBidProjectAiSectionResult,
  IBidProjectAssetHit,
  IBidProjectAssistantChatInput,
  IBidProjectAssistantChatResult,
  IBidProjectAssistantContext,
  IBidProjectCitationItem,
  IBidProjectCreateInput,
  IBidProjectDetail,
  IBidProjectDraftRecord,
  IBidProjectEntity,
  IBidProjectFactRecord,
  IBidProjectReviewIssueRecord,
  IBidProjectSectionRecord,
  IBidProjectSourceFileInput,
  IBidProjectSourceRecord,
  IBidProjectUpdateInput,
  IBidProjectVersionRecord,
  TBidProjectAiSectionKey,
  TBidProjectAssetKind,
  TBidProjectAssistantIntent,
  TBidProjectFactFieldName,
  TBidProjectFactStatus,
} from '@common/bid-projects/types';

const DEFAULT_TEMPLATE = '联通直接采购模板';
const DEFAULT_VERSION = 'V1.0';
const DEFAULT_MARKDOWN = '# 正在生成招标文件初稿\n\n请先完成材料解析与字段确认。\n';
const BID_PROJECT_AI_TIMEOUT_MS = 60000;
const BID_PROJECT_AI_MODEL_FALLBACK = 'claude-sonnet-4-6';
const BID_RAG_CONFIG_PATH = path.join(homedir(), '.nexus', '江招-rag', 'kb-ids.json');

export class BidProjectService {
  listProjects(): IBidProjectEntity[] {
    const db = getDatabase();
    return (db as unknown as { db: import('better-sqlite3').Database }).db.prepare(`SELECT * FROM bid_projects ORDER BY updated_at DESC`).all().map(mapProjectRow);
  }

  getProject(projectId: string): IBidProjectDetail | null {
    const db = (getDatabase() as unknown as { db: import('better-sqlite3').Database }).db;
    const projectRow = db.prepare(`SELECT * FROM bid_projects WHERE id = ?`).get(projectId);
    if (!projectRow) return null;

    const project = mapProjectRow(projectRow);
    const sources = db.prepare(`SELECT * FROM bid_project_sources WHERE project_id = ? ORDER BY created_at ASC`).all(projectId).map(mapSourceRow);
    const facts = db.prepare(`SELECT * FROM bid_project_facts WHERE project_id = ? ORDER BY created_at ASC`).all(projectId).map(mapFactRow);
    const currentDraft = db.prepare(`SELECT * FROM bid_project_drafts WHERE id = ?`).get((projectRow as any).current_draft_id);
    const draft = currentDraft ? mapDraftRow(currentDraft) : null;
    const sections = draft ? db.prepare(`SELECT * FROM bid_project_sections WHERE draft_id = ? ORDER BY sort_order ASC, created_at ASC`).all(draft.id).map(mapSectionRow) : [];
    const reviewIssues = draft ? db.prepare(`SELECT * FROM bid_project_review_issues WHERE draft_id = ? ORDER BY created_at ASC`).all(draft.id).map(mapReviewIssueRow) : [];
    const versions = db.prepare(`SELECT * FROM bid_project_versions WHERE project_id = ? ORDER BY created_at DESC`).all(projectId).map(mapVersionRow);

    return {
      project,
      sources,
      facts,
      currentDraft: draft,
      sections,
      reviewIssues,
      versions,
      assistantContext: buildAssistantContext({
        currentSectionKey: sections[0]?.sectionKey,
        currentSectionTitle: sections[0]?.sectionTitle,
        facts,
        sources,
      }),
    };
  }

  async createProject(input: IBidProjectCreateInput): Promise<IBidProjectDetail> {
    const db = (getDatabase() as unknown as { db: import('better-sqlite3').Database }).db;
    const now = Date.now();
    const projectId = `bid-${now}`;
    const draftId = `draft-${now}`;
    const versionId = `version-${now}`;

    const tx = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO bid_projects (
          id, name, company, budget, project_type, target, duration, procurement_method, remark,
          status, selected_template, current_draft_id, current_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(projectId, input.name, input.company, input.budget, input.projectType, input.target, input.duration, input.procurementMethod, input.remark, 'analyzing', DEFAULT_TEMPLATE, draftId, DEFAULT_VERSION, now, now);

      db.prepare(
        `
        INSERT INTO bid_project_drafts (id, project_id, version, markdown, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(draftId, projectId, DEFAULT_VERSION, DEFAULT_MARKDOWN, 'draft', now, now);

      db.prepare(
        `
        INSERT INTO bid_project_versions (id, project_id, draft_id, version, source, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(versionId, projectId, draftId, DEFAULT_VERSION, 'system', '创建项目并初始化草稿', now);

      const insertSource = db.prepare(`
        INSERT INTO bid_project_sources (
          id, project_id, file_name, file_path, mime_type, size, parse_status, parse_error, extracted_text, summary, origin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
      `);

      for (const file of input.files) {
        insertSource.run(file.id, projectId, file.name, file.path || '', file.type, file.size, file.path ? 'pending' : 'skipped', file.origin || 'upload', now, now);
      }
    });

    tx();
    console.log('[bid-projects] createProject inserted', { projectId, draftId, versionId, name: input.name, company: input.company, fileCount: input.files.length });
    void this.runInitialAnalysisInBackground(projectId);

    return {
      project: {
        id: projectId,
        name: input.name,
        company: input.company,
        budget: input.budget,
        projectType: input.projectType,
        target: input.target,
        duration: input.duration,
        procurementMethod: input.procurementMethod,
        remark: input.remark,
        status: 'analyzing',
        selectedTemplate: DEFAULT_TEMPLATE,
        currentDraftId: draftId,
        currentVersion: DEFAULT_VERSION,
        createdAt: now,
        updatedAt: now,
      },
      sources: input.files.map((file) => ({
        id: file.id,
        projectId,
        fileName: file.name,
        filePath: file.path || '',
        mimeType: file.type,
        size: file.size,
        parseStatus: file.path ? 'pending' : 'skipped',
        parseError: null,
        extractedText: null,
        summary: null,
        origin: file.origin || 'upload',
        createdAt: now,
        updatedAt: now,
      })),
      facts: [],
      currentDraft: {
        id: draftId,
        projectId,
        version: DEFAULT_VERSION,
        markdown: DEFAULT_MARKDOWN,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      },
      sections: [],
      reviewIssues: [],
      versions: [
        {
          id: versionId,
          projectId,
          draftId,
          version: DEFAULT_VERSION,
          source: 'system',
          summary: '创建项目并初始化草稿',
          createdAt: now,
        },
      ],
      assistantContext: {
        mode: 'project',
        contextLabels: [],
        sourceOrigins: input.files.map((file) => file.origin || 'upload'),
        assetKinds: [],
      },
    };
  }

  private async runInitialAnalysisInBackground(projectId: string): Promise<void> {
    try {
      await this.parseAllSources(projectId);
    } catch (error) {
      console.error('[bid-projects] background parseAllSources failed', error);
    }
    try {
      await this.generateDraft(projectId);
    } catch (error) {
      console.error('[bid-projects] background generateDraft failed', error);
    }
  }

  updateProject(projectId: string, updates: IBidProjectUpdateInput): IBidProjectDetail | null {
    const db = (getDatabase() as unknown as { db: import('better-sqlite3').Database }).db;
    const current = this.getProject(projectId);
    if (!current) return null;

    const next = {
      ...current.project,
      ...updates,
      updatedAt: Date.now(),
    };

    const tx = db.transaction(() => {
      db.prepare(
        `
        UPDATE bid_projects
        SET name = ?, company = ?, budget = ?, project_type = ?, target = ?, duration = ?, procurement_method = ?, remark = ?,
            status = ?, selected_template = ?, current_version = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(next.name, next.company, next.budget, next.projectType, next.target, next.duration, next.procurementMethod, next.remark, next.status, next.selectedTemplate, next.currentVersion, next.updatedAt, projectId);

      if (typeof updates.markdown === 'string' && current.project.currentDraftId) {
        db.prepare(
          `
          UPDATE bid_project_drafts
          SET markdown = ?, status = ?, updated_at = ?
          WHERE id = ?
        `
        ).run(updates.markdown, next.status || 'editing', next.updatedAt, current.project.currentDraftId);
      }
    });

    tx();
    return this.getProject(projectId);
  }

  async parseAllSources(projectId: string): Promise<IBidProjectDetail | null> {
    const db = (getDatabase() as unknown as { db: import('better-sqlite3').Database }).db;
    const detail = this.getProject(projectId);
    if (!detail) return null;

    const updateSource = db.prepare(`UPDATE bid_project_sources SET parse_status = ?, parse_error = ?, extracted_text = ?, summary = ?, updated_at = ? WHERE id = ?`);
    const deleteFacts = db.prepare(`DELETE FROM bid_project_facts WHERE project_id = ?`);
    const insertFact = db.prepare(`
      INSERT INTO bid_project_facts (
        id, project_id, field_name, candidate_value, confidence, source_file_id, source_snippet, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const facts: Array<{ fieldName: TBidProjectFactFieldName; value: string; confidence: number; sourceFileId: string; snippet: string }> = [];
    const now = Date.now();

    for (const source of detail.sources) {
      if (!source.filePath) {
        updateSource.run('skipped', 'missing file path', null, null, now, source.id);
        continue;
      }

      try {
        const extractedText = await extractSourceText({ id: source.id, name: source.fileName, path: source.filePath, size: source.size, type: source.mimeType });
        const summary = summarizeText(extractedText);
        updateSource.run('success', null, extractedText, summary, Date.now(), source.id);
        facts.push(...extractFactsFromText(projectId, source.id, extractedText));
      } catch (error) {
        mainError('BidProjectService', 'Failed to parse source:', error);
        updateSource.run('failed', error instanceof Error ? error.message : String(error), null, null, Date.now(), source.id);
      }
    }

    const tx = db.transaction(() => {
      deleteFacts.run(projectId);
      for (const fact of dedupeFacts(facts)) {
        insertFact.run(`fact-${projectId}-${fact.fieldName}-${simpleHash(fact.value)}-${simpleHash(fact.sourceFileId)}`, projectId, fact.fieldName, fact.value, fact.confidence, fact.sourceFileId, fact.snippet, 'pending', now, now);
      }
    });
    tx();

    const refreshed = this.getProject(projectId);
    const pendingFacts = refreshed?.facts.some((fact) => fact.status === 'pending');
    db.prepare(`UPDATE bid_projects SET status = ?, updated_at = ? WHERE id = ?`).run(pendingFacts ? 'awaiting_confirmation' : 'editing', Date.now(), projectId);
    return this.getProject(projectId);
  }

  confirmFact(factId: string): IBidProjectFactRecord | null {
    return this.updateFactStatus(factId, 'confirmed', true);
  }

  rejectFact(factId: string): IBidProjectFactRecord | null {
    return this.updateFactStatus(factId, 'rejected', false);
  }

  async generateDraft(projectId: string): Promise<IBidProjectDetail | null> {
    const db = (getDatabase() as unknown as { db: import('better-sqlite3').Database }).db;
    const detail = this.getProject(projectId);
    if (!detail || !detail.currentDraft || detail.facts.some((fact) => fact.status === 'pending')) return detail;

    const nextMarkdown = buildUnicomDirectProcurementMarkdown(detail);
    const now = Date.now();
    const sections = buildSectionRecords(projectId, detail.currentDraft.id, nextMarkdown, now);
    const reviewIssues = buildDefaultReviewIssues(projectId, detail.currentDraft.id, now);
    const versionId = `version-${detail.currentDraft.id}-${now}`;

    const tx = db.transaction(() => {
      db.prepare(`UPDATE bid_project_drafts SET markdown = ?, status = ?, updated_at = ? WHERE id = ?`).run(nextMarkdown, 'generated', now, detail.currentDraft!.id);
      db.prepare(`UPDATE bid_projects SET status = ?, selected_template = ?, updated_at = ? WHERE id = ?`).run('generated', DEFAULT_TEMPLATE, now, projectId);

      db.prepare(`DELETE FROM bid_project_sections WHERE draft_id = ?`).run(detail.currentDraft!.id);
      db.prepare(`DELETE FROM bid_project_review_issues WHERE draft_id = ?`).run(detail.currentDraft!.id);

      const insertSection = db.prepare(`
        INSERT INTO bid_project_sections (
          id, project_id, draft_id, section_key, section_title, sort_order, content_markdown, status, is_locked, citations_json, asset_hits_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const section of sections) {
        insertSection.run(
          section.id,
          section.projectId,
          section.draftId,
          section.sectionKey,
          section.sectionTitle,
          section.sortOrder,
          section.contentMarkdown,
          section.status,
          section.isLocked ? 1 : 0,
          JSON.stringify(section.citations),
          JSON.stringify(section.assetHits),
          section.createdAt,
          section.updatedAt
        );
      }

      const insertIssue = db.prepare(`
        INSERT INTO bid_project_review_issues (
          id, project_id, draft_id, section_key, severity, title, detail, basis, fix_suggestion, status, citations_json, asset_hits_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const issue of reviewIssues) {
        insertIssue.run(issue.id, issue.projectId, issue.draftId, issue.sectionKey || null, issue.severity, issue.title, issue.detail, issue.basis, issue.fixSuggestion, issue.status, JSON.stringify(issue.citations), JSON.stringify(issue.assetHits), issue.createdAt, issue.updatedAt);
      }

      db.prepare(
        `
        INSERT INTO bid_project_versions (id, project_id, draft_id, version, source, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(versionId, projectId, detail.currentDraft!.id, detail.project.currentVersion, 'system', '生成完整初稿', now);
    });

    tx();
    return this.getProject(projectId);
  }

  async generateAiSections(input: IBidProjectAiGenerateInput): Promise<IBidProjectAiGenerateResult | null> {
    const db = (getDatabase() as unknown as { db: import('better-sqlite3').Database }).db;
    const detail = this.getProject(input.projectId);
    if (!detail || !detail.currentDraft) return null;

    const sectionKeys = Array.from(new Set(input.sectionKeys || [])).filter(isSupportedAiSectionKey);
    if (sectionKeys.length === 0) {
      return {
        detail,
        generatedSections: [],
      };
    }

    const currentMarkdown = ensureBidProjectMarkdown(detail);
    const baseMarkdown = isPlaceholderDraftMarkdown(currentMarkdown) ? buildUnicomDirectProcurementMarkdown(detail) : currentMarkdown;
    let nextMarkdown = baseMarkdown;
    const generatedSections: IBidProjectAiSectionResult[] = [];

    for (const sectionKey of sectionKeys) {
      const fallbackMarkdown = getRuleSectionMarkdown(detail, sectionKey);
      const result = await generateBidProjectAiSection({
        accessToken: input.accessToken,
        assistantId: input.assistantId,
        detail,
        fallbackMarkdown,
        sectionKey,
      });
      generatedSections.push(result);
      nextMarkdown = replaceBidProjectSectionMarkdown(nextMarkdown, sectionKey, result.markdown);
    }

    const now = Date.now();
    const nextSections = buildSectionRecords(input.projectId, detail.currentDraft.id, nextMarkdown, now).map((section) => {
      const generated = generatedSections.find((item) => item.sectionKey === section.sectionKey);
      if (!generated) return section;
      return {
        ...section,
        contentMarkdown: generated.markdown,
        citations: generated.citations || section.citations,
        assetHits: generated.assetHits || section.assetHits,
        status: 'generated' as const,
        updatedAt: now,
      };
    });

    const tx = db.transaction(() => {
      db.prepare(`UPDATE bid_project_drafts SET markdown = ?, status = ?, updated_at = ? WHERE id = ?`).run(nextMarkdown, 'generated', now, detail.currentDraft!.id);
      db.prepare(`UPDATE bid_projects SET status = ?, selected_template = ?, updated_at = ? WHERE id = ?`).run('generated', DEFAULT_TEMPLATE, now, input.projectId);
      db.prepare(`DELETE FROM bid_project_sections WHERE draft_id = ?`).run(detail.currentDraft!.id);

      const insertSection = db.prepare(`
        INSERT INTO bid_project_sections (
          id, project_id, draft_id, section_key, section_title, sort_order, content_markdown, status, is_locked, citations_json, asset_hits_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const section of nextSections) {
        insertSection.run(
          section.id,
          section.projectId,
          section.draftId,
          section.sectionKey,
          section.sectionTitle,
          section.sortOrder,
          section.contentMarkdown,
          section.status,
          section.isLocked ? 1 : 0,
          JSON.stringify(section.citations),
          JSON.stringify(section.assetHits),
          section.createdAt,
          section.updatedAt
        );
      }
    });

    tx();

    return {
      detail: this.getProject(input.projectId)!,
      generatedSections,
    };
  }

  private updateFactStatus(factId: string, status: TBidProjectFactStatus, shouldApply: boolean): IBidProjectFactRecord | null {
    const db = (getDatabase() as unknown as { db: import('better-sqlite3').Database }).db;
    const factRow = db.prepare(`SELECT * FROM bid_project_facts WHERE id = ?`).get(factId);
    if (!factRow) return null;
    const fact = mapFactRow(factRow);
    const now = Date.now();

    const tx = db.transaction(() => {
      db.prepare(`UPDATE bid_project_facts SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, factId);
      if (shouldApply) {
        const column = FACT_FIELD_TO_COLUMN[fact.fieldName];
        db.prepare(`UPDATE bid_projects SET ${column} = ?, updated_at = ? WHERE id = ?`).run(fact.candidateValue, now, fact.projectId);
      }

      const remainingPending = db.prepare(`SELECT COUNT(*) as count FROM bid_project_facts WHERE project_id = ? AND status = 'pending'`).get(fact.projectId) as { count: number };
      if (remainingPending.count === 0) {
        db.prepare(`UPDATE bid_projects SET status = 'editing', updated_at = ? WHERE id = ?`).run(now, fact.projectId);
      }
    });
    tx();

    if (shouldApply) {
      void this.generateDraft(fact.projectId);
    }

    const updated = db.prepare(`SELECT * FROM bid_project_facts WHERE id = ?`).get(factId);
    return updated ? mapFactRow(updated) : null;
  }

  async chatWithAssistant(input: IBidProjectAssistantChatInput): Promise<IBidProjectAssistantChatResult | null> {
    const detail = this.getProject(input.projectId);
    if (!detail) return null;
    return chatBidProjectAssistant({ detail, input });
  }
}

function buildSectionRecords(projectId: string, draftId: string, markdown: string, now: number): IBidProjectSectionRecord[] {
  const boundaries: Array<{ key: TBidProjectAiSectionKey; title: string; start: string; next?: string }> = [
    { key: 'notice', title: '邀请函', start: '## 第一章 邀请函', next: '## 第二章 应答人须知' },
    { key: 'instructions', title: '应答人须知', start: '## 第二章 应答人须知', next: '## 第三章 采购合同' },
    { key: 'contract', title: '采购合同', start: '## 第三章 采购合同', next: '## 第四章 技术规范书' },
    { key: 'technical', title: '技术规范书', start: '## 第四章 技术规范书', next: '## 第五章 应答文件格式' },
    { key: 'responseFormats', title: '应答文件格式', start: '## 第五章 应答文件格式' },
  ];

  return boundaries.map((boundary, index) => {
    const startIndex = markdown.indexOf(boundary.start);
    const contentStart = startIndex === -1 ? 0 : startIndex + boundary.start.length + 1;
    const endIndex = boundary.next ? markdown.indexOf(boundary.next, contentStart) : markdown.length;
    const sectionMarkdown = startIndex === -1 ? '' : markdown.slice(contentStart, endIndex === -1 ? markdown.length : endIndex).trim();
    return {
      id: `${draftId}-section-${boundary.key}`,
      projectId,
      draftId,
      sectionKey: boundary.key,
      sectionTitle: boundary.title,
      sortOrder: index,
      contentMarkdown: sectionMarkdown,
      status: sectionMarkdown ? 'generated' : 'empty',
      isLocked: false,
      citations: [] as IBidProjectCitationItem[],
      assetHits: buildDefaultAssetHits(),
      createdAt: now,
      updatedAt: now,
    };
  });
}

function buildDefaultReviewIssues(projectId: string, draftId: string, now: number): IBidProjectReviewIssueRecord[] {
  return [
    {
      id: `${draftId}-issue-budget-threshold`,
      projectId,
      draftId,
      sectionKey: 'instructions',
      severity: 'high',
      title: '预算门槛与采购方式需进一步确认',
      detail: '当前预算与采购方式已形成基础判断，但仍需结合最终项目口径校验是否满足直接采购适用边界。',
      basis: '评审规则库 / 合规规则库',
      fixSuggestion: '复核预算门槛、采购方式依据及适用条件，必要时补充内部审批说明。',
      status: 'open',
      citations: [{ title: '预算门槛审查规则', sourceType: 'rule' }],
      assetHits: buildDefaultAssetHits(['review-rule']),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${draftId}-issue-mapping-incomplete`,
      projectId,
      draftId,
      sectionKey: 'technical',
      severity: 'medium',
      title: '技术规范与需求映射说明可进一步补强',
      detail: '当前技术章节已生成基础内容，但对需求条目与技术要求的映射说明仍偏概括。',
      basis: '行业知识库 / 历史模板库',
      fixSuggestion: '补充需求条目与技术响应点之间的一一映射说明。',
      status: 'open',
      citations: [{ title: '技术规范章节模板', sourceType: 'knowledge-base' }],
      assetHits: buildDefaultAssetHits(['template', 'industry-knowledge']),
      createdAt: now,
      updatedAt: now,
    },
  ];
}

interface IBidRagConfig {
  baseUrl: string;
  datasets: Record<string, string>;
}

interface IBidRagRetrievalChunk {
  content: string;
  dataset_id?: string;
  document_name?: string;
}

function readBidRagConfig(): IBidRagConfig | null {
  try {
    const raw = fsSync.readFileSync(BID_RAG_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as {
      ragflow_base_url?: string;
      datasets?: Record<string, string>;
    };
    if (!config.ragflow_base_url || !config.datasets) return null;
    return {
      baseUrl: config.ragflow_base_url,
      datasets: config.datasets,
    };
  } catch {
    return null;
  }
}

function readBidRagApiKey(): string {
  try {
    const keyPath = path.join(path.dirname(BID_RAG_CONFIG_PATH), 'rag-api-key.txt');
    return fsSync.readFileSync(keyPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function readBidRagDatasets(): Partial<Record<TBidProjectAssetKind, string>> {
  const config = readBidRagConfig();
  if (!config) return {};
  return {
    template: config.datasets['kb01-templates'],
    regulation: config.datasets['kb02-regulations'],
    'review-rule': config.datasets['kb03-compliance-rules'],
    'historical-project': config.datasets['kb07-historical-projects'],
  };
}

async function retrieveBidProjectKnowledge(args: { sectionKey: TBidProjectAiSectionKey; question: string }): Promise<{ context: string; citations: IBidProjectCitationItem[]; assetHits: IBidProjectAssetHit[] }> {
  const config = readBidRagConfig();
  const apiKey = readBidRagApiKey();
  if (!config || !apiKey) {
    return { context: '', citations: [], assetHits: [] };
  }

  const sectionDatasets = getBidProjectDatasetIdsForSection(args.sectionKey, config.datasets).filter(Boolean);
  if (sectionDatasets.length === 0) {
    return { context: '', citations: [], assetHits: [] };
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/v1/retrieval`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: args.question,
        dataset_ids: sectionDatasets,
        top_k: 4,
        similarity_threshold: 0.2,
      }),
    });
    if (!response.ok) {
      return { context: '', citations: [], assetHits: [] };
    }
    const payload = (await response.json()) as { code?: number; data?: { chunks?: IBidRagRetrievalChunk[] } };
    const chunks = payload.data?.chunks || [];
    if (chunks.length === 0) {
      return { context: '', citations: [], assetHits: [] };
    }
    return {
      context: chunks.map((chunk) => `- ${chunk.content.slice(0, 240)}`).join('\n'),
      citations: chunks.map((chunk) => ({
        title: chunk.document_name || chunk.dataset_id || 'RAG chunk',
        snippet: chunk.content.slice(0, 240),
        sourceId: chunk.dataset_id || null,
        sourceType: 'knowledge-base',
      })),
      assetHits: mapDatasetIdsToAssetHits(sectionDatasets),
    };
  } catch {
    return { context: '', citations: [], assetHits: [] };
  }
}

function getBidProjectDatasetIdsForSection(sectionKey: TBidProjectAiSectionKey, datasets: Record<string, string>): string[] {
  const base = [datasets['kb01-templates'], datasets['kb02-regulations'], datasets['kb03-compliance-rules']];
  if (sectionKey === 'technical') {
    return [...base, datasets['kb06-requirement-samples'], datasets['kb07-historical-projects']].filter(Boolean);
  }
  if (sectionKey === 'notice' || sectionKey === 'instructions') {
    return [...base, datasets['kb07-historical-projects']].filter(Boolean);
  }
  return base.filter(Boolean);
}

function mapDatasetIdsToAssetHits(datasetIds: string[]): IBidProjectAssetHit[] {
  const ragDatasets = readBidRagDatasets();
  return Object.entries(ragDatasets)
    .filter(([, datasetId]) => datasetIds.includes(datasetId || ''))
    .map(([assetKind, datasetId]) => ({
      assetKind: assetKind as TBidProjectAssetKind,
      label: assetKind === 'template' ? '历史模板库' : assetKind === 'regulation' ? '法规库' : assetKind === 'review-rule' ? '评审规则库' : assetKind === 'historical-project' ? '历史项目库' : assetKind,
      refId: datasetId || null,
    }));
}

function buildDefaultAssetHits(kinds?: TBidProjectAssetKind[]): IBidProjectAssetHit[] {
  const values = kinds || ['template', 'clause', 'industry-knowledge', 'review-rule'];
  const ragDatasets = readBidRagDatasets();
  return values.map((assetKind) => ({
    assetKind,
    label: assetKind === 'template' ? '历史模板库' : assetKind === 'clause' ? '条款库' : assetKind === 'industry-knowledge' ? '行业知识库' : assetKind === 'review-rule' ? '评审规则库' : assetKind === 'regulation' ? '法规库' : assetKind === 'historical-project' ? '历史项目库' : assetKind,
    refId: ragDatasets[assetKind] || null,
  }));
}

function buildAssistantContext(args: { currentSectionKey?: TBidProjectAiSectionKey; currentSectionTitle?: string; facts: IBidProjectFactRecord[]; sources: IBidProjectSourceRecord[] }): IBidProjectAssistantContext {
  const confirmedFacts = args.facts.filter((fact) => fact.status === 'confirmed');
  const contextLabels = confirmedFacts.slice(0, 4).map((fact) => `${fact.fieldName}: ${fact.candidateValue}`);
  return {
    currentSectionKey: args.currentSectionKey,
    currentSectionTitle: args.currentSectionTitle,
    mode: args.currentSectionKey ? 'section' : 'project',
    contextLabels,
    sourceOrigins: Array.from(new Set(args.sources.map((source) => source.origin))),
    assetKinds: ['template', 'clause', 'industry-knowledge', 'review-rule'],
  };
}

function mapSectionRow(row: any): IBidProjectSectionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    draftId: row.draft_id,
    sectionKey: row.section_key,
    sectionTitle: row.section_title,
    sortOrder: row.sort_order,
    contentMarkdown: row.content_markdown,
    status: row.status,
    isLocked: Boolean(row.is_locked),
    citations: JSON.parse(row.citations_json || '[]'),
    assetHits: JSON.parse(row.asset_hits_json || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReviewIssueRow(row: any): IBidProjectReviewIssueRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    draftId: row.draft_id,
    sectionKey: row.section_key,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    basis: row.basis,
    fixSuggestion: row.fix_suggestion,
    status: row.status,
    citations: JSON.parse(row.citations_json || '[]'),
    assetHits: JSON.parse(row.asset_hits_json || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersionRow(row: any): IBidProjectVersionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    draftId: row.draft_id,
    version: row.version,
    source: row.source,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

async function extractSourceText(file: IBidProjectSourceFileInput): Promise<string> {
  const extension = path.extname(file.name).toLowerCase();
  if (extension === '.txt' || extension === '.md') {
    return await fs.readFile(file.path!, 'utf-8');
  }

  if (extension === '.doc' || extension === '.docx' || extension === '.ppt' || extension === '.pptx' || extension === '.xls' || extension === '.xlsx') {
    return await parseOfficeAsync(file.path!, { newlineDelimiter: '\n', ignoreNotes: true });
  }

  if (extension === '.pdf') {
    const result = await conversionService.libreOfficeToPdf(file.path!);
    if (result.success && result.data) {
      return await parseOfficeAsync(result.data, { newlineDelimiter: '\n' });
    }
    return await parseOfficeAsync(file.path!, { newlineDelimiter: '\n' });
  }

  return await fs.readFile(file.path!, 'utf-8');
}

function summarizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function extractFactsFromText(projectId: string, sourceFileId: string, text: string): Array<{ fieldName: TBidProjectFactFieldName; value: string; confidence: number; sourceFileId: string; snippet: string }> {
  const normalized = text.replace(/\r/g, '');
  const normalizedForMatch = normalized
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[#@\s]+/gm, '')
    .trim();
  const compactText = normalizedForMatch.replace(/\n+/g, ' ');
  const facts: Array<{ fieldName: TBidProjectFactFieldName; value: string; confidence: number; sourceFileId: string; snippet: string }> = [];
  const nextFieldPattern = '(?:项目名称|采购项目名称|项目名|采购人|采购单位|建设单位|业主|预算(?:金额)?|最高限价|项目预算|采购预算|项目类型|采购标的|采购内容|项目内容|初步描述|工期|服务期限|实施周期|交付周期|时间要求|采购方式|招标方式|采购组织形式)';

  const patterns: Array<{ fieldName: TBidProjectFactFieldName; regexes: RegExp[] }> = [
    { fieldName: 'name', regexes: [new RegExp(`项目名称[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'), new RegExp(`采购项目名称[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'), new RegExp(`项目名[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i')] },
    {
      fieldName: 'company',
      regexes: [
        new RegExp(`采购人[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`采购单位[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`建设单位[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`业主[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
      ],
    },
    {
      fieldName: 'budget',
      regexes: [
        new RegExp(`预算(?:金额)?[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`最高限价[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`项目预算[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`采购预算[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
      ],
    },
    { fieldName: 'projectType', regexes: [new RegExp(`项目类型[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i')] },
    {
      fieldName: 'target',
      regexes: [
        new RegExp(`采购标的[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`采购内容[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`项目内容[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`初步描述[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
      ],
    },
    {
      fieldName: 'duration',
      regexes: [
        new RegExp(`工期[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`服务期限[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`实施周期[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`交付周期[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
        new RegExp(`时间要求[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'),
      ],
    },
    { fieldName: 'procurementMethod', regexes: [new RegExp(`采购方式[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'), new RegExp(`招标方式[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i'), new RegExp(`采购组织形式[:：]\\s*(.+?)(?=\\s*${nextFieldPattern}[:：]|$)`, 'i')] },
  ];

  for (const pattern of patterns) {
    for (const regex of pattern.regexes) {
      const match = compactText.match(regex);
      if (match?.[1]) {
        const cleanedValue = cleanExtractedFactValue(match[1]);
        if (!cleanedValue) continue;
        facts.push({
          fieldName: pattern.fieldName,
          value: cleanedValue,
          confidence: 0.92,
          sourceFileId,
          snippet: compactText.slice(0, 240),
        });
        break;
      }
    }
  }

  if (facts.length === 0 && normalizedForMatch.trim()) {
    const snippet = normalizedForMatch.replace(/\s+/g, ' ').trim().slice(0, 240);
    facts.push({ fieldName: 'target', value: snippet.slice(0, 80), confidence: 0.35, sourceFileId, snippet });
  }

  return facts;
}

function cleanExtractedFactValue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^(\-|：|:)+/, '')
    .replace(/[。；;，,]+$/g, '')
    .trim();
}

function dedupeFacts(facts: Array<{ fieldName: TBidProjectFactFieldName; value: string; confidence: number; sourceFileId: string; snippet: string }>) {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.fieldName}::${fact.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const SUPPORTED_AI_SECTION_KEYS: TBidProjectAiSectionKey[] = ['notice', 'instructions', 'contract', 'technical', 'responseFormats'];

const AI_SECTION_TITLES: Record<TBidProjectAiSectionKey, string> = {
  notice: '邀请函',
  instructions: '应答人须知',
  contract: '采购合同',
  technical: '技术规范书',
  responseFormats: '应答文件格式',
};

const AI_SECTION_BOUNDARIES: Record<TBidProjectAiSectionKey, { startHeading: string; nextHeading: string }> = {
  notice: {
    startHeading: '## 第一章 邀请函',
    nextHeading: '## 第二章 应答人须知',
  },
  instructions: {
    startHeading: '## 第二章 应答人须知',
    nextHeading: '## 第三章 采购合同',
  },
  contract: {
    startHeading: '## 第三章 采购合同',
    nextHeading: '## 第四章 技术规范书',
  },
  technical: {
    startHeading: '## 第四章 技术规范书',
    nextHeading: '## 第五章 应答文件格式',
  },
  responseFormats: {
    startHeading: '## 第五章 应答文件格式',
    nextHeading: '',
  },
};

export function buildUnicomDirectProcurementMarkdown(detail: IBidProjectDetail): string {
  const projectName = detail.project.name || '未命名项目';
  const projectCode = buildProjectCode(detail.project);
  const company = detail.project.company || '待补充采购人';
  const createdDate = formatChineseDate(detail.project.createdAt);
  const sections = buildUnicomDirectProcurementSections(detail);

  return [
    `# ${projectName}`,
    '',
    '# 中国联通直接采购文件',
    '',
    `**项目编号：${projectCode}**`,
    '',
    `采购人：中国联合网络通信有限公司${company.replace(/^中国联通/, '').replace(/^中国联合网络通信有限公司/, '') || '相关单位'}`,
    '采购代理机构：待补充（如适用）',
    `日期：${createdDate}`,
    '',
    '## 目录',
    '1. 邀请函',
    '2. 应答人须知',
    '3. 采购合同',
    '4. 技术规范书',
    '5. 应答文件格式',
    '',
    '## 第一章 邀请函',
    sections.notice,
    '',
    '## 第二章 应答人须知',
    sections.instructions,
    '',
    '## 第三章 采购合同',
    sections.contract,
    '',
    '## 第四章 技术规范书',
    sections.technical,
    '',
    '## 第五章 应答文件格式',
    sections.responseFormats,
  ].join('\n');
}

function buildUnicomDirectProcurementSections(detail: IBidProjectDetail): Record<'notice' | 'instructions' | 'contract' | 'technical' | 'responseFormats', string> {
  const { project, sources, facts } = detail;
  const sourceSummaries = sources
    .filter((source) => source.summary)
    .map((source) => `- **${source.fileName}**：${source.summary}`)
    .join('\n');
  const confirmedFacts = facts
    .filter((fact) => fact.status === 'confirmed')
    .map((fact) => `- **${fact.fieldName}**：${fact.candidateValue}`)
    .join('\n');
  const procurementMethod = project.procurementMethod || '直接采购';
  const projectCode = buildProjectCode(project);
  const projectName = project.name || '未命名项目';
  const company = project.company || '待补充采购人';
  const budget = project.budget || '待补充';
  const duration = project.duration || '待补充';
  const target = project.target || '待补充采购内容';
  const remark = project.remark || '待补充';
  const contactName = pickContactName(detail) || '待补充';
  const contactPhone = pickContactPhone(detail) || '待补充';
  const contactEmail = pickContactEmail(detail) || '待补充';
  const location = pickLocation(detail) || '采购人指定地点';
  const qualificationItems = buildQualificationItems(detail);
  const pendingSupplements = buildPendingSupplements(detail);
  const scheduleTable = ['| 项目 | 内容 |', '| --- | --- |', `| 项目名称 | ${projectName} |`, `| 项目编号 | ${projectCode} |`, `| 采购方式 | ${procurementMethod} |`, `| 采购人 | ${company} |`, `| 预算/限价 | ${budget} |`, `| 服务期限 | ${duration} |`, `| 服务地点 | ${location} |`].join('\n');
  const noticeTable = [
    '| 条款 | 内容 |',
    '| --- | --- |',
    `| 项目名称 | ${projectName} |`,
    `| 采购编号 | ${projectCode} |`,
    `| 采购方式 | ${procurementMethod} |`,
    `| 采购人 | ${company} |`,
    `| 预算/限价 | ${budget} |`,
    `| 实施周期 | ${duration} |`,
    `| 实施地点 | ${location} |`,
    '| 应答文件有效期 | 自应答文件递交截止之日起 90 日历日 |',
    '| 应答文件份数 | 正本 1 份，副本按采购人要求提供 |',
    '| 评审原则 | 满足采购文件实质性要求的前提下，综合商务、技术与价格因素确定成交候选人 |',
  ].join('\n');

  return {
    notice: [
      `${projectName} 已具备采购条件，采购人为 ${company}，现邀请符合条件的供应商参加本项目 ${procurementMethod}。`,
      '',
      '### 采购背景与采购依据',
      `为满足 ${company} 在 ${target} 方面的建设与实施需求，保障项目按期推进，现依据中国联通相关采购管理要求组织本项目 ${procurementMethod}。`,
      `本项目采购目标是在 ${duration} 内完成项目约定范围的交付，确保质量、进度、安全与合规要求同步满足，并为后续稳定运行打下基础。`,
      '',
      '### 项目概况',
      scheduleTable,
      '',
      `本项目采购内容为：${target}。`,
      `项目预算/限价参考为：${budget}。`,
      `采购人拟通过 ${procurementMethod} 方式完成本项目采购，并以满足项目需求、服务质量、履约组织和综合成本控制为主要评审导向。`,
      '',
      '### 供应商参与要求',
      '- 供应商应认真阅读采购文件全部内容，并结合自身资质、技术能力、交付团队与履约经验审慎参与。',
      '- 供应商参加本项目应答，即视为已充分理解采购需求、合同条件、技术规范、评审规则及相关澄清文件要求。',
      '- 供应商应对所提交应答文件的真实性、完整性和一致性负责，不得以虚假承诺、低于成本报价或其他不正当方式参与应答。',
      '',
      '### 获取采购文件',
      '- 采购文件获取方式：由采购人或采购代理机构统一通知，供应商应按通知要求领取、确认接收或在线下载采购文件。',
      '- 供应商收到采购文件后，应及时核对文件完整性；如发现缺页、错页、内容不清或前后矛盾，应在应答截止前书面提出。',
      '- 采购文件的澄清、补充、修改及正式答复均为采购文件组成部分，与采购文件正文具有同等法律效力。',
      '',
      '### 答疑与澄清',
      '- 供应商对采购文件内容存在疑问的，应在采购人要求的时限内提出，逾期提出的，采购人有权不再统一答复。',
      '- 采购人可视项目实际情况组织答疑、澄清或补充说明，供应商应及时关注相关通知并据此调整应答文件。',
      '- 因供应商未及时获取或未正确理解澄清、补充文件导致的应答偏差，由供应商自行承担责任。',
      '',
      '### 应答文件递交',
      `- 应答文件递交地点：${location}。`,
      `- 联系人：${contactName}，联系电话：${contactPhone}，电子邮箱：${contactEmail}。`,
      '- 应答文件应在规定时限内按要求密封、签署并递交，逾期送达、未按要求密封或未按要求签署的文件可被拒收。',
      '- 采购人有权根据项目推进情况对递交安排作合理调整，并以书面通知为准。',
      '',
      '### 其他说明',
      '- 供应商应自行承担参与本项目过程中发生的全部准备、编制、递交及澄清等费用。',
      '- 供应商在应答过程中应遵守国家法律法规及中国联通相关采购管理要求。',
      `- 供应商应结合项目实际情况，对以下已知信息进行重点响应：${remark}。`,
    ].join('\n'),
    instructions: [
      '### 应答人须知前附表',
      noticeTable,
      '',
      '### 应答人资格要求',
      qualificationItems,
      '',
      '### 采购文件组成与解释顺序',
      '- 采购文件由邀请函、应答人须知、合同条款、技术规范书、应答文件格式及其澄清、补充、修改文件组成。',
      '- 采购文件各组成部分如有不一致，以采购人最终书面澄清、补充或修改文件为准。',
      '- 供应商对采购文件理解存在疑义时，应在规定时限内提出，不得在成交后以理解偏差为由拒绝履约。',
      '',
      '### 应答文件编制要求',
      '- 应答文件应按照采购文件章节顺序编制，内容完整、编排清晰，并对每一项要求作出明确响应。',
      '- 应答文件中的商务、技术、报价等内容应保持一致；如出现前后不一致，以对采购人有利的解释为准。',
      '- 应答文件应加盖单位公章；如由授权代表签署，应附法定代表人授权委托书。',
      '- 应答文件中的关键承诺、交付期限、服务标准、偏离情况及需采购人确认事项应单独列示，便于评审。',
      '',
      '### 报价要求',
      '- 应答报价应以人民币为计价货币，并结合项目范围、服务周期、实施投入和交付要求进行完整报价。',
      `- 报价应覆盖完成 ${target} 所需的全部费用，包括但不限于人工、管理、差旅、培训、税费、售后和风险成本。`,
      `- 供应商报价不得高于预算/限价 ${budget}；如存在分项报价，应保证分项与总价的勾稽关系准确。`,
      '- 报价一经确认，在应答有效期内原则上不得擅自调整；如采购人要求二次报价或澄清报价，供应商应按通知执行。',
      '',
      '### 应答有效期与承诺要求',
      '- 应答文件有效期应满足采购文件要求；在有效期内，供应商不得无故撤回应答或拒绝澄清。',
      '- 供应商应保证所提供证照、业绩、人员、授权及其他证明材料真实、合法、有效。',
      '- 供应商提交的技术方案、实施计划、资源投入和服务承诺应具备可执行性和可核验性。',
      '',
      '### 评审与响应原则',
      '- 采购人将重点审查供应商资格条件、技术方案、交付组织、服务保障和报价合理性。',
      '- 供应商应对采购需求逐项响应，对“满足/不满足/偏离说明”进行明确表述。',
      '- 对于采购文件要求提供的证明材料，供应商应在应答文件中提供清晰、有效的复印件或扫描件。',
      '- 如需澄清应答文件内容，供应商应在采购人规定时限内作出书面回复。',
      '',
      '### 成交通知与合同签署',
      '- 采购人确定成交供应商后，将按内部流程发出成交通知。',
      '- 成交供应商应按采购人要求及时确认成交结果，并在规定时限内完成合同谈判、合同签署及项目启动准备。',
      '- 成交供应商在成交后无正当理由拒绝签约或拒绝履约的，采购人有权取消其成交资格并追究相应责任。',
      '',
      '### 无效应答情形',
      '- 未按采购文件要求签署、盖章或密封的。',
      '- 未按要求提供资格证明材料或关键证明材料失效的。',
      '- 报价超过预算/限价，或报价内容存在重大缺漏、明显不合理的。',
      '- 对采购文件实质性条款未作响应，或存在重大负偏离且未被采购人接受的。',
      '- 提供虚假资料、串通应答或存在其他违反采购纪律行为的。',
    ].join('\n'),
    contract: [
      '### 合同主体',
      `甲方：${company}`,
      '乙方：待定成交供应商',
      '',
      '### 合同文件组成',
      '- 本合同及附件。',
      '- 采购文件、澄清补充文件。',
      '- 成交供应商应答文件、报价文件及承诺函。',
      '- 双方在项目实施过程中形成并确认的会议纪要、实施方案、验收单据及其他书面文件。',
      '',
      '### 合同范围',
      `乙方应按照采购文件、应答文件及双方确认的实施方案，为甲方提供 ${target} 相关服务，并对项目整体交付结果负责。`,
      '',
      '### 服务内容与交付要求',
      `- 项目名称：${projectName}`,
      `- 服务内容：${target}`,
      `- 服务期限：${duration}`,
      `- 服务地点：${location}`,
      '- 乙方应按照实施计划完成项目启动、需求梳理、方案设计、实施交付、培训支持和验收配合等工作。',
      '- 乙方交付的成果应满足采购需求、技术规范书、双方确认方案及行业通行质量标准。',
      '- 项目实施过程中，乙方还应遵循甲方项目管理、信息安全、现场管理及中国联通相关采购履约要求。',
      '- 如项目实施过程中存在采购人组织、第三方协同、现场接入或系统配合要求，乙方应积极响应并做好配套工作。',
      '',
      '### 进度管理与人员保障',
      '- 乙方应在合同生效后及时提交项目实施计划、阶段里程碑和人员安排。',
      '- 项目实施期间，乙方应保持核心团队稳定；如需更换关键人员，应事先征得甲方书面同意。',
      '- 因乙方原因导致项目进度滞后时，乙方应无条件采取补救措施，并承担由此产生的责任。',
      '- 对于需要甲方确认的阶段性事项，乙方应提前提出并配合甲方完成评审、确认和决策流程。',
      '',
      '### 验收安排',
      '- 项目验收分为阶段验收和最终验收，具体安排由甲方根据项目推进情况确定。',
      '- 乙方应按要求提交交付成果、测试说明、培训记录、问题清单及其他验收所需材料。',
      '- 验收未通过的，乙方应在甲方要求期限内完成整改并重新提交验收。',
      '- 因乙方交付质量问题导致重复整改、延期验收或返工的，相关责任与成本由乙方承担。',
      '',
      '### 付款与发票',
      `- 合同金额：以最终成交结果为准，预算参考 ${budget}。`,
      '- 付款原则上按照合同约定的阶段成果和验收结果分期支付。',
      '- 乙方申请付款时，应按甲方要求提交合法、有效、等额的增值税发票及付款申请材料。',
      '- 如乙方未按约履行合同义务，甲方有权暂缓付款或在应付款项中扣减相应违约金。',
      '',
      '### 保密、知识产权与违约责任',
      '- 双方对在合作过程中获悉的商业秘密、技术资料和项目数据负有保密义务。',
      '- 乙方应保证交付成果不侵犯任何第三方合法权益；如发生侵权纠纷，由乙方承担全部责任。',
      '- 因乙方违约造成甲方损失的，乙方应承担相应赔偿责任；情节严重的，甲方有权解除合同。',
      '- 因合同履行发生争议的，双方应先协商解决；协商不成的，提交有管辖权的人民法院处理。',
      '',
      '### 附加约定',
      `- 当前项目备注：${remark}`,
      `- 乙方在履约过程中应重点关注以下待补充/待确认事项：${pendingSupplements.replace(/\n/g, '；')}`,
    ].join('\n'),
    technical: [
      '### 建设目标',
      `围绕 ${target} 的建设与实施需求，形成覆盖方案设计、项目实施、交付验收和服务保障的完整服务体系，确保项目目标、质量目标和进度目标同步达成。`,
      '',
      '### 项目范围与服务边界',
      `- 供应商应对 ${target} 相关工作进行整体统筹，覆盖项目启动、需求确认、实施交付、培训支撑和验收配合。`,
      '- 供应商应结合采购人实际场景，形成可执行的实施方案、资源计划、质量控制和风险应对措施。',
      '- 供应商应建立项目沟通与汇报机制，确保关键节点、问题与风险及时反馈。',
      '- 供应商应按中国联通项目管理要求提交阶段汇报、问题闭环和交付文档，确保过程可追踪、结果可核验。',
      '',
      '### 交付成果清单',
      '- 项目实施方案及进度计划。',
      '- 需求分析、配置说明、实施记录及阶段成果文件。',
      '- 培训材料、培训记录、运维交接资料及验收支撑材料。',
      '- 项目总结、问题闭环记录及采购人要求的其他成果。',
      '',
      '### 技术与实施要求',
      '- 供应商应结合采购需求提供完整的实施方案、交付清单和保障措施。',
      '- 供应商应确保交付成果满足安全、稳定、可维护要求。',
      '- 供应商应建立质量控制机制，覆盖需求确认、方案评审、交付检查、问题整改和验收准备等环节。',
      '- 供应商应针对重点风险制定预案，包括进度风险、资源风险、质量风险和沟通协同风险。',
      '',
      '### 人员与组织要求',
      '- 供应商应配置满足项目需要的项目经理、实施骨干、技术支持及质量保障人员。',
      '- 项目经理应负责整体统筹、进度管理、问题升级和资源协调。',
      '- 关键岗位人员应具备与项目场景相匹配的实施经验和沟通能力。',
      '',
      '### 服务保障要求',
      '- 供应商应提供项目实施、培训、验收和售后服务支持。',
      '- 供应商应明确服务响应机制、问题升级路径和关键岗位联系人。',
      '- 对采购人提出的合理优化意见，供应商应在约定时限内响应并落实。',
      '',
      '### 验收标准',
      '- 交付成果齐全、内容完整、格式规范。',
      '- 项目实施结果符合采购需求、技术规范及合同约定。',
      '- 培训、文档、测试或验证记录满足采购人项目管理要求。',
      '- 发现问题已形成闭环整改并通过采购人确认。',
      '',
      '### 采购人现有资料摘要',
      sourceSummaries || '- 暂无可引用的材料摘要。',
      '',
      '### 已确认字段',
      confirmedFacts || '- 暂无已确认字段。',
      '',
      '### 待补充事项',
      pendingSupplements,
      '',
      '### 备注信息',
      remark,
    ].join('\n'),
    responseFormats: [
      '### 应答文件组成',
      '1. 应答函',
      '2. 法定代表人身份证明或授权委托书',
      '3. 商务偏离表',
      '4. 技术偏离表',
      '5. 报价一览表',
      '6. 资格证明材料',
      '7. 项目实施方案与服务承诺',
      '',
      '### 编制与装订要求',
      '- 应答文件应按章节顺序编排，目录、页码和附件索引完整。',
      '- 商务文件、技术文件和报价文件应保持逻辑一致，关键承诺应有明确落点。',
      '- 所有复印件、扫描件应清晰可辨，涉及资格、业绩、授权等材料应加盖公章。',
      '',
      '### 应答函（示例）',
      `致：${company}`,
      `我方已充分理解 ${projectName} 采购文件内容，愿按照文件要求参与本项目应答，并承诺对所提交文件的真实性、完整性和有效性负责。如我方成交，将严格按照采购文件、应答文件及合同约定完成项目实施与交付。`,
      '',
      '### 法定代表人身份证明（示例）',
      '兹证明______为我单位法定代表人，代表我单位办理与本项目有关的一切事务。',
      '',
      '### 授权委托书（示例）',
      '本单位现授权______作为我方合法委托代理人，参加本项目应答、澄清、谈判、报价确认及签约相关工作。',
      '',
      '### 报价一览表（示例）',
      '| 项目 | 报价说明 |',
      '| --- | --- |',
      `| ${projectName} | 请填写最终含税/不含税报价 |`,
      `| 实施与服务周期 | ${duration} |`,
      `| 备注 | 报价应包含完成 ${target} 所需全部费用 |`,
      '',
      '### 商务偏离表（示例）',
      '| 条款名称 | 采购要求 | 应答情况 | 偏离说明 |',
      '| --- | --- | --- | --- |',
      '| 服务期限 | 按采购文件要求 | 满足 | 无 |',
      '| 付款安排 | 按合同约定执行 | 满足 | 无 |',
      '',
      '### 技术偏离表（示例）',
      '| 技术条款 | 采购要求 | 应答情况 | 偏离说明 |',
      '| --- | --- | --- | --- |',
      '| 服务范围 | 满足项目需求 | 满足 | 无 |',
      '| 交付成果 | 按采购文件要求提供 | 满足 | 无 |',
      '',
      '### 资格证明材料清单（示例）',
      '- 营业执照或合法注册证明材料。',
      '- 法定代表人身份证明及授权委托书。',
      '- 类似项目业绩证明材料。',
      '- 项目团队、服务能力和承诺函等支撑材料。',
      '',
      '### 服务承诺（示例）',
      '- 按采购文件要求组织实施并按期交付。',
      '- 关键岗位人员稳定，重大问题及时升级响应。',
      '- 配合采购人完成培训、验收、整改与售后支持。',
    ].join('\n'),
  };
}

function isSupportedAiSectionKey(value: string): value is TBidProjectAiSectionKey {
  return SUPPORTED_AI_SECTION_KEYS.includes(value as TBidProjectAiSectionKey);
}

function ensureBidProjectMarkdown(detail: IBidProjectDetail): string {
  return detail.currentDraft?.markdown?.trim() ? detail.currentDraft.markdown : buildUnicomDirectProcurementMarkdown(detail);
}

function isPlaceholderDraftMarkdown(markdown: string): boolean {
  const trimmed = markdown.trim();
  return trimmed === DEFAULT_MARKDOWN.trim() || trimmed.includes('正在生成招标文件初稿');
}

function getRuleSectionMarkdown(detail: IBidProjectDetail, sectionKey: TBidProjectAiSectionKey): string {
  const sections = buildUnicomDirectProcurementSections(detail);
  return sections[sectionKey];
}

function replaceBidProjectSectionMarkdown(markdown: string, sectionKey: TBidProjectAiSectionKey, nextSectionMarkdown: string): string {
  const boundaries = AI_SECTION_BOUNDARIES[sectionKey];
  const startIndex = markdown.indexOf(boundaries.startHeading);
  if (startIndex === -1) {
    return markdown;
  }

  const startContentIndex = startIndex + boundaries.startHeading.length + 1;
  const nextHeadingIndex = boundaries.nextHeading ? markdown.indexOf(boundaries.nextHeading, startContentIndex) : -1;
  const endIndex = nextHeadingIndex === -1 ? markdown.length : nextHeadingIndex - 1;
  const normalizedSection = nextSectionMarkdown.trim();

  return `${markdown.slice(0, startContentIndex)}${normalizedSection}\n\n${markdown.slice(endIndex + 1)}`;
}

async function generateBidProjectAiSection(args: { accessToken?: string; assistantId?: string; detail: IBidProjectDetail; fallbackMarkdown: string; sectionKey: TBidProjectAiSectionKey }): Promise<IBidProjectAiSectionResult> {
  const title = AI_SECTION_TITLES[args.sectionKey];
  const knowledge = await retrieveBidProjectKnowledge({
    sectionKey: args.sectionKey,
    question: `${args.detail.project.name} ${title} ${args.detail.project.target}`,
  });
  const query = buildBidProjectAiQuery(args.detail, args.sectionKey, args.fallbackMarkdown, knowledge.context);

  if (args.accessToken && args.assistantId) {
    try {
      const enhancement = await withBidProjectAiTimeout(callGetEnhancement(args.accessToken, args.assistantId));
      if (enhancement.success && enhancement.data?.enabled && enhancement.data.mode) {
        const response = await withBidProjectAiTimeout(
          enhancement.data.mode === 'workflow'
            ? callStartEnhancementStream({
                accessToken: args.accessToken,
                assistantId: args.assistantId,
                query,
              })
            : callInvokeEnhancement({
                accessToken: args.accessToken,
                assistantId: args.assistantId,
                query,
              })
        );

        const markdown = normalizeAiMarkdown(response.data?.text || '');
        if (response.success && response.data && markdown) {
          return {
            sectionKey: args.sectionKey,
            title,
            markdown,
            fallbackUsed: false,
            mode: response.data.mode,
            elapsedMs: response.data.elapsedMs,
            citations: [...knowledge.citations, ...((response.data.citations || []) as IBidProjectCitationItem[])],
            assetHits: knowledge.assetHits,
          };
        }
      }
    } catch {
      // Fall through to direct model generation.
    }
  }

  const directResult = await generateBidProjectDirectAiSection({
    detail: args.detail,
    query,
    sectionKey: args.sectionKey,
  });
  if (directResult) {
    return {
      ...directResult,
      citations: knowledge.citations,
      assetHits: knowledge.assetHits,
    };
  }

  return {
    ...createFallbackSectionResult(args.sectionKey, args.fallbackMarkdown),
    citations: knowledge.citations,
    assetHits: knowledge.assetHits,
  };
}

async function chatBidProjectAssistant(args: { detail: IBidProjectDetail; input: IBidProjectAssistantChatInput }): Promise<IBidProjectAssistantChatResult> {
  const startedAt = Date.now();
  const question = args.input.prompt;
  const knowledge = args.input.sectionKey ? await retrieveBidProjectKnowledge({ sectionKey: args.input.sectionKey, question }) : { context: '', citations: [], assetHits: [] };
  const query = buildBidProjectChatQuery({ detail: args.detail, input: args.input, retrievalContext: knowledge.context });

  if (args.input.accessToken && args.input.assistantId) {
    try {
      const enhancement = await withBidProjectAiTimeout(callGetEnhancement(args.input.accessToken, args.input.assistantId));
      if (enhancement.success && enhancement.data?.enabled && enhancement.data.mode) {
        const response = await withBidProjectAiTimeout(
          enhancement.data.mode === 'workflow' ? callStartEnhancementStream({ accessToken: args.input.accessToken, assistantId: args.input.assistantId, query }) : callInvokeEnhancement({ accessToken: args.input.accessToken, assistantId: args.input.assistantId, query })
        );
        const text = normalizeAiMarkdown(response.data?.text || '');
        if (response.success && text) {
          return {
            content: text,
            citations: [...knowledge.citations, ...((response.data?.citations || []) as IBidProjectCitationItem[])],
            assetHits: knowledge.assetHits,
            elapsedMs: Date.now() - startedAt,
            fallbackUsed: false,
          };
        }
      }
    } catch (error) {
      console.error('[bid-projects] chat assistant enhancement failed', error);
      // Fall through to direct model.
    }
  }

  const direct = await callBidProjectAssistantDirect(query);
  if (direct) {
    return {
      content: direct,
      citations: knowledge.citations,
      assetHits: knowledge.assetHits,
      elapsedMs: Date.now() - startedAt,
      fallbackUsed: false,
    };
  }

  return {
    content: buildAssistantFallbackContent(args.input),
    citations: knowledge.citations,
    assetHits: knowledge.assetHits,
    elapsedMs: Date.now() - startedAt,
    fallbackUsed: true,
  };
}

async function callBidProjectAssistantDirect(query: string): Promise<string | null> {
  try {
    const runtime = await resolveBidProjectChatRuntime();
    if (!runtime) {
      console.warn('[bid-projects] chat assistant runtime missing');
      return null;
    }
    const endpoint = `${runtime.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    console.log('[bid-projects] chat assistant runtime', { baseUrl: runtime.baseUrl, model: runtime.model });
    const requestBody = JSON.stringify({
      model: runtime.model,
      messages: [
        {
          role: 'system',
          content: '你是资深通信行业采购文件编制专家，回答需要准确、简洁、可直接落文。只能基于已提供的资料写作；不得编造未给出的事实。中文输出。',
        },
        { role: 'user', content: query },
      ],
    });
    const { stdout, stderr } = await safeExecFile('curl', ['-sS', '-X', 'POST', endpoint, '-H', `Authorization: Bearer ${runtime.apiKey}`, '-H', 'Content-Type: application/json', '-d', requestBody], { timeout: BID_PROJECT_AI_TIMEOUT_MS });
    if (stderr.trim()) {
      console.log('[bid-projects] chat assistant curl stderr', stderr.trim());
    }
    const payload = JSON.parse(stdout) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
    if (payload.error?.message) {
      console.error('[bid-projects] chat assistant api error', payload.error.message);
      return null;
    }
    const raw = payload.choices?.[0]?.message?.content;
    const text = Array.isArray(raw)
      ? raw
          .filter((item) => item?.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text)
          .join('\n')
      : typeof raw === 'string'
        ? raw
        : '';
    const normalized = normalizeAiMarkdown(text);
    return normalized || null;
  } catch (error) {
    console.error('[bid-projects] chat assistant direct call failed', error);
    return null;
  }
}

async function resolveBidProjectChatRuntime(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  const scodeRuntime = readBidProjectScodeRuntime();
  if (scodeRuntime) return scodeRuntime;

  try {
    const providers = ((await ProcessConfig.get('model.config').catch((): TProviderWithModel[] | null => null)) || []) as TProviderWithModel[];
    const hydratedProviders = providers.map((item) => {
      const namespace = `provider:${item.id}`;
      const apiKey = item.apiKey?.trim() || resolveSecret(namespace, 'api_key', '');
      return {
        ...item,
        apiKey,
      };
    });
    const provider = hydratedProviders.find((item) => item?.enabled !== false && typeof item.baseUrl === 'string' && item.baseUrl.trim() && typeof item.apiKey === 'string' && item.apiKey.trim() && typeof item.useModel === 'string' && item.useModel.trim());
    if (provider) {
      return {
        baseUrl: provider.baseUrl.trim().replace(/\/+$/, ''),
        apiKey: provider.apiKey.trim(),
        model: provider.useModel.trim(),
      };
    }
  } catch {
    // Fall through to sudorouter credentials.
  }

  const credentials = readSudorouterCredentials();
  if (!credentials) return null;
  return {
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
    model: readBidProjectAiModel(),
  };
}

function readBidProjectScodeRuntime(): { baseUrl: string; apiKey: string; model: string } | null {
  try {
    const config = JSON.parse(fsSync.readFileSync(SCODE_CONFIG_PATH, 'utf-8')) as {
      default_model?: string;
      auth_modes?: { proxy?: Record<string, { baseUrl?: string; apiKey?: string }> };
      models?: Record<string, { providers?: { proxy?: { provider?: string; model?: string } } }>;
    };
    const defaultModel = typeof config.default_model === 'string' && config.default_model.trim() ? config.default_model.trim() : '';
    const authProxy = config.auth_modes?.proxy?.sudorouter;
    const mappedModel = defaultModel ? config.models?.[defaultModel]?.providers?.proxy?.model : '';
    if (authProxy?.apiKey && mappedModel) {
      return {
        baseUrl: (authProxy.baseUrl || 'https://hk.sudorouter.ai/v1').replace(/\/+$/, ''),
        apiKey: authProxy.apiKey,
        model: mappedModel,
      };
    }
  } catch {
    // Ignore and continue.
  }
  return null;
}

function buildBidProjectChatQuery(args: { detail: IBidProjectDetail; input: IBidProjectAssistantChatInput; retrievalContext: string }): string {
  const { detail, input, retrievalContext } = args;
  const confirmedFacts = detail.facts
    .filter((fact) => fact.status === 'confirmed')
    .slice(0, 8)
    .map((fact) => `- ${fact.fieldName}: ${fact.candidateValue}`);
  const intentInstruction = intentToInstruction(input.intent);
  const sectionBlock = input.sectionMarkdown ? `【当前章节 (${input.sectionKey || 'unknown'})】\n${input.sectionMarkdown.slice(0, 4000)}` : '';
  const issueBlock = input.issueTitle ? `【合规问题】\n标题：${input.issueTitle}\n${input.issueDetail ? `详情：${input.issueDetail}\n` : ''}${input.issueBasis ? `依据：${input.issueBasis}\n` : ''}` : '';
  const factsBlock = confirmedFacts.length ? `【已确认事实】\n${confirmedFacts.join('\n')}` : '';
  const ragBlock = retrievalContext ? `【平台知识资产检索结果】\n${retrievalContext}` : '';
  const projectBlock = `【项目基本信息】\n名称：${detail.project.name}\n采购方式：${detail.project.procurementMethod || '待补充'}\n标的：${detail.project.target || '待补充'}\n预算：${detail.project.budget || '待补充'}`;

  return [intentInstruction, projectBlock, factsBlock, sectionBlock, issueBlock, ragBlock, `【用户请求】\n${input.prompt}`, '请用中文回答；如果需要输出可直接替换章节的正文，请只输出正文 markdown，不要加解释性开头。'].filter(Boolean).join('\n\n');
}

function intentToInstruction(intent?: TBidProjectAssistantIntent): string {
  if (intent === 'rewriteSection') return '你的任务：改写当前章节，保持事实不变，语气更正式，结构清晰。直接输出章节 markdown。';
  if (intent === 'twoAlternatives') return '你的任务：为当前章节生成两个备选写法，用「方案 A / 方案 B」区分，每个都是完整可用的 markdown 段落。';
  if (intent === 'explainSection') return '你的任务：用一段自然语言，向文件编制人员解释当前章节包含哪些内容、依据是什么，帮助他判断是否需要修改。';
  if (intent === 'explainIssue') return '你的任务：解释这条合规审查问题为什么会被判定为风险，引用具体依据。';
  if (intent === 'fixIssue') return '你的任务：针对这条合规审查问题，生成一段可直接替换的修复文本，附上依据说明。请输出：\n\n### 修复文本\n<可落文正文>\n\n### 依据说明\n<引用条款/规则>';
  return '你的任务：作为招标文件编制助手，认真回答用户的问题，必要时给出可以落到文档里的段落。';
}

function buildAssistantFallbackContent(input: IBidProjectAssistantChatInput): string {
  return ['当前没有可用的 AI 模型响应，以下为兜底提示：', `请求：${input.prompt}`, '建议：', '- 检查是否已配置 Sudorouter 凭据或平台 assistant', '- 若在离线场景演示，可先手动改写章节，稍后再让 AI 复核。'].join('\n');
}

function withBidProjectAiTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('bid project ai timeout'));
    }, BID_PROJECT_AI_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function createFallbackSectionResult(sectionKey: TBidProjectAiSectionKey, markdown: string): IBidProjectAiSectionResult {
  return {
    sectionKey,
    title: AI_SECTION_TITLES[sectionKey],
    markdown,
    fallbackUsed: true,
  };
}

function buildBidProjectAiQuery(detail: IBidProjectDetail, sectionKey: TBidProjectAiSectionKey, fallbackMarkdown: string, retrievalContext: string): string {
  const project = detail.project;
  const sourceSummaries =
    detail.sources
      .filter((source) => source.summary)
      .map((source) => `- ${source.fileName}: ${source.summary}`)
      .join('\n') || '- 暂无材料摘要';
  const confirmedFacts =
    detail.facts
      .filter((fact) => fact.status === 'confirmed')
      .map((fact) => `- ${fact.fieldName}: ${fact.candidateValue}`)
      .join('\n') || '- 暂无已确认字段';
  const pendingSupplements = buildPendingSupplements(detail);
  const assetHits = Array.from(new Set(detail.sections.flatMap((section) => section.assetHits.map((assetHit) => assetHit.label)))).join('、') || '历史模板库、条款库、行业知识库、评审规则库';
  const sourceOrigins = Array.from(new Set(detail.sources.map((source) => source.origin))).join('、') || 'upload';

  return [
    `你正在编写中国联通直接采购文件的“${AI_SECTION_TITLES[sectionKey]}”章节。`,
    '请直接输出该章节的 Markdown 正文，不要输出章节标题，不要输出解释，不要加 ``` 代码块。',
    '必须基于已提供的信息生成；没有依据的内容不要编造，不确定项请保留“待补充”或审慎措辞。',
    '',
    '项目基础信息：',
    `- 项目名称：${project.name || '待补充'}`,
    `- 采购人：${project.company || '待补充'}`,
    `- 预算：${project.budget || '待补充'}`,
    `- 项目类型：${project.projectType || '待补充'}`,
    `- 采购标的：${project.target || '待补充'}`,
    `- 服务期限：${project.duration || '待补充'}`,
    `- 采购方式：${project.procurementMethod || '待补充'}`,
    `- 备注：${project.remark || '待补充'}`,
    '',
    `来源系统输入：${sourceOrigins}`,
    `已命中的结构化资产：${assetHits}`,
    '',
    '材料摘要：',
    sourceSummaries,
    '',
    '已确认字段：',
    confirmedFacts,
    '',
    '待补充事项：',
    pendingSupplements,
    '',
    '知识库检索命中：',
    retrievalContext || '- 当前未命中可用知识片段',
    '',
    '规则版基线正文：',
    fallbackMarkdown,
    '',
    `请重写为更完整、正式、适合招标/采购文件场景的“${AI_SECTION_TITLES[sectionKey]}”章节 Markdown 正文。`,
  ].join('\n');
}

function normalizeAiMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return '';

  const withoutFence = trimmed
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  return withoutFence.replace(/^##\s+.+$/m, '').trim();
}

async function generateBidProjectDirectAiSection(args: { detail: IBidProjectDetail; query: string; sectionKey: TBidProjectAiSectionKey }): Promise<IBidProjectAiSectionResult | null> {
  try {
    const runtime = await resolveBidProjectChatRuntime();
    if (!runtime) return null;
    const startedAt = Date.now();
    const requestBody = JSON.stringify({
      model: runtime.model,
      messages: [
        {
          role: 'system',
          content: '你是资深通信行业采购文件编制专家，擅长输出正式、完整、可直接落文的中文招标/采购章节。只能基于已提供信息写作；不得编造未给出的事实。',
        },
        {
          role: 'user',
          content: args.query,
        },
      ],
    });
    const { stdout } = await safeExecFile('curl', ['-sS', '-X', 'POST', `${runtime.baseUrl.replace(/\/+$/, '')}/chat/completions`, '-H', `Authorization: Bearer ${runtime.apiKey}`, '-H', 'Content-Type: application/json', '-d', requestBody], { timeout: BID_PROJECT_AI_TIMEOUT_MS });
    const payload = JSON.parse(stdout) as {
      error?: { message?: string };
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };
    if (payload.error?.message) return null;
    const raw = payload.choices?.[0]?.message?.content;
    const text = Array.isArray(raw)
      ? raw
          .filter((item) => item?.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text)
          .join('\n')
      : typeof raw === 'string'
        ? raw
        : '';
    const markdown = normalizeAiMarkdown(text);
    if (!markdown) return null;

    return {
      sectionKey: args.sectionKey,
      title: AI_SECTION_TITLES[args.sectionKey],
      markdown,
      fallbackUsed: false,
      mode: 'agent-chat',
      elapsedMs: Date.now() - startedAt,
    };
  } catch {
    return null;
  }
}

function readBidProjectAiModel(): string {
  try {
    const config = JSON.parse(fsSync.readFileSync(SCODE_CONFIG_PATH, 'utf-8')) as { default_model?: string };
    if (typeof config.default_model === 'string' && config.default_model.trim()) {
      return config.default_model.trim();
    }
  } catch {
    // Ignore and continue.
  }

  try {
    const settings = JSON.parse(fsSync.readFileSync(SCODE_SETTINGS_PATH, 'utf-8')) as { model?: string };
    if (typeof settings.model === 'string' && settings.model.trim()) {
      return settings.model.trim();
    }
  } catch {
    // Ignore and continue.
  }

  return BID_PROJECT_AI_MODEL_FALLBACK;
}

function buildProjectCode(project: IBidProjectEntity): string {
  return `SW-${new Date(project.createdAt).getFullYear()}-${simpleHash(project.id).toUpperCase()}`;
}

function formatChineseDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
}

function pickContactName(detail: IBidProjectDetail): string | null {
  return matchFirst(detail, /(联系人|联 系 人)[:：]\s*([^\n，,；; ]+)/i);
}

function pickContactPhone(detail: IBidProjectDetail): string | null {
  return matchFirst(detail, /(电话|联系电话|联系方式)[:：]\s*([0-9-]{7,20})/i);
}

function pickContactEmail(detail: IBidProjectDetail): string | null {
  return matchFirst(detail, /(邮箱|电子邮箱)[:：]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i, 2);
}

function pickLocation(detail: IBidProjectDetail): string | null {
  return matchFirst(detail, /(地点|服务地点|实施地点)[:：]\s*(.+)/i);
}

function matchFirst(detail: IBidProjectDetail, regex: RegExp, groupIndex: number = 2): string | null {
  const texts = detail.sources.map((source) => source.extractedText || '').filter(Boolean);
  for (const text of texts) {
    const match = text.match(regex);
    if (match?.[groupIndex]) {
      return match[groupIndex].trim();
    }
  }
  return null;
}

function buildQualificationItems(detail: IBidProjectDetail): string {
  const budget = detail.project.budget || '待补充';
  return ['- 应答人须为在中华人民共和国境内依法设立并合法存续的独立法人或其他组织。', '- 应答人须具备完成本项目所需的技术能力、实施能力和服务保障能力。', '- 应答人须提供与本项目相关的资格证明、业绩证明和承诺文件。', `- 应答报价应与预算/限价 ${budget} 保持一致性，并在应答文件中完整说明。`].join(
    '\n'
  );
}

function buildPendingSupplements(detail: IBidProjectDetail): string {
  const items: string[] = [];

  if (!pickContactName(detail)) items.push('- 待补充项目联系人姓名。');
  if (!pickContactPhone(detail)) items.push('- 待补充项目联系人电话。');
  if (!pickContactEmail(detail)) items.push('- 待补充项目联系人电子邮箱。');
  if (!pickLocation(detail)) items.push('- 待补充项目实施或应答文件递交地点。');
  if (!detail.project.remark) items.push('- 待补充采购代理机构、付款安排等特别说明。');

  return items.length > 0 ? items.join('\n') : '- 当前已形成基础编制稿，建议补充采购代理机构、具体时间节点和最终付款安排。';
}

function mapProjectRow(row: any): IBidProjectEntity {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    budget: row.budget,
    projectType: row.project_type,
    target: row.target,
    duration: row.duration,
    procurementMethod: row.procurement_method,
    remark: row.remark,
    status: row.status,
    selectedTemplate: row.selected_template,
    currentDraftId: row.current_draft_id,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSourceRow(row: any): IBidProjectSourceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    filePath: row.file_path,
    mimeType: row.mime_type,
    size: row.size,
    parseStatus: row.parse_status,
    parseError: row.parse_error,
    extractedText: row.extracted_text,
    summary: row.summary,
    origin: row.origin || 'upload',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFactRow(row: any): IBidProjectFactRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    fieldName: row.field_name,
    candidateValue: row.candidate_value,
    confidence: row.confidence,
    sourceFileId: row.source_file_id,
    sourceSnippet: row.source_snippet,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDraftRow(row: any): IBidProjectDraftRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    markdown: row.markdown,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FACT_FIELD_TO_COLUMN: Record<TBidProjectFactFieldName, string> = {
  name: 'name',
  company: 'company',
  budget: 'budget',
  projectType: 'project_type',
  target: 'target',
  duration: 'duration',
  procurementMethod: 'procurement_method',
};

export const bidProjectService = new BidProjectService();
