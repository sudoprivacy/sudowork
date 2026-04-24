/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal } from '@arco-design/web-react';
import { IconLock } from '@arco-design/web-react/icon';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type PwdLoginApprovalDecision = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PwdLoginApprovalModalProps {
  visible: boolean;
  /** Vault entry title (e.g. "GitHub") — shown in the dialog copy and the allow_always label */
  title: string;
  onDecide: (decision: PwdLoginApprovalDecision) => void;
  /** Optional cancel-by-backdrop handler; defaults to reject_once */
  onCancel?: () => void;
}

/**
 * Approval modal for the pwd_login flow (v2 spec §1).
 *
 * Shown when the user types `/login <title>` and no cached allow_always is in
 * place. Backend processes the chosen decision and either caches or rejects.
 *
 * Phase 1 uses a standalone Arco Modal (not inline ACP permission message)
 * because the trigger is user-initiated via slash command, not agent-initiated
 * inside an ACP conversation. Phase 2 agent-triggered flow will reuse
 * MessageAcpPermission.tsx.
 */
export const PwdLoginApprovalModal: React.FC<PwdLoginApprovalModalProps> = ({ visible, title, onDecide, onCancel }) => {
  const { t } = useTranslation();

  const description = t('pwdLogin.approval.description', {
    title,
    defaultValue:
      'Agent wants to log you into {{title}} using your saved credentials. The password will be filled into the login form directly — it won\'t be shown to the agent.',
  });

  const allowOnce = t('pwdLogin.approval.allowOnce', { defaultValue: 'Allow once' });
  const allowAlways = t('pwdLogin.approval.allowAlways', {
    title,
    defaultValue: 'Allow always for {{title}}',
  });
  const rejectOnce = t('pwdLogin.approval.rejectOnce', { defaultValue: 'Reject once' });
  const rejectAlways = t('pwdLogin.approval.rejectAlways', { defaultValue: 'Reject always' });

  const handle = (decision: PwdLoginApprovalDecision): void => {
    onDecide(decision);
  };

  const handleCancel = (): void => {
    if (onCancel) {
      onCancel();
    } else {
      onDecide('reject_once');
    }
  };

  return (
    <Modal
      visible={visible}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconLock style={{ color: 'var(--color-primary-6)' }} />
          <span>{t('pwdLogin.approval.title', { defaultValue: 'Auto-login request' })}</span>
        </div>
      }
      closable
      maskClosable={false}
      onCancel={handleCancel}
      footer={null}
      style={{ width: 480 }}
    >
      <div style={{ padding: '4px 0 12px', color: 'var(--color-text-2)', lineHeight: 1.6 }}>{description}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button type='primary' size='default' onClick={() => handle('allow_once')}>
          {allowOnce}
        </Button>
        <Button type='outline' size='default' onClick={() => handle('allow_always')}>
          {allowAlways}
        </Button>
        <Button type='secondary' size='default' onClick={() => handle('reject_once')}>
          {rejectOnce}
        </Button>
        <Button status='danger' type='text' size='default' onClick={() => handle('reject_always')}>
          {rejectAlways}
        </Button>
      </div>
    </Modal>
  );
};

export default PwdLoginApprovalModal;
