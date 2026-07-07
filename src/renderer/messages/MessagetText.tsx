import { Alert, Message, Tag, Tooltip } from '@arco-design/web-react';
import { Copy, Lightning } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { skillHub } from '@/common/ipcBridge';
import { getInstalledSkillDisplay } from '@/renderer/utils/skillDisplay';
import { filterUserVisibleFiles } from '@/renderer/utils/messageFiles';
import { copyText } from '@/renderer/utils/clipboard';
import { parseGeneratedFilesMarker } from '@/common/generatedFiles';
import { NEXUS_FILES_MARKER } from '@/common/constants';
import type { IMessageText } from '@/common/chatLib';
import { stripThinkTags, hasThinkTags } from '../utils/thinkTagFilter';
import MarkdownView from '../components/Markdown';
import HorizontalFileList from '../components/HorizontalFileList';
import FilePreview from '../components/FilePreview';
import CollapsibleContent from '../components/CollapsibleContent';
import MessageCronBadge from './MessageCronBadge';
import GeneratedFileCards from './GeneratedFileCard';

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

export const stripInjectedUserPrompt = (content: string): string => {
  if (!content.includes('[User Request]')) return content;
  const parts = content.split('[User Request]');
  return parts[parts.length - 1]?.trim() || content;
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

const MessageText: React.FC<{ message: IMessageText; isStreaming?: boolean; footer?: React.ReactNode }> = ({ message, isStreaming = false, footer }) => {
  // Filter think tags from content before rendering
  // 在渲染前过滤 think 标签
  const contentToRender = useMemo(() => {
    const rawContent = message.content.content;
    if (typeof rawContent === 'string' && hasThinkTags(rawContent)) {
      return stripThinkTags(rawContent);
    }
    return rawContent;
  }, [message.content.content]);

  const isUserMessage = message.position === 'right';

  const displayContent = useMemo(() => {
    if (!isUserMessage || typeof contentToRender !== 'string') {
      return contentToRender;
    }
    return stripInjectedUserPrompt(contentToRender);
  }, [contentToRender, isUserMessage]);

  // Pull out AI-generated-file preview cards (NEXUS_GENERATED_FILES marker).
  // Done before parseFileMarker so the user-side NEXUS_FILES path can keep
  // assuming its content is unprefixed.
  const generated = useMemo(() => (typeof displayContent === 'string' ? parseGeneratedFilesMarker(displayContent) : { textBefore: displayContent as string, files: [], ok: false }), [displayContent]);

  const { text: rawText, files } = parseFileMarker(generated.textBefore);
  const text = rawText.trimEnd();
  const visibleFiles = useMemo(() => filterUserVisibleFiles(files), [files]);
  const { data, json } = useFormatContent(text);
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const hasCodeFence = typeof displayContent === 'string' ? /```/.test(displayContent) : false;
  const hasCodeLikeContent = json || hasCodeFence;
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

  // 过滤空内容，避免渲染空DOM
  // Edge case: a "deliverables" assistant message carries ONLY the
  // [[NEXUS_GENERATED_FILES]] marker — content.content is non-empty but text
  // after stripping the marker is empty. Allow that through so cards render.
  if (!message.content.content || (typeof message.content.content === 'string' && !message.content.content.trim())) {
    return null;
  }
  if (!text.trim() && !generated.ok && visibleFiles.length === 0) {
    return null;
  }

  const proseHasContent = !!text.trim();

  const handleCopy = () => {
    const rawBase = json ? JSON.stringify(data, null, 2) : text;
    // Strip markdown image syntax ![alt](path) → path
    const baseText = rawBase.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
    // Only copy message content, exclude files and skills
    const textToCopy = baseText;
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
      <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={handleCopy} style={{ lineHeight: 0 }}>
        <Copy theme='outline' size='16' fill={'var(--text-secondary)'} />
      </div>
    </Tooltip>
  );

  const cronMeta = message.content.cronMeta;

  const showFooter = Boolean(footer) && !isUserMessage;

  return (
    <>
      <div className={classNames('min-w-0 flex max-w-full flex-col', isUserMessage ? 'items-end' : 'items-start', !isUserMessage && hasCodeLikeContent && 'w-full')}>
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
        {proseHasContent && (
          <div
            className={classNames('min-w-0 box-border overflow-hidden [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px p-8px border border-solid transition-colors duration-200', {
              'w-fit max-w-full': isUserMessage || !hasCodeLikeContent,
              'w-full max-w-full': !isUserMessage && hasCodeLikeContent,
              // 用户消息使用 OpenClaw 风格的粉色调
              'bg-[var(--message-user-bg)] text-[var(--message-user-text)] border-[var(--message-user-border)] hover:bg-[var(--message-user-hover)]': isUserMessage,
              // 助手消息使用白色/深灰色调
              'bg-[var(--message-assistant-bg)] text-[var(--message-assistant-text)] border-[var(--message-assistant-border)] hover:bg-[var(--message-assistant-hover)]': !isUserMessage,
              // 流式输出时添加红色闪烁边框
              'streaming-message': isStreaming && !isUserMessage,
            })}
            style={{
              borderRadius: isUserMessage ? '16px 16px 16px 16px' : '16px 16px 16px 16px',
              maxWidth: '100%',
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
        )}
        {generated.ok && generated.files.length > 0 && (
          <div className={classNames(proseHasContent ? 'mt-8px w-full' : 'mt-6px w-full')}>
            <GeneratedFileCards entries={generated.files} fullWidth />
          </div>
        )}
        {showFooter && <div className='mt-4px w-full max-w-full'>{footer}</div>}
        {/* Skill tags - displayed below user message content */}
        {skills.length > 0 && isUserMessage && (
          <div className={classNames('mt-6px mb-6px', { 'self-end': isUserMessage })}>
            <div className='flex items-center gap-4px text-10px text-secondary mb-4px'>
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
                    className='text-12px b-1 b-solid b-border-2 rd-4px'
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
          className={classNames('h-24px flex items-center mt-4px transition-opacity duration-200', {
            'justify-end': isUserMessage,
            'justify-start': !isUserMessage,
            'opacity-0 group-hover:opacity-100': isUserMessage,
          })}
        >
          {isUserMessage && copyButton}
        </div>
      </div>
      {showCopyAlert && <Alert type='success' content={t('messages.copySuccess')} showIcon className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]' style={{ boxShadow: 'var(--shadow-md)' }} closable={false} />}
    </>
  );
};

export default MessageText;
