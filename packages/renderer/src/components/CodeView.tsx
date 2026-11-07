import { Button, Message } from '@arco-design/web-react';
import { IconCopy, IconDown, IconUp } from '@arco-design/web-react/icon';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { copyText } from '@renderer/utils/clipboard';
import '../styles/code-view.css';

// CSS variables resolve at the rendered element, including inside Shadow DOM.
// Syntax highlighting therefore needs no theme subscription per code block.
const SYNTAX_STYLE: Record<string, React.CSSProperties> = {
  hljs: { color: 'var(--foreground)', background: 'transparent' },
  'hljs-keyword': { color: 'var(--code-keyword)' },
  'hljs-selector-tag': { color: 'var(--code-keyword)' },
  'hljs-built_in': { color: 'var(--code-keyword)' },
  'hljs-literal': { color: 'var(--code-number)' },
  'hljs-number': { color: 'var(--code-number)' },
  'hljs-string': { color: 'var(--code-string)' },
  'hljs-regexp': { color: 'var(--code-string)' },
  'hljs-comment': { color: 'var(--code-comment)', fontStyle: 'italic' },
  'hljs-quote': { color: 'var(--code-comment)' },
  'hljs-title': { color: 'var(--code-title)' },
  'hljs-attr': { color: 'var(--code-attribute)' },
  'hljs-attribute': { color: 'var(--code-attribute)' },
  'hljs-type': { color: 'var(--code-type)' },
  'hljs-tag': { color: 'var(--code-keyword)' },
  'hljs-meta': { color: 'var(--code-comment)' },
  'hljs-addition': { color: 'var(--success)' },
  'hljs-deletion': { color: 'var(--danger)' },
};

const CODE_STYLE: React.CSSProperties = { margin: 0, padding: 'var(--space-3)', border: 0, background: 'transparent', color: 'var(--foreground)', whiteSpace: 'pre', overflowX: 'auto', fontSize: 'var(--text-base)', lineHeight: 1.6 };

function isHighlightable(source: string): boolean {
  if (source.length > 32768) return false;
  let lines = 1;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n' && ++lines > 500) return false;
  }
  return true;
}

function diffLineProps(source: string) {
  const lines = source.split('\n');
  return (lineNumber: number) => {
    const line = lines[lineNumber - 1] || '';
    const background = line.startsWith('+') && !line.startsWith('+++') ? 'var(--success-soft)' : line.startsWith('-') && !line.startsWith('---') ? 'var(--danger-soft)' : line.startsWith('@@') ? 'var(--info-soft)' : undefined;
    return { style: { display: 'block', background } };
  };
}

/** Displays and copies source verbatim; formatting belongs to an explicit editor action. */
function CodeView({ source, language = 'text', style, isCopyHidden = false, isCollapsible = true }: ICodeViewProps) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isDiff = language === 'diff' || language === 'patch';
  const isHighlighted = isHighlightable(source);
  const onCopy = () => {
    void copyText(source)
      .then(() => Message.success(t('common.copySuccess')))
      .catch(() => Message.error(t('common.copyFailed')));
  };

  return (
    <div className='code-view' style={style} data-code-view>
      <div className='code-view-header'>
        <span>{language.toLowerCase()}</span>
        <div className='code-view-actions'>
          {!isCopyHidden && <Button type='text' size='mini' aria-label={t('common.copy')} icon={<IconCopy />} onClick={onCopy} />}
          {isCollapsible && <Button type='text' size='mini' aria-label={t(isCollapsed ? 'common.expand' : 'common.collapse')} aria-expanded={!isCollapsed} icon={isCollapsed ? <IconDown /> : <IconUp />} onClick={() => setIsCollapsed((value) => !value)} />}
        </div>
      </div>
      {!isCollapsed && !isHighlighted && (
        <pre style={CODE_STYLE}>
          <code>{source}</code>
        </pre>
      )}
      {!isCollapsed && isHighlighted && (
        <SyntaxHighlighter language={language} style={SYNTAX_STYLE} customStyle={CODE_STYLE} wrapLines={isDiff} lineProps={isDiff ? diffLineProps(source) : undefined}>
          {source}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

// Callers may create equivalent style objects during streaming. Comparing their
// scalar CSS values keeps completed blocks out of the highlighter hot path.
export default memo(CodeView, (previous, next) => {
  if (previous.source !== next.source || previous.language !== next.language || previous.isCopyHidden !== next.isCopyHidden || previous.isCollapsible !== next.isCollapsible) return false;
  if (previous.style === next.style) return true;
  const previousStyle = previous.style || {};
  const nextStyle = next.style || {};
  const keys = Object.keys(previousStyle) as Array<keyof React.CSSProperties>;
  return keys.length === Object.keys(nextStyle).length && keys.every((key) => previousStyle[key] === nextStyle[key]);
});

interface ICodeViewProps {
  source: string;
  language?: string;
  style?: React.CSSProperties;
  isCopyHidden?: boolean;
  isCollapsible?: boolean;
}
