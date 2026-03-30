/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText } from '@/common/chatLib';
import { NEXUS_FILES_MARKER } from '@/common/constants';
import { ipcBridge } from '@/common';
import { iconColors } from '@/renderer/theme/colors';
import { Alert, Message, Tooltip, Tag } from '@arco-design/web-react';
import { Copy, FileWord, Lightning, CloseSmall } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@/renderer/utils/clipboard';
import { filterUserVisibleFiles } from '@/renderer/utils/messageFiles';
import { emitter } from '@/renderer/utils/emitter';
import { getInstalledSkillDisplay } from '@/renderer/utils/skillDisplay';
import { skillHub } from '@/common/ipcBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import CollapsibleContent from '../components/CollapsibleContent';
import FilePreview from '../components/FilePreview';
import HorizontalFileList from '../components/HorizontalFileList';
import MarkdownView from '../components/Markdown';
import { stripThinkTags, hasThinkTags } from '../utils/thinkTagFilter';
import MessageCronBadge from './MessageCronBadge';

const parseFileMarker = (content: string) => {
  const markerIndex = content.indexOf(NEXUS_FILES_MARKER);
  if (markerIndex === -1) {
    return { text: content, files: [] as string[] };
  }
  const text = content.slice(0, markerIndex).trimEnd();
  const afterMarker = content.slice(markerIndex + NEXUS_FILES_MARKER.length).trim();
  const files = afterMarker
    ? afterMarker
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return { text, files };
};

const useFormatContent = (content: string) => {
  return useMemo(() => {
    try {
      const json = JSON.parse(content);
      const isJson = typeof json === 'object';
      return {
        json: isJson,
        data: isJson ? json : content,
      };
    } catch {
      return { data: content };
    }
  }, [content]);
};

const MessageText: React.FC<{ message: IMessageText }> = ({ message }) => {
  // Filter think tags from content before rendering
  // 在渲染前过滤 think 标签
  const contentToRender = useMemo(() => {
    const rawContent = message.content.content;
    if (typeof rawContent === 'string' && hasThinkTags(rawContent)) {
      return stripThinkTags(rawContent);
    }
    return rawContent;
  }, [message.content.content]);

  const { text: rawText, files } = parseFileMarker(contentToRender);
  const text = rawText.trimEnd();
  const visibleFiles = useMemo(() => filterUserVisibleFiles(files), [files]);
  const { data, json } = useFormatContent(text);
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const [converting, setConverting] = useState(false);
  const isUserMessage = message.position === 'right';
  const skills = message.content.skills || [];

  // 获取已安装的技能信息用于显示
  const [installedSkills, setInstalledSkills] = useState<any[]>([]);
  useEffect(() => {
    if (!isElectronDesktop() || skills.length === 0) return;
    const fetchInstalledSkills = async () => {
      try {
        const res = await skillHub.getInstalledSkills.invoke();
        if (res.success && res.data) {
          setInstalledSkills(res.data);
        }
      } catch (err) {
        console.error('Failed to fetch installed skills:', err);
      }
    };
    void fetchInstalledSkills();
  }, [skills.length]);

  const handleConvertToWord = useCallback(async () => {
    if (converting) return;
    setConverting(true);
    try {
      const res = await ipcBridge.document.saveAsDocx.invoke({
        markdown: text,
        conversationId: message.conversation_id,
      });

      if (res?.success && res.data) {
        Message.success(t('messages.convertSuccess', { defaultValue: 'Converted to Word successfully' }));
        // 自动刷新工作区 (通过 emitter)
        emitter.emit('chat.history.refresh');
        // 可选：打开文件夹定位文件
        void ipcBridge.shell.showItemInFolder.invoke(res.data);
      } else {
        Message.error(res?.msg || t('messages.convertFailed', { defaultValue: 'Failed to convert to Word' }));
      }
    } catch (error) {
      console.error('Failed to convert to Word:', error);
      Message.error(t('messages.convertFailed', { defaultValue: 'Failed to convert to Word' }));
    } finally {
      setConverting(false);
    }
  }, [text, message.conversation_id, t, converting]);

  // 过滤空内容，避免渲染空DOM
  if (!message.content.content || (typeof message.content.content === 'string' && !message.content.content.trim())) {
    return null;
  }

  const handleCopy = () => {
    const baseText = json ? JSON.stringify(data, null, 2) : text;
    const fileList = visibleFiles.length ? `Files:\n${visibleFiles.map((path) => `- ${path}`).join('\n')}\n\n` : '';
    const textToCopy = fileList + baseText;
    copyText(textToCopy)
      .then(() => {
        setShowCopyAlert(true);
        setTimeout(() => setShowCopyAlert(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const copyButton = (
    <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
      <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto' onClick={handleCopy} style={{ lineHeight: 0 }}>
        <Copy theme='outline' size='16' fill={iconColors.secondary} />
      </div>
    </Tooltip>
  );

  const transToWordButton = (
    <Tooltip content={t('messages.convertToWord', { defaultValue: 'Convert to Word' })}>
      <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto' onClick={handleConvertToWord} style={{ lineHeight: 0 }}>
        <FileWord theme='outline' size='16' fill={converting ? iconColors.disabled : iconColors.secondary} />
      </div>
    </Tooltip>
  );

  const cronMeta = message.content.cronMeta;

  return (
    <>
      <div className={classNames('min-w-0 flex flex-col', isUserMessage ? 'items-end' : 'items-start')}>
        {cronMeta && <MessageCronBadge meta={cronMeta} />}
        {visibleFiles.length > 0 && (
          <div className={classNames('mt-6px', { 'self-end': isUserMessage })}>
            {visibleFiles.length === 1 ? (
              <div className='flex items-center'>
                <FilePreview path={visibleFiles[0]} onRemove={() => undefined} readonly />
              </div>
            ) : (
              <HorizontalFileList>
                {visibleFiles.map((path) => (
                  <FilePreview key={path} path={path} onRemove={() => undefined} readonly />
                ))}
              </HorizontalFileList>
            )}
          </div>
        )}
        <div
          className={classNames('min-w-0 [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px md:max-w-780px p-8px border border-solid transition-colors duration-200', {
            // 用户消息使用 OpenClaw 风格的粉色调
            'bg-[var(--message-user-bg)] text-[var(--message-user-text)] border-[var(--message-user-border)] hover:bg-[var(--message-user-hover)]': isUserMessage,
            // 助手消息使用 OpenClaw 风格的白色/深灰色调
            'bg-[var(--message-assistant-bg)] text-[var(--message-assistant-text)] border-[var(--message-assistant-border)] hover:bg-[var(--message-assistant-hover)]': !isUserMessage,
          })}
          style={{
            borderRadius: isUserMessage ? '16px 16px 16px 16px' : '16px 16px 16px 16px',
          }}
        >
          {/* JSON 内容使用折叠组件 Use CollapsibleContent for JSON content */}
          {json ? (
            <CollapsibleContent maxHeight={200} defaultCollapsed={true}>
              <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
            </CollapsibleContent>
          ) : (
            <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{data}</MarkdownView>
          )}
        </div>
        {/* Skill tags - displayed below user message content */}
        {skills.length > 0 && isUserMessage && (
          <div className={classNames('mt-6px mb-6px', { 'self-end': isUserMessage })}>
            <div className='flex items-center gap-4px text-10px text-t-secondary mb-4px'>
              <Lightning size='10' className='text-primary' />
              <span>当前使用技能</span>
            </div>
            <div className='flex flex-wrap gap-6px'>
              {skills.map((skillName) => {
                const skillInfo = installedSkills.find((s) => s.name === skillName);
                const { displayName, emoji } = getInstalledSkillDisplay(skillInfo || { name: skillName, version: '' });
                return (
                  <Tag
                    key={skillName}
                    className='text-12px bg-primary-light b-1 b-solid b-border-2 rd-4px'
                    style={{
                      backgroundColor: 'var(--color-primary-light-1)',
                      borderColor: 'var(--color-primary-light-2)',
                    }}
                  >
                    <span className='mr-4px'>{emoji || '⚡'}</span>
                    {displayName}
                  </Tag>
                );
              })}
            </div>
          </div>
        )}
        <div
          className={classNames('h-24px flex items-center mt-4px', {
            'justify-end': isUserMessage,
            'justify-start': !isUserMessage,
          })}
        >
          {copyButton}
          {transToWordButton}
        </div>
      </div>
      {showCopyAlert && <Alert type='success' content={t('messages.copySuccess')} showIcon className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]' style={{ boxShadow: '0px 2px 12px rgba(0,0,0,0.12)' }} closable={false} />}
    </>
  );
};

export default MessageText;
