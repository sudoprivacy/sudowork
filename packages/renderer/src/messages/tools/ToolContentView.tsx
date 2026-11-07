import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createTwoFilesPatch } from 'diff';
import CodeView from '@renderer/components/CodeView';
import MarkdownView from '@renderer/components/Markdown';
import FileChangesPanel from '@renderer/components/base/FileChangesPanel';
import { useDiffPreviewHandlers } from '@renderer/hooks/useDiffPreviewHandlers';
import { parseDiff } from '@renderer/utils/diffUtils';
import type { ToolContent } from './toolPresentation';

/** Terminal and generic tool output is literal text unless a protocol declares another kind. */
export const ToolOutput = memo(function ToolOutput({ text }: IToolOutputProps) {
  return <pre className='bg-2 p-3 rounded border border-[var(--border-default)] font-mono text-sm overflow-auto max-h-60 whitespace-pre-wrap break-words text-foreground m-0'>{text}</pre>;
});

function ToolDiff({ content }: IToolDiffProps) {
  const { t } = useTranslation();
  const displayName = content.path.split(/[/\\]/).pop() || content.path || t('tools.unknownFile');
  const diffText = useMemo(() => createTwoFilesPatch(displayName, displayName, content.oldText, content.newText, '', '', { context: 3 }), [displayName, content.oldText, content.newText]);
  const fileInfo = useMemo(() => parseDiff(diffText, displayName), [diffText, displayName]);
  const { handleFileClick: onFileClick, handleDiffClick: onDiffClick } = useDiffPreviewHandlers({ diffText, displayName, filePath: content.path || displayName });
  return <FileChangesPanel title={displayName} files={[fileInfo]} onFileClick={onFileClick} onDiffClick={onDiffClick} defaultExpanded />;
}

export default function ToolContentView({ content }: IToolContentViewProps) {
  if (content.kind === 'diff') return <ToolDiff content={content} />;
  if (content.kind === 'markdown') return <MarkdownView>{content.text}</MarkdownView>;
  if (content.kind === 'code') return <CodeView source={content.text} language={content.language} />;
  return <ToolOutput text={content.text} />;
}

interface IToolOutputProps {
  text: string;
}
interface IToolContentViewProps {
  content: ToolContent;
}

interface IToolDiffProps {
  content: Extract<ToolContent, { kind: 'diff' }>;
}
