/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Spin } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { skillHub, shell } from '@/common/ipcBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import type { SkillAuditReport, AuditCategorySummary } from '@/common/skillAuditTypes';

/**
 * Displays a summary of the audit results, similar to the screenshot:
 * - Shield icon + title
 * - List of categories with ✅ (safe) or ⚠️ (found N places) indicators
 * - Link to the full report file
 */
export default function SkillAuditSummary({ skillName, onViewDetails }: ISkillAuditSummaryProps) {
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
          <span className='font-medium text-13px text-foreground'>{t('settings.skill.audit.title', '安全审查结果')}</span>
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
          <span className='font-medium text-13px text-foreground'>{t('settings.skill.audit.title', '安全审查结果')}</span>
        </div>
        <div className='text-12px text-tertiary text-center py-12px'>{t('settings.skill.audit.noReport', '暂无审计报告')}</div>
      </div>
    );
  }

  return (
    <div className='bg-fill-1 rd-10px p-14px'>
      {/* Header */}
      <div className='flex items-center gap-6px mb-8px'>
        <Shield size='14' className='text-success' />
        <span className='font-medium text-13px text-foreground'>{t('settings.skill.audit.title', '安全审查结果')}</span>
      </div>

      {/* Summary description */}
      <div className='text-12px text-secondary mb-10px'>{report.hasFindings ? t('settings.skill.audit.summaryWithFindings', '经过安全审查，该技能包存在以下操作：') : t('settings.skill.audit.summaryNoFindings', '经过严格的安全审查，确认该技能包：')}</div>

      {/* Category list */}
      <div className='space-y-6px'>
        {report.categorySummaries.map((summary) => (
          <CategoryRow key={summary.category} summary={summary} />
        ))}
      </div>

      {/* Report path and view details */}
      <div className='mt-10px pt-8px border-t flex items-center justify-between'>
        {report.reportPath && (
          <div className='text-11px truncate flex-1 min-w-0 mr-8px'>
            {t('settings.skill.audit.reportPath', '安全审计报告')}：{report.reportPath}
          </div>
        )}
        <div className='flex items-center flex-shrink-0'>
          {report.reportPath && isElectronDesktop() && (
            <Button type='text' size='mini' icon={<FolderOpen size={12} />} className='!text-11px !text-secondary' onClick={() => void shell.showItemInFolder.invoke(report.reportPath!)}>
              {t('settings.skill.audit.openFilePath', '打开路径')}
            </Button>
          )}
          {onViewDetails && (
            <Button type='text' size='mini' className='!text-11px flex-shrink-0' onClick={onViewDetails}>
              {t('settings.skill.audit.viewDetails', '查看详情')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Single category row in the audit summary.
 * Shows ✅ for safe categories or ⚠️ N处调用 for found categories.
 */
function CategoryRow({ summary }: { summary: AuditCategorySummary }) {
  const { t } = useTranslation();

  if (!summary.found) {
    return (
      <div className='flex items-start gap-6px'>
        <span className='text-14px flex-shrink-0 leading-18px'>✅</span>
        <span className='text-12px text-secondary leading-18px'>
          {t(`settings.skill.audit.no_${summary.category}` as any, {
            label: summary.label,
            defaultValue: '无{{label}}',
          })}
          <span> – {summary.safeDescription}</span>
        </span>
      </div>
    );
  }

  return (
    <div className='flex items-start gap-6px'>
      <span className='text-14px flex-shrink-0 leading-18px'>⚠️</span>
      <span className='text-12px text-secondary leading-18px'>
        {summary.label}
        <span className='text-warning font-medium'>
          {' '}
          ({summary.count} {t('settings.skill.audit.places', '处调用')})
        </span>
        <span className='text-tertiary'> – {summary.foundDescription}</span>
      </span>
    </div>
  );
}

interface ISkillAuditSummaryProps {
  skillName: string;
  /** Called when user clicks "View Details" */
  onViewDetails?: () => void;
}
