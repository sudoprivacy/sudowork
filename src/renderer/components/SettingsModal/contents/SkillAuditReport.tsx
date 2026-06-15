/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill Security Audit Report Components
 *
 * Displays audit results in two views:
 * 1. SkillAuditSummary — Summary card showing operation categories with ✅/⚠️ indicators
 * 2. SkillAuditDetailModal — Detailed findings modal with code snippets and locations
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Spin, Message } from '@arco-design/web-react';
import { Close, Shield, FolderOpen } from '@icon-park/react';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { skillHub, shell } from '@/common/ipcBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import type { SkillAuditReport, AuditFinding, AuditCategorySummary, AuditCategory } from '@/common/skillAuditTypes';
import { AUDIT_CATEGORY_CONFIG } from '@/common/skillAuditTypes';
import { useTranslation } from 'react-i18next';

// ==================== Audit Summary Component ====================

/**
 * Displays a summary of the audit results, similar to the screenshot:
 * - Shield icon + title
 * - List of categories with ✅ (safe) or ⚠️ (found N places) indicators
 * - Link to the full report file
 */
export const SkillAuditSummary: React.FC<{
  skillName: string;
  /** Called when user clicks "View Details" */
  onViewDetails?: () => void;
}> = ({ skillName, onViewDetails }) => {
  const [report, setReport] = useState<SkillAuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isElectronDesktop() || !skillName) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchReport = async () => {
      try {
        const res = await skillHub.getSkillAuditReport.invoke({ skillName });
        if (!cancelled && res.success && res.data) {
          setReport(res.data);
        }
      } catch (err) {
        console.error('Failed to fetch audit report:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchReport();

    return () => {
      cancelled = true;
    };
  }, [skillName]);

  if (loading) {
    return (
      <div className='bg-fill-1 rd-10px p-14px'>
        <div className='flex items-center gap-6px mb-8px'>
          <Shield size='14' className='text-success' />
          <span className='font-medium text-13px text-t-primary'>{t('settings.skill.audit.title', { defaultValue: '安全审查结果' })}</span>
        </div>
        <div className='flex justify-center py-12px'>
          <Spin size={16} />
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className='bg-fill-1 rd-10px p-14px'>
        <div className='flex items-center gap-6px mb-8px'>
          <Shield size='14' className='text-success' />
          <span className='font-medium text-13px text-t-primary'>{t('settings.skill.audit.title', { defaultValue: '安全审查结果' })}</span>
        </div>
        <div className='text-12px text-t-tertiary text-center py-12px'>{t('settings.skill.audit.noReport', { defaultValue: '暂无审计报告' })}</div>
      </div>
    );
  }

  return (
    <div className='bg-fill-1 rd-10px p-14px'>
      {/* Header */}
      <div className='flex items-center gap-6px mb-8px'>
        <Shield size='14' className='text-success' />
        <span className='font-medium text-13px text-t-primary'>{t('settings.skill.audit.title', { defaultValue: '安全审查结果' })}</span>
      </div>

      {/* Summary description */}
      <div className='text-12px text-t-secondary mb-10px'>{report.hasFindings ? t('settings.skill.audit.summaryWithFindings', { defaultValue: '经过安全审查，该技能包存在以下操作：' }) : t('settings.skill.audit.summaryNoFindings', { defaultValue: '经过严格的安全审查，确认该技能包：' })}</div>

      {/* Category list */}
      <div className='space-y-6px'>
        {report.categorySummaries.map((summary) => (
          <CategoryRow key={summary.category} summary={summary} />
        ))}
      </div>

      {/* Report path and view details */}
      <div className='mt-10px pt-8px border-t flex items-center justify-between'>
        {report.reportPath && (
          <div className='text-11px text-t-tertiary truncate flex-1 min-w-0 mr-8px'>
            {t('settings.skill.audit.reportPath', { defaultValue: '安全审计报告' })}：{report.reportPath}
          </div>
        )}
        <div className='flex items-center gap-8px flex-shrink-0'>
          {report.reportPath && isElectronDesktop() && (
            <button
              type='button'
              className='text-11px text-t-secondary hover:text-primary cursor-pointer bg-transparent border-none outline-none whitespace-nowrap flex items-center gap-3px'
              onClick={() => {
                void shell.showItemInFolder.invoke(report.reportPath!);
              }}
            >
              <FolderOpen size='12' />
              {t('settings.skill.audit.openFilePath', { defaultValue: '打开路径' })}
            </button>
          )}
          {onViewDetails && (
            <button type='button' className='text-11px text-primary hover:text-primary-dark cursor-pointer bg-transparent border-none outline-none whitespace-nowrap flex-shrink-0' onClick={onViewDetails}>
              {t('settings.skill.audit.viewDetails', { defaultValue: '查看详情' })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Single category row in the audit summary.
 * Shows ✅ for safe categories or ⚠️ N处调用 for found categories.
 */
const CategoryRow: React.FC<{ summary: AuditCategorySummary }> = ({ summary }) => {
  const { t } = useTranslation();

  if (!summary.found) {
    return (
      <div className='flex items-start gap-6px'>
        <span className='text-14px flex-shrink-0 leading-18px'>✅</span>
        <span className='text-12px text-t-secondary leading-18px'>
          {t(`settings.skill.audit.no_${summary.category}` as any, { defaultValue: `无${summary.label}` })}
          <span className='text-t-tertiary'> – {summary.safeDescription}</span>
        </span>
      </div>
    );
  }

  return (
    <div className='flex items-start gap-6px'>
      <span className='text-14px flex-shrink-0 leading-18px'>⚠️</span>
      <span className='text-12px text-t-secondary leading-18px'>
        {summary.label}
        <span className='text-warning font-medium'>
          {' '}
          ({summary.count} {t('settings.skill.audit.places', { defaultValue: '处调用' })})
        </span>
        <span className='text-t-tertiary'> – {summary.foundDescription}</span>
      </span>
    </div>
  );
};

// ==================== Audit Detail Modal ====================

/**
 * Modal showing detailed audit findings, grouped by category.
 * Each finding shows file path, line number, code snippet, and extracted details.
 */
export const SkillAuditDetailModal: React.FC<{
  skillName: string;
  visible: boolean;
  onClose: () => void;
}> = ({ skillName, visible, onClose }) => {
  const [report, setReport] = useState<SkillAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AuditCategory | 'all'>('all');
  const { t } = useTranslation();

  const fetchReport = useCallback(async () => {
    if (!isElectronDesktop() || !skillName) return;
    setLoading(true);
    try {
      const res = await skillHub.getSkillAuditReport.invoke({ skillName });
      if (res.success && res.data) {
        setReport(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch audit report:', err);
    } finally {
      setLoading(false);
    }
  }, [skillName]);

  const handleRerunAudit = useCallback(async () => {
    if (!isElectronDesktop() || !skillName) return;
    setLoading(true);
    try {
      const res = await skillHub.runSkillAudit.invoke({ skillName });
      if (res.success && res.data) {
        setReport(res.data);
        Message.success(t('settings.skill.audit.rerunSuccess', { defaultValue: '重新审计完成' }));
      } else {
        Message.error(res.msg || t('settings.skill.audit.rerunFailed', { defaultValue: '重新审计失败' }));
      }
    } catch (err) {
      console.error('Failed to rerun audit:', err);
      Message.error(t('settings.skill.audit.rerunFailed', { defaultValue: '重新审计失败' }));
    } finally {
      setLoading(false);
    }
  }, [skillName, t]);

  useEffect(() => {
    if (visible) {
      void fetchReport();
      setSelectedCategory('all');
    } else {
      setReport(null);
    }
  }, [visible, fetchReport]);

  const filteredFindings = report?.findings.filter((f) => selectedCategory === 'all' || f.category === selectedCategory) || [];

  // Group findings by file
  const groupedByFile = new Map<string, AuditFinding[]>();
  for (const finding of filteredFindings) {
    const existing = groupedByFile.get(finding.file) || [];
    existing.push(finding);
    groupedByFile.set(finding.file, existing);
  }

  return (
    <Modal visible={visible} onCancel={onClose} footer={null} closable={false} maskClosable style={{ width: 560 }} className='skill-audit-detail-modal' wrapStyle={{ zIndex: 1100 }} maskStyle={{ zIndex: 1100 }}>
      <div className='flex flex-col max-h-80vh'>
        {/* Header */}
        <div className='flex items-center justify-between mb-12px'>
          <div className='flex items-center gap-8px'>
            <Shield size='16' className='text-success' />
            <span className='font-semibold text-15px text-t-primary'>{t('settings.skill.audit.detailTitle', { defaultValue: '安全审计详情' })}</span>
            <span className='text-12px text-t-tertiary'>— {skillName}</span>
          </div>
          <div className='flex items-center gap-8px'>
            <button type='button' className='text-11px px-8px py-3px rd-4px bg-fill-2 hover:bg-fill-3 text-t-secondary cursor-pointer border-none outline-none transition-colors' onClick={() => void handleRerunAudit()} disabled={loading}>
              {t('settings.skill.audit.rerun', { defaultValue: '重新审计' })}
            </button>
            <div className='w-28px h-28px flex items-center justify-center rd-full bg-fill-2 hover:bg-fill-3 cursor-pointer transition-colors text-t-secondary' onClick={onClose}>
              <Close size='14' />
            </div>
          </div>
        </div>

        {loading ? (
          <div className='flex justify-center py-48px'>
            <Spin size={24} />
          </div>
        ) : !report ? (
          <div className='flex flex-col items-center justify-center py-48px text-t-secondary'>
            <span className='text-13px'>{t('settings.skill.audit.noReport', { defaultValue: '暂无审计报告' })}</span>
          </div>
        ) : (
          <>
            {/* Info bar */}
            <div className='flex items-center gap-12px mb-12px text-11px text-t-tertiary'>
              <span>
                {t('settings.skill.audit.scannedFiles', { defaultValue: '扫描文件' })}：{report.scannedFiles}/{report.totalFiles}
              </span>
              <span>
                {t('settings.skill.audit.totalFindings', { defaultValue: '发现' })}：{report.findings.length} {t('settings.skill.audit.places', { defaultValue: '处调用' })}
              </span>
              <span>
                {t('settings.skill.audit.auditTime', { defaultValue: '审计时间' })}：{new Date(report.auditTime).toLocaleString()}
              </span>
            </div>

            {/* Category filter tabs */}
            <div className='flex gap-4px mb-12px overflow-x-auto pb-2px scrollbar-hide flex-shrink-0'>
              <CategoryFilterTab label={t('settings.skill.audit.all', { defaultValue: '全部' })} count={report.findings.length} active={selectedCategory === 'all'} onClick={() => setSelectedCategory('all')} />
              {report.categorySummaries
                .filter((s) => s.found)
                .map((s) => (
                  <CategoryFilterTab key={s.category} label={s.label} count={s.count} active={selectedCategory === s.category} onClick={() => setSelectedCategory(s.category)} />
                ))}
            </div>

            {/* Findings list */}
            <AionScrollArea className='flex-1 min-h-0'>
              {filteredFindings.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-32px text-t-tertiary'>
                  <span className='text-12px'>{t('settings.skill.audit.noFindings', { defaultValue: '该类别下无发现' })}</span>
                </div>
              ) : (
                <div className='space-y-12px pb-16px'>
                  {Array.from(groupedByFile.entries()).map(([file, findings]) => (
                    <FileFindings key={file} file={file} findings={findings} />
                  ))}
                </div>
              )}
            </AionScrollArea>
          </>
        )}
      </div>
    </Modal>
  );
};

// ==================== Sub-components ====================

const CategoryFilterTab: React.FC<{
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ label, count, active, onClick }) => (
  <button type='button' className={`px-10px py-4px rd-16px text-11px cursor-pointer transition-colors whitespace-nowrap flex-shrink-0 border-none outline-none flex items-center gap-4px ${active ? 'bg-primary text-white' : 'bg-fill-2 text-t-secondary hover:bg-fill-3 hover:text-t-primary'}`} onClick={onClick}>
    {label}
    <span className={`text-10px ${active ? 'text-white/70' : 'text-t-tertiary'}`}>{count}</span>
  </button>
);

/**
 * Group of findings for a single file.
 */
const FileFindings: React.FC<{
  file: string;
  findings: AuditFinding[];
}> = ({ file, findings }) => {
  const { t } = useTranslation();

  return (
    <div className='bg-fill-1 rd-8px overflow-hidden'>
      {/* File header */}
      <div className='px-12px py-8px bg-fill-2 border-b'>
        <span className='text-12px font-medium text-t-primary font-mono'>{file}</span>
        <span className='text-11px text-t-tertiary ml-2'>
          ({findings.length} {t('settings.skill.audit.places', { defaultValue: '处调用' })})
        </span>
      </div>

      {/* Findings */}
      <div className='divide-y divide-[var(--border-light)]'>
        {findings.map((finding) => (
          <FindingRow key={finding.id} finding={finding} />
        ))}
      </div>
    </div>
  );
};

/**
 * Single finding row showing line number, code, and description.
 */
const FindingRow: React.FC<{ finding: AuditFinding }> = ({ finding }) => {
  const config = AUDIT_CATEGORY_CONFIG[finding.category];
  const categoryEmoji = getCategoryEmoji(finding.category);

  return (
    <div className='px-12px py-8px hover:bg-fill-2/50 transition-colors'>
      <div className='flex items-center gap-6px mb-3px'>
        <span className='text-12px'>{categoryEmoji}</span>
        <span className='text-11px text-t-secondary'>{config.label}</span>
        <span className='text-11px text-t-tertiary'>·</span>
        <span className='text-11px text-t-tertiary font-mono'>L{finding.line}</span>
      </div>
      <div className='bg-fill-2 rd-4px px-8px py-4px mb-3px'>
        <code className='text-11px text-t-primary font-mono break-all leading-relaxed'>{finding.code}</code>
      </div>
      <div className='text-11px text-t-tertiary'>
        {finding.description}
        {finding.detail && <span className='text-primary ml-4px'>→ {finding.detail}</span>}
      </div>
    </div>
  );
};

// ==================== Standalone Audit Report Modal ====================

/**
 * Standalone modal that shows ONLY the audit summary card.
 * Used after importing a custom skill — avoids showing the full skill detail page.
 * Includes a "View Details" button to open the full audit detail modal.
 */
export const SkillAuditReportModal: React.FC<{
  skillName: string;
  visible: boolean;
  onClose: () => void;
  /** Called when user clicks "View Audit Details" to open the detailed findings modal */
  onViewAuditDetails?: (skillName: string) => void;
}> = ({ skillName, visible, onClose, onViewAuditDetails }) => {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} onCancel={onClose} footer={null} closable={false} maskClosable style={{ width: 480 }} className='skill-audit-report-modal' wrapStyle={{ zIndex: 2000 }} maskStyle={{ zIndex: 2000 }} getPopupContainer={() => document.body}>
      <div className='flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between mb-12px'>
          <div className='flex items-center gap-8px'>
            <Shield size='16' className='text-success' />
            <span className='font-semibold text-15px text-t-primary'>{t('settings.skill.audit.reportTitle', { defaultValue: '安全审计报告' })}</span>
            <span className='text-12px text-t-tertiary'>— {skillName}</span>
          </div>
          <div className='w-28px h-28px flex items-center justify-center rd-full bg-fill-2 hover:bg-fill-3 cursor-pointer transition-colors text-t-secondary' onClick={onClose}>
            <Close size='14' />
          </div>
        </div>

        {/* Audit summary card */}
        <SkillAuditSummary skillName={skillName} onViewDetails={onViewAuditDetails ? () => onViewAuditDetails(skillName) : undefined} />
      </div>
    </Modal>
  );
};

function getCategoryEmoji(category: AuditCategory): string {
  switch (category) {
    case 'external_api':
      return '🌐';
    case 'network':
      return '🔗';
    case 'sensitive_data':
      return '🔑';
    case 'filesystem':
      return '📁';
    case 'executable':
      return '⚡';
    default:
      return '📋';
  }
}
