import { Button, Dropdown, Input, Menu, Modal, Tooltip } from '@arco-design/web-react';
import { DeleteOne, EditOne, Export, Pushpin, Right } from '@icon-park/react';
import classNames from 'classnames';
import { Info, MessageSquare, MoreHorizontal, Plus, Users } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import DirectorySelectionModal from '@/renderer/components/DirectorySelectionModal';
import { cleanupSiderTooltips } from '@/renderer/utils/siderTooltip';
import TeamCreateModal from '@/renderer/pages/team/components/TeamCreateModal';
import { useTeamExport } from '@/renderer/pages/team/hooks/useTeamExport';
import { useTeamHistoryActions } from '@/renderer/pages/team/hooks/useTeamHistoryActions';
import { useTeams } from '@/renderer/pages/team/hooks/useTeams';
import type { TTeam } from '@/renderer/pages/team/types';

const TEAM_SECTION_EXPANDED_KEY = 'sudowork_team_section_expanded';

export default function TeamSiderSection({ onSessionClick }: ITeamSiderSectionProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { teams, mutate } = useTeams();
  const [isExpanded, setIsExpanded] = useState<boolean>(() => localStorage.getItem(TEAM_SECTION_EXPANDED_KEY) === 'true');
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [dropdownVisibleId, setDropdownVisibleId] = useState<string | null>(null);
  const { exportTargetPath, isExportVisible, isExportLoading, isExportFinished, isDirectorySelectorVisible, setIsDirectorySelectorVisible, onOpenExport, onCloseExport, onSelectExportFolder, onSelectExportDirectoryFromModal, onConfirmExport } = useTeamExport();
  const { isRenameVisible, isRenameLoading, renameName, setRenameName, onTogglePin, onRenameStart, onRenameCancel, onRenameConfirm, onDeleteTeam } = useTeamHistoryActions({
    mutate,
    onDeleted: (team) => {
      if (pathname.startsWith(`/app/team/${team.id}`)) {
        void navigate('/guid');
      }
    },
  });

  useEffect(() => {
    localStorage.setItem(TEAM_SECTION_EXPANDED_KEY, String(isExpanded));
  }, [isExpanded]);

  const onToggleExpanded = useCallback(() => {
    setIsExpanded((value) => !value);
  }, []);

  const onOpenCreate = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setIsCreateVisible(true);
  }, []);

  const onCloseCreate = useCallback(() => {
    setIsCreateVisible(false);
  }, []);

  const onCreated = useCallback(
    (teamId: string) => {
      void mutate();
      void navigate(`/app/team/${teamId}`);
      onSessionClick?.();
    },
    [mutate, navigate, onSessionClick]
  );

  const onTeamClick = useCallback(
    (team: TTeam) => {
      cleanupSiderTooltips();
      setDropdownVisibleId(null);
      void navigate(`/app/team/${team.id}`);
      onSessionClick?.();
    },
    [navigate, onSessionClick]
  );

  const onMenuAction = useCallback(
    (key: string, team: TTeam) => {
      setDropdownVisibleId(null);
      if (key === 'pin') {
        void onTogglePin(team);
        return;
      }
      if (key === 'rename') {
        onRenameStart(team);
        return;
      }
      if (key === 'export') {
        void onOpenExport(team);
        return;
      }
      if (key === 'delete') {
        onDeleteTeam(team);
      }
    },
    [onDeleteTeam, onOpenExport, onRenameStart, onTogglePin]
  );

  return (
    <div className='flex flex-col gap-0.5'>
      <div className='group/team rd-[10px] relative flex h-10 w-full box-border cursor-pointer items-center gap-3 border-0 bg-transparent pl-3 pr-2 text-left outline-none transition-colors text-secondary hover:bg-hover hover:text-foreground' onClick={onToggleExpanded}>
        <span className='translate-y-px inline-flex h-5 w-5 shrink-0 items-center justify-center'>
          <Users size={20} strokeWidth={1.8} className='block leading-none' />
        </span>
        <span className='min-w-0 flex-1 truncate text-14px leading-22px font-500'>{t('common.siderMenu.team')}</span>
        <span className='flex w-3 shrink-0 items-center justify-center opacity-0 group-hover/team:opacity-100 transition-opacity text-secondary'>
          <Right theme='outline' size={12} className={classNames('transition-transform duration-150', { 'rotate-90': isExpanded })} />
        </span>
        <Tooltip content={t('team.list.createButton')} position='top'>
          <span className='size-8 shrink-0 f-center rd-8px hover:bg-fill-2 text-secondary hover:text-foreground transition-colors' onClick={onOpenCreate}>
            <Plus size={16} strokeWidth={1.8} />
          </span>
        </Tooltip>
      </div>

      {isExpanded && (
        <div className='ml-3 flex flex-col gap-0.5'>
          {teams.map((team) => {
            const isSelected = pathname.startsWith(`/app/team/${team.id}`);
            const isMenuVisible = dropdownVisibleId === team.id;
            return (
              <div
                key={team.id}
                className={classNames('group/team-item chat-history__item px-3 py-2 rd-8px flex justify-start items-center cursor-pointer relative overflow-hidden min-w-0 transition-colors', {
                  'hover:bg-hover': !isSelected,
                  '!bg-active conversation-item--selected': isSelected,
                })}
                onClick={() => onTeamClick(team)}
              >
                <MessageSquare size={18} strokeWidth={1.8} className='shrink-0 text-secondary' />
                <div className={classNames('h-6 min-w-0 flex-1 ml-2.5', team.pinned || isMenuVisible ? 'mr-9' : 'group-hover/team-item:mr-9')}>
                  <Tooltip content={team.name} trigger='hover' position='top'>
                    <div className={classNames('overflow-hidden text-ellipsis block w-full text-14px lh-24px whitespace-nowrap min-w-0 group-hover/team-item:text-1', isSelected ? 'text-1 font-medium' : 'text-2')}>{team.name}</div>
                  </Tooltip>
                </div>
                <div
                  className={classNames('absolute right-0 top-0 h-full items-center justify-end pr-2', {
                    flex: team.pinned || isMenuVisible,
                    'hidden group-hover/team-item:flex': !team.pinned && !isMenuVisible,
                  })}
                  style={{ backgroundImage: 'linear-gradient(to right, transparent, var(--row-fade) 50%)' }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {team.pinned && !isMenuVisible && (
                    <span className='f-center text-secondary group-hover/team-item:hidden pr-1'>
                      <Pushpin theme='outline' size='16' />
                    </span>
                  )}
                  <Dropdown
                    droplist={
                      <Menu onClickMenuItem={(key) => onMenuAction(key, team)}>
                        <Menu.Item key='pin'>
                          <div className='flex items-center gap-2'>
                            <Pushpin theme='outline' size='14' />
                            <span>{team.pinned ? t('team.actions.unpin') : t('team.actions.pin')}</span>
                          </div>
                        </Menu.Item>
                        <Menu.Item key='rename'>
                          <div className='flex items-center gap-2'>
                            <EditOne theme='outline' size='14' />
                            <span>{t('team.actions.rename')}</span>
                          </div>
                        </Menu.Item>
                        <Menu.Item key='export'>
                          <div className='flex items-center gap-2'>
                            <Export theme='outline' size='14' />
                            <span>{t('team.actions.export')}</span>
                          </div>
                        </Menu.Item>
                        <Menu.Item key='delete'>
                          <div className='flex items-center gap-2 text-warning'>
                            <DeleteOne theme='outline' size='14' />
                            <span>{t('team.actions.delete')}</span>
                          </div>
                        </Menu.Item>
                      </Menu>
                    }
                    trigger='click'
                    position='br'
                    popupVisible={isMenuVisible}
                    onVisibleChange={(visible) => setDropdownVisibleId(visible ? team.id : null)}
                    getPopupContainer={() => document.body}
                    unmountOnExit={false}
                  >
                    <span
                      className={classNames('f-center cursor-pointer hover:bg-fill-2 rd-4px p-1 transition-colors relative text-foreground', {
                        flex: isMenuVisible,
                        'hidden group-hover/team-item:flex': !isMenuVisible,
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDropdownVisibleId(team.id);
                      }}
                    >
                      <MoreHorizontal size={16} strokeWidth={1.8} />
                    </span>
                  </Dropdown>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TeamCreateModal isVisible={isCreateVisible} onClose={onCloseCreate} onCreated={onCreated} />
      <Modal
        title={t('team.rename.title')}
        visible={isRenameVisible}
        onOk={() => void onRenameConfirm()}
        onCancel={onRenameCancel}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        confirmLoading={isRenameLoading}
        okButtonProps={{ disabled: !renameName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input autoFocus value={renameName} onChange={setRenameName} onPressEnter={() => void onRenameConfirm()} placeholder={t('team.rename.placeholder')} allowClear />
      </Modal>
      <Modal visible={isExportVisible} title={t('team.export.dialogTitle')} onCancel={onCloseExport} footer={null} style={{ borderRadius: '12px' }} alignCenter getPopupContainer={() => document.body}>
        <div className='py-2'>
          <div className='text-14px mb-4 text-secondary'>{t('team.export.dialogDescription')}</div>
          <div className='mb-4 p-4 rounded-12px bg-fill-1'>
            <div className='text-14px mb-2 text-foreground'>{t('team.export.targetFolder')}</div>
            <div className='flex items-center justify-between px-3 py-2.5 rounded-8px border bg-1 cursor-pointer' onClick={() => void onSelectExportFolder()}>
              <span className={classNames('text-14px overflow-hidden text-ellipsis whitespace-nowrap', exportTargetPath ? 'text-foreground' : 'text-secondary')}>{exportTargetPath || t('team.export.selectFolder')}</span>
            </div>
          </div>
          <div className='flex items-center gap-2 mb-5 text-14px text-secondary'>
            <Info size={16} strokeWidth={1.8} />
            <span>{t('team.export.hint')}</span>
          </div>
          <div className='flex gap-3 justify-end'>
            {!isExportFinished && <Button onClick={onCloseExport}>{t('common.cancel')}</Button>}
            <Button type='primary' loading={isExportLoading} onClick={isExportFinished ? onCloseExport : () => void onConfirmExport()}>
              {isExportFinished ? t('common.close') : t('common.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
      <DirectorySelectionModal visible={isDirectorySelectorVisible} onConfirm={onSelectExportDirectoryFromModal} onCancel={() => setIsDirectorySelectorVisible(false)} />
    </div>
  );
}

interface ITeamSiderSectionProps {
  onSessionClick?: () => void;
}
