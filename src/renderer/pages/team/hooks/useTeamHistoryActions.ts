import { Checkbox, Message, Modal } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TTeam } from '../types';
import { unwrapTeamResult } from '../utils';

export function useTeamHistoryActions({ mutate, onDeleted }: IUseTeamHistoryActionsParams) {
  const { t } = useTranslation();
  const [isRenameVisible, setIsRenameVisible] = useState(false);
  const [isRenameLoading, setIsRenameLoading] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameTeamId, setRenameTeamId] = useState<string | null>(null);

  const onTogglePin = useCallback(
    async (team: TTeam) => {
      try {
        unwrapTeamResult(
          await ipcBridge.team.updateTeam.invoke({
            teamId: team.id,
            updates: {
              pinned: !team.pinned,
              pinned_at: team.pinned ? null : Date.now(),
            },
          })
        );
        void mutate();
      } catch (error) {
        console.error('[TeamHistoryActions] toggle pin failed:', error);
        Message.error(t('team.pin.failed'));
      }
    },
    [mutate, t]
  );

  const onRenameStart = useCallback((team: TTeam) => {
    setRenameTeamId(team.id);
    setRenameName(team.name);
    setIsRenameVisible(true);
  }, []);

  const onRenameCancel = useCallback(() => {
    setIsRenameVisible(false);
    setRenameTeamId(null);
    setRenameName('');
  }, []);

  const onRenameConfirm = useCallback(async () => {
    const nextName = renameName.trim();
    if (!renameTeamId || !nextName) return;

    setIsRenameLoading(true);
    try {
      unwrapTeamResult(await ipcBridge.team.renameTeam.invoke({ teamId: renameTeamId, name: nextName }));
      Message.success(t('team.rename.success'));
      onRenameCancel();
      void mutate();
    } catch (error) {
      console.error('[TeamHistoryActions] rename team failed:', error);
      Message.error(t('team.rename.failed'));
    } finally {
      setIsRenameLoading(false);
    }
  }, [mutate, onRenameCancel, renameName, renameTeamId, t]);

  const onDeleteTeam = useCallback(
    (team: TTeam) => {
      const deleteWorkspaceRef = { current: false };
      const isCustomWorkspace = team.workspace_kind === 'custom' && !!team.workspace;
      Modal.confirm({
        title: t('team.confirm.deleteTeamTitle'),
        content: React.createElement(
          'div',
          null,
          React.createElement('div', null, team.workspace_kind === 'temporary' ? t('team.confirm.deleteTeamTemporary') : t('team.confirm.deleteTeam')),
          isCustomWorkspace &&
            React.createElement(
              Checkbox,
              {
                className: 'mt-3',
                onChange: (checked: boolean) => {
                  deleteWorkspaceRef.current = checked;
                },
              },
              t('team.confirm.deleteWorkspaceOption')
            )
        ),
        okText: t('team.confirm.confirmDelete'),
        cancelText: t('team.confirm.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          try {
            unwrapTeamResult(await ipcBridge.team.removeTeam.invoke({ teamId: team.id, deleteWorkspace: isCustomWorkspace ? deleteWorkspaceRef.current : undefined }));
            Message.success(t('team.confirm.deleteSuccess'));
            onDeleted?.(team);
            void mutate();
          } catch (error) {
            console.error('[TeamHistoryActions] removeTeam failed:', error);
            Message.error(t('team.confirm.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [mutate, onDeleted, t]
  );

  return {
    isRenameVisible,
    isRenameLoading,
    renameName,
    setRenameName,
    onTogglePin,
    onRenameStart,
    onRenameCancel,
    onRenameConfirm,
    onDeleteTeam,
  };
}

interface IUseTeamHistoryActionsParams {
  mutate: () => Promise<TTeam[] | undefined>;
  onDeleted?: (team: TTeam) => void;
}
