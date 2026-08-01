/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Checkbox, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import { LoaderCircle, MessageCircleMore, Pencil, Pin, Trash2, Upload } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TChatConversation } from '@/common/storage';
import FlexFullContainer from '@/renderer/components/FlexFullContainer';
import { useTerminalActiveCount } from '@/renderer/hooks/useTerminalActiveCount';
import CronStatusIcon from '@/renderer/pages/cron/components/CronStatusIcon';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@/renderer/utils/siderTooltip';
import { CronJobStatusEnums } from '@/renderer/utils/enum';
import { isConversationPinned } from './utils/groupingHelpers';
import type { ConversationRowProps } from './types';

const ConversationRow: React.FC<ConversationRowProps> = (props) => {
  const { conversation, collapsed, tooltipEnabled, batchMode, checked, selected, menuVisible } = props;
  const { onToggleChecked, onConversationClick, onOpenMenu, onMenuVisibleChange, onEditStart, onDelete, onExport, onTogglePin, getJobStatus } = props;
  const { t } = useTranslation();

  // Check if this is a Moss session
  const isMossSession = 'isMossSession' in conversation && conversation.isMossSession === true;

  // For Moss sessions, use isPinned property; for local conversations, use isConversationPinned
  const isPinned = isMossSession ? ((conversation as { isPinned?: boolean }).isPinned ?? false) : isConversationPinned(conversation as TChatConversation);
  const cronStatus = getJobStatus(conversation.id);
  const ptyActiveCount = useTerminalActiveCount(conversation.id);
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  const inlineNameTooltipEnabled = !collapsed && !!conversation.name;

  const actionReserveClass = isPinned ? 'mr-9' : menuVisible ? 'mr-9' : 'group-hover:mr-9';

  const renderLeadingIcon = () => {
    if (cronStatus != CronJobStatusEnums.None) {
      return <CronStatusIcon status={cronStatus} size={16} className='shrink-0' />;
    }

    return <MessageCircleMore size={16} strokeWidth={2} className='shrink-0 text-foreground-secondary' />;
  };

  const handleRowClick = () => {
    if (batchMode || selected) {
      cleanupSiderTooltips();
    }
    if (batchMode) {
      onToggleChecked(conversation as TChatConversation);
      return;
    }
    onConversationClick(conversation);
  };

  return (
    <Tooltip key={conversation.id} {...siderTooltipProps} content={conversation.name || t('conversation.welcome.newConversation')} position='right'>
      <div
        id={'c-' + conversation.id}
        className={classNames('chat-history__item h-9 px-2.5 rounded-lg flex justify-start items-center group cursor-pointer relative overflow-hidden shrink-0 conversation-item min-w-0 transition-colors', {
          'hover:bg-fill-medium': !batchMode,
          'conversation-item--selected': selected,
          'bg-fill-default': batchMode && checked,
        })}
        onClick={handleRowClick}
      >
        {batchMode && (
          <span
            className='mr-2 f-center'
            onClick={(event) => {
              event.stopPropagation();
              onToggleChecked(conversation as TChatConversation);
            }}
          >
            <Checkbox checked={checked} />
          </span>
        )}
        {renderLeadingIcon()}
        {ptyActiveCount > 0 && (
          <Tooltip mini content={t('conversation.history.terminalRunning', { count: ptyActiveCount, defaultValue: '{{count}} terminal still running' })}>
            <span className='f-center ml-1.5 collapsed-hidden text-brand'>
              <LoaderCircle size={12} className='animate-spin' />
            </span>
          </Tooltip>
        )}
        <FlexFullContainer className={classNames('h-5 min-w-0 flex-1 collapsed-hidden ml-2.5', actionReserveClass)}>
          <Tooltip content={conversation.name} disabled={!inlineNameTooltipEnabled} trigger='hover' popupVisible={inlineNameTooltipEnabled ? undefined : false} unmountOnExit popupHoverStay={false} position='top'>
            <div className={classNames('chat-history__item-name overflow-hidden text-ellipsis block w-full text-sm leading-5 whitespace-nowrap min-w-0 group-hover:text-foreground', selected && !batchMode ? 'text-foreground font-500' : 'text-foreground-secondary')}>{conversation.name}</div>
          </Tooltip>
        </FlexFullContainer>
        {!batchMode && (
          <div
            className={classNames('absolute right-0 top-0 h-full items-center justify-end !collapsed-hidden pr-2', {
              flex: isPinned || menuVisible,
              'hidden group-hover:flex': !isPinned && !menuVisible,
            })}
            style={{
              backgroundImage: `linear-gradient(to right, transparent, var(--row-fade) 50%)`,
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {isPinned && !menuVisible && (
              <span className='f-center text-foreground-secondary group-hover:hidden pr-1'>
                <Pin size={16} strokeWidth={2} />
              </span>
            )}
            <Dropdown
              droplist={
                <Menu
                  onClickMenuItem={(key) => {
                    if (key === 'pin') {
                      onTogglePin(conversation);
                      return;
                    }
                    if (key === 'rename') {
                      onEditStart(conversation);
                      return;
                    }
                    if (key === 'export') {
                      onExport(conversation as TChatConversation);
                      return;
                    }
                    if (key === 'delete') {
                      onDelete(conversation);
                    }
                  }}
                >
                  {/* Pin menu - available for both local and Moss sessions */}
                  <Menu.Item key='pin'>
                    <div className='flex items-center gap-2'>
                      <Pin size={16} strokeWidth={2} className='shrink-0 text-foreground-secondary' />
                      <span>{isPinned ? t('conversation.history.unpin') : t('conversation.history.pin')}</span>
                    </div>
                  </Menu.Item>
                  {/* Rename menu - available for all sessions (including Moss sessions saved locally) */}
                  <Menu.Item key='rename'>
                    <div className='flex items-center gap-2'>
                      <Pencil size={16} strokeWidth={2} className='shrink-0 text-foreground-secondary' />
                      <span>{t('conversation.history.rename')}</span>
                    </div>
                  </Menu.Item>
                  {/* Export menu - only for local sessions */}
                  {!isMossSession && (
                    <Menu.Item key='export'>
                      <div className='flex items-center gap-2'>
                        <Upload size={16} strokeWidth={2} className='shrink-0 text-foreground-secondary' />
                        <span>{t('conversation.history.export')}</span>
                      </div>
                    </Menu.Item>
                  )}
                  <Menu.Item key='delete'>
                    <div className='flex items-center gap-2 text-destructive'>
                      <Trash2 size={16} strokeWidth={2} className='shrink-0' />
                      <span>{t('conversation.history.deleteTitle')}</span>
                    </div>
                  </Menu.Item>
                </Menu>
              }
              trigger='click'
              position='br'
              popupVisible={menuVisible}
              onVisibleChange={(visible) => onMenuVisibleChange(conversation.id, visible)}
              getPopupContainer={() => document.body}
              unmountOnExit={false}
            >
              <span
                className={classNames('f-center cursor-pointer hover:bg-fill-deep rounded-md p-1 transition-colors relative text-foreground', {
                  flex: menuVisible,
                  'hidden group-hover:flex': !menuVisible,
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMenu(conversation);
                }}
              >
                <div className='flex flex-row gap-1 items-center justify-center' style={{ width: '20px', height: '16px' }}>
                  <div className='w-0.5 h-0.5 rounded-full bg-current'></div>
                  <div className='w-0.5 h-0.5 rounded-full bg-current'></div>
                  <div className='w-0.5 h-0.5 rounded-full bg-current'></div>
                </div>
              </span>
            </Dropdown>
          </div>
        )}
      </div>
    </Tooltip>
  );
};

export default ConversationRow;
