import { Attention, CheckOne } from '@icon-park/react';
import { theme } from '@office-ai/platform';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import type { IMessageTips } from '@/common/chatLib';
import MarkdownView from '../components/Markdown';
import CollapsibleContent from '../components/CollapsibleContent';
import RuntimeErrorBanner from './RuntimeErrorBanner';

const icon = {
  success: <CheckOne theme='filled' size='16' fill={theme.Color.FunctionalColor.success} className='m-t-2px' />,
  warning: <Attention theme='filled' size='16' strokeLinejoin='bevel' className='m-t-2px' fill={theme.Color.FunctionalColor.warn} />,
  error: <Attention theme='filled' size='16' strokeLinejoin='bevel' className='m-t-2px' fill={theme.Color.FunctionalColor.error} />,
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
        <div className={classNames('bg-message-tips rd-8px p-x-12px p-y-8px flex items-start gap-4px')}>
          {icon[type] || icon.warning}
          <MarkdownView>{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
        </div>
      </div>
    );
  return (
    <div className='w-full'>
      <div className={classNames('bg-message-tips rd-8px  p-x-12px p-y-8px flex items-start gap-4px')}>
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
