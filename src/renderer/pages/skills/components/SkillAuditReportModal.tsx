/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Modal } from '@arco-design/web-react';
import { Close, Shield } from '@icon-park/react';
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
        <div className='flex items-center justify-between mb-12px'>
          <div className='flex items-center gap-8px'>
            <Shield size='16' className='text-success' />
            <span className='font-semibold text-15px text-foreground'>{t('settings.skill.audit.reportTitle', '安全审计报告')}</span>
            <span className='text-12px text-tertiary'>— {skillName}</span>
          </div>
          <div className='w-28px h-28px f-center rd-full bg-fill-2 hover:bg-fill-3 cursor-pointer transition-colors text-secondary' onClick={onClose}>
            <Close size='14' />
          </div>
        </div>

        {/* Audit summary card */}
        <SkillAuditSummary skillName={skillName} onViewDetails={onViewAuditDetails ? () => onViewAuditDetails(skillName) : undefined} />
      </div>
    </Modal>
  );
};
