/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Modal } from '@arco-design/web-react';
import { X, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SkillAuditSummary from './SkillAuditSummary';

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
        <div className='flex items-center justify-between mb-3'>
          <div className='flex items-center gap-2'>
            <Shield size={16} className='text-success' />
            <span className='font-semibold text-15px text-foreground'>{t('settings.skill.audit.reportTitle', '安全审计报告')}</span>
            <span className='text-12px text-foreground-tertiary'>— {skillName}</span>
          </div>
          <div className='size-7 f-center rd-full bg-fill-shallow hover:bg-fill-medium cursor-pointer transition-colors text-foreground-secondary' onClick={onClose}>
            <X size={14} />
          </div>
        </div>

        {/* Audit summary card */}
        <SkillAuditSummary skillName={skillName} onViewDetails={onViewAuditDetails ? () => onViewAuditDetails(skillName) : undefined} />
      </div>
    </Modal>
  );
};
