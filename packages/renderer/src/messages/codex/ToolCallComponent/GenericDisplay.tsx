import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexToolCallUpdate } from '@sudowork/common/chatLib';
import CodeView from '@renderer/components/CodeView';
import ToolFrame from '../../tools/ToolFrame';
import { ToolOutput } from '../../tools/ToolContentView';
import { formatToolValue } from '../../tools/toolPresentation';

type GenericUpdate = Extract<CodexToolCallUpdate, { subtype: 'generic' }>;

export default function GenericDisplay({ content }: IGenericDisplayProps) {
  const { t } = useTranslation();
  const { toolCallId, kind, title, status, description, content: contents, data } = content;
  const titleKey = kind === 'execute' ? 'tools.shell.displayName' : kind === 'patch' ? 'tools.titles.file_patch' : kind === 'web_search' ? 'tools.webSearch.displayName' : 'tools.labels.tool';
  return (
    <ToolFrame toolCallId={toolCallId} title={title || t(titleKey)} status={status} description={description}>
      {data !== undefined && <CodeView source={formatToolValue(data)} language='json' />}
      {contents?.map((item, index) => {
        const text = item.type === 'output' ? item.output : item.type === 'text' ? item.text : undefined;
        return text === undefined ? null : (
          <div className='mt-3' key={index}>
            <ToolOutput text={text} />
          </div>
        );
      })}
    </ToolFrame>
  );
}

interface IGenericDisplayProps {
  content: GenericUpdate;
}
