import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessageAcpToolCall } from '@sudowork/common/chatLib';
import CodeView from '@renderer/components/CodeView';
import ToolFrame from '../tools/ToolFrame';
import ToolContentView from '../tools/ToolContentView';
import { formatToolValue, projectAcpToolContent } from '../tools/toolPresentation';

export default function MessageAcpToolCall({ message }: IMessageAcpToolCallProps) {
  const { t } = useTranslation();
  const update = message.content?.update;
  const contents = useMemo(() => projectAcpToolContent(update?.content), [update?.content]);
  if (!update) return null;
  const { toolCallId, kind, title, status, rawInput } = update;
  const titleKey = kind === 'execute' ? 'tools.shell.displayName' : kind === 'read' || kind === 'edit' ? 'tools.fileOps.displayName' : 'tools.labels.tool';
  return (
    <ToolFrame toolCallId={toolCallId} title={title || t(titleKey)} status={status}>
      {rawInput !== undefined && <CodeView source={formatToolValue(rawInput)} language={typeof rawInput === 'string' ? (kind === 'execute' ? 'bash' : 'text') : 'json'} />}
      {contents.map((content, index) => (
        <div className='mt-3' key={index}>
          <ToolContentView content={content} />
        </div>
      ))}
    </ToolFrame>
  );
}

interface IMessageAcpToolCallProps {
  message: IMessageAcpToolCall;
}
