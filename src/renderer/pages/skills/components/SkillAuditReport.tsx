/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill Security Audit Report Components
 *
 * Displays audit results in two views:
 * 1. SkillAuditSummary (components/SkillAuditSummary.tsx) — Summary card showing operation categories with ✅/⚠️ indicators
 * 2. SkillAuditDetailModal — Detailed findings modal with code snippets and locations
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Spin, Message } from '@arco-design/web-react';
import { X, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { skillHub } from '@/common/ipcBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { AUDIT_CATEGORY_CONFIG, type SkillAuditReport, type AuditFinding, type AuditCategory } from '@/common/skillAuditTypes';

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
        Message.success(t('settings.skill.audit.rerunSuccess', '重新审计完成'));
      } else {
        Message.error(res.msg || t('settings.skill.audit.rerunFailed', '重新审计失败'));
      }
    } catch (err) {
      console.error('Failed to rerun audit:', err);
      Message.error(t('settings.skill.audit.rerunFailed', '重新审计失败'));
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
        <div className='flex items-center justify-between mb-3'>
          <div className='flex items-center gap-2'>
            <Shield size={16} className='text-success' />
            <span className='font-semibold text-15px text-foreground'>{t('settings.skill.audit.detailTitle', '安全审计详情')}</span>
            <span className='text-12px text-tertiary'>— {skillName}</span>
          </div>
          <div className='flex items-center gap-2'>
            <button type='button' className='text-11px px-2 py-[3px] rd-4px bg-fill-2 hover:bg-fill-3 text-secondary cursor-pointer border-none outline-none transition-colors' onClick={() => void handleRerunAudit()} disabled={loading}>
              {t('settings.skill.audit.rerun', '重新审计')}
            </button>
            <div className='size-7 f-center rd-full bg-fill-2 hover:bg-fill-3 cursor-pointer transition-colors text-secondary' onClick={onClose}>
              <X size={14} />
            </div>
          </div>
        </div>

        {loading ? (
          <div className='flex justify-center py-12'>
            <Spin size={24} />
          </div>
        ) : !report ? (
          <div className='flex flex-col items-center justify-center py-12 text-secondary'>
            <span className='text-13px'>{t('settings.skill.audit.noReport', '暂无审计报告')}</span>
          </div>
        ) : (
          <>
            {/* Info bar */}
            <div className='flex items-center gap-3 mb-3 text-11px text-tertiary'>
              <span>
                {t('settings.skill.audit.scannedFiles', '扫描文件')}：{report.scannedFiles}/{report.totalFiles}
              </span>
              <span>
                {t('settings.skill.audit.totalFindings', '发现')}：{report.findings.length} {t('settings.skill.audit.places', '处调用')}
              </span>
              <span>
                {t('settings.skill.audit.auditTime', '审计时间')}：{new Date(report.auditTime).toLocaleString()}
              </span>
            </div>

            {/* Category filter tabs */}
            <div className='flex gap-1 mb-3 overflow-x-auto pb-0.5 scrollbar-hide flex-shrink-0'>
              <CategoryFilterTab label={t('settings.skill.audit.all', '全部')} count={report.findings.length} active={selectedCategory === 'all'} onClick={() => setSelectedCategory('all')} />
              {report.categorySummaries
                .filter((s) => s.found)
                .map((s) => (
                  <CategoryFilterTab key={s.category} label={s.label} count={s.count} active={selectedCategory === s.category} onClick={() => setSelectedCategory(s.category)} />
                ))}
            </div>

            {/* Findings list */}
            <AionScrollArea className='flex-1 min-h-0'>
              {filteredFindings.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-8 text-tertiary'>
                  <span className='text-12px'>{t('settings.skill.audit.noFindings', '该类别下无发现')}</span>
                </div>
              ) : (
                <div className='space-y-3 pb-4'>
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
  <button
    type='button'
    className={`px-2.5 py-1 rd-16px text-11px cursor-pointer transition-colors whitespace-nowrap flex-shrink-0 border-none outline-none flex items-center gap-1 ${active ? 'bg-primary text-white' : 'bg-fill-2 text-secondary hover:bg-fill-3 hover:text-foreground'}`}
    onClick={onClick}
  >
    {label}
    <span className={`text-10px ${active ? 'text-white/70' : 'text-tertiary'}`}>{count}</span>
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
      <div className='px-3 py-2 bg-fill-2 border-b'>
        <span className='text-12px font-medium text-foreground font-mono'>{file}</span>
        <span className='text-11px text-tertiary ml-2'>
          ({findings.length} {t('settings.skill.audit.places', '处调用')})
        </span>
      </div>

      {/* Findings */}
      <div className='divide-y divide-light'>
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
    <div className='px-3 py-2 hover:bg-fill-2/50 transition-colors'>
      <div className='flex items-center gap-1.5 mb-[3px]'>
        <span className='text-12px'>{categoryEmoji}</span>
        <span className='text-11px text-secondary'>{config.label}</span>
        <span className='text-11px text-tertiary'>·</span>
        <span className='text-11px text-tertiary font-mono'>L{finding.line}</span>
      </div>
      <div className='bg-fill-2 rd-4px px-2 py-1 mb-[3px]'>
        <code className='text-11px text-foreground font-mono break-all leading-relaxed'>{finding.code}</code>
      </div>
      <div className='text-11px text-tertiary'>
        {finding.description}
        {finding.detail && <span className='text-primary ml-1'>→ {finding.detail}</span>}
      </div>
    </div>
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
