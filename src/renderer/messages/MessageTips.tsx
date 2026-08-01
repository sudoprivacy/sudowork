/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { CircleCheck as CheckOne, TriangleAlert as Attention } from 'lucide-react';
import React, { useMemo } from 'react';
import type { IMessageTips } from '@/common/chatLib';
import MarkdownView from '../components/Markdown';
import CollapsibleContent from '../components/CollapsibleContent';
import RuntimeErrorBanner from './RuntimeErrorBanner';

const icon = {
  success: <CheckOne size={16} className='mt-0.5 text-success' />,
  warning: <Attention size={16} strokeLinejoin='bevel' className='mt-0.5 text-warning' />,
  error: <Attention size={16} strokeLinejoin='bevel' className='mt-0.5 text-destructive' />,
};

const useFormatContent = (content: string) => {
  return useMemo(() => {
    try {
      const json = JSON.parse(content);
      return {
        json: true,
        data: json,
      };
    } catch {
      return { data: content };
    }
  }, [content]);
};

const MessageTips: React.FC<{ message: IMessageTips }> = ({ message }) => {
  const { content, type, errorClass, errorBytes } = message.content;
  // Hooks must run unconditionally — call before any early return.
  const { json, data } = useFormatContent(content);

  // Classified runtime error → render the differentiated banner.
  // Falls back to the legacy text tip if the renderer doesn't recognise
  // the errorClass (RuntimeErrorBanner handles that defensively).
  if (type === 'error' && errorClass) {
    return <RuntimeErrorBanner errorClass={errorClass} errorBytes={errorBytes} fallbackContent={content} />;
  }

  const displayContent = json ? '' : content;

  if (json)
    return (
      <div className='w-full'>
        <div className='flex items-start gap-1 rounded-md bg-muted px-3 py-2'>
          {icon[type] || icon.warning}
          <MarkdownView>{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
        </div>
      </div>
    );
  return (
    <div className='w-full'>
      <div className='flex items-start gap-1 rounded-md bg-muted px-3 py-2'>
        {icon[type] || icon.warning}
        <CollapsibleContent maxHeight={48} defaultCollapsed={true} className='flex-1' useMask={true}>
          <span
            className='whitespace-break-spaces text-foreground [word-break:break-word]'
            dangerouslySetInnerHTML={{
              __html: displayContent,
            }}
          ></span>
        </CollapsibleContent>
      </div>
    </div>
  );
};

export default MessageTips;
