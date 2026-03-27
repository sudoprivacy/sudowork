/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText } from '@/common/chatLib';
import { NEXUS_FILES_MARKER } from '@/common/constants';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { filterUserVisibleFiles } from '@/renderer/utils/messageFiles';
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

  const { text, files } = parseFileMarker(contentToRender);
  const visibleFiles = useMemo(() => filterUserVisibleFiles(files), [files]);
  const { data, json } = useFormatContent(text);
  const isUserMessage = message.position === 'right';

  // 过滤空内容，避免渲染空DOM
  if (!message.content.content || (typeof message.content.content === 'string' && !message.content.content.trim())) {
    return null;
  }

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
          className={classNames('min-w-0 [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px md:max-w-780px', {
            'bg-aou-2 p-8px': isUserMessage || cronMeta,
            'w-full': !(isUserMessage || cronMeta),
          })}
          style={isUserMessage || cronMeta ? { borderRadius: '8px 0 8px 8px' } : undefined}
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
      </div>
    </>
  );
};

export default MessageText;
