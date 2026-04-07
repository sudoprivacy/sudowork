/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkspaceRenameModal - Modal dialog for renaming workspace directories
 * 工作空间重命名弹窗 - 用于重命名工作空间目录
 */

import { ipcBridge } from '@/common';
import { getLastDirectoryName } from '@/renderer/utils/workspace';
import { Input, Message, Modal } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emitter } from '@/renderer/utils/emitter';

interface WorkspaceRenameModalProps {
  visible: boolean;
  workspacePath: string;
  onClose: () => void;
  onSuccess?: (newPath: string) => void;
}

const WorkspaceRenameModal: React.FC<WorkspaceRenameModalProps> = ({ visible, workspacePath, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && workspacePath) {
      setNewName(getLastDirectoryName(workspacePath));
    }
  }, [visible, workspacePath]);

  const handleConfirm = useCallback(async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      Message.warning(t('conversation.workspace.rename.emptyName'));
      return;
    }

    // Don't rename if name hasn't changed
    if (trimmedName === getLastDirectoryName(workspacePath)) {
      onClose();
      return;
    }

    setLoading(true);
    try {
      const result = await ipcBridge.workspaceManage.renameDirectory.invoke({
        oldPath: workspacePath,
        newName: trimmedName,
      });

      if (result.success && result.data?.newPath) {
        Message.success(t('conversation.workspace.rename.success'));
        emitter.emit('chat.history.refresh');
        onSuccess?.(result.data.newPath);
        onClose();
      } else {
        const errorKey = result.error?.includes('Invalid')
          ? 'conversation.workspace.rename.invalidName'
          : result.error?.includes('already exists')
            ? 'conversation.workspace.rename.alreadyExists'
            : 'conversation.workspace.rename.failed';
        Message.error(t(errorKey));
      }
    } catch {
      Message.error(t('conversation.workspace.rename.failed'));
    } finally {
      setLoading(false);
    }
  }, [newName, workspacePath, onClose, onSuccess, t]);

  return (
    <Modal
      visible={visible}
      title={t('conversation.workspace.rename.title')}
      onOk={handleConfirm}
      onCancel={onClose}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={loading}
      okButtonProps={{ disabled: !newName.trim() }}
      style={{ borderRadius: '12px' }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      <div className='py-8px'>
        <Input
          autoFocus
          value={newName}
          onChange={setNewName}
          onPressEnter={handleConfirm}
          placeholder={t('conversation.workspace.rename.placeholder')}
          allowClear
        />
        <div className='mt-8px text-12px text-t-secondary flex items-center gap-4px'>
          <span>&#9888;&#65039;</span>
          <span>{t('conversation.workspace.rename.warning')}</span>
        </div>
      </div>
    </Modal>
  );
};

export default WorkspaceRenameModal;
