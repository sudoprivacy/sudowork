import React, { createContext, memo, useContext, useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown';
import { Message } from '@arco-design/web-react';
import classNames from 'classnames';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useTranslation } from 'react-i18next';
import { resolveWorkspaceFileLink } from '@sudowork/common/workspaceFileLinks';
import { useConversationContextSafe } from '@renderer/context/ConversationContext';
import { openExternalUrl } from '@renderer/utils/platform';
import { convertLatexDelimiters } from '../utils/latexDelimiters';
import CodeView from './CodeView';
import LocalImageView from './LocalImageView';
import MarkdownSurface from './MarkdownSurface';
import WorkspaceFileLink from './WorkspaceFileLink';

interface IMarkdownOptions {
  codeStyle?: React.CSSProperties;
  hiddenCodeCopyButton?: boolean;
  isExternalContent: boolean;
}

const MarkdownOptions = createContext<IMarkdownOptions>({ isExternalContent: false });
const MarkdownBlock = createContext(false);
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];
const REHYPE_PLUGINS = [rehypeKatex];
const HTML_REHYPE_PLUGINS = [rehypeRaw, rehypeKatex];

function MarkdownCode({ children, className, node: _node, ...props }: React.ComponentProps<'code'> & ExtraProps) {
  const { codeStyle, hiddenCodeCopyButton } = useContext(MarkdownOptions);
  const isFencedBlock = useContext(MarkdownBlock);
  const source = String(children);
  const language = /language-([^\s]+)/.exec(className || '')?.[1] || 'text';
  const isBlock = isFencedBlock || Boolean(className?.includes('language-')) || source.includes('\n');
  if (!isBlock)
    return (
      <code {...props} className={className}>
        {children}
      </code>
    );
  if (['latex', 'math', 'tex'].includes(language) && !/\\(documentclass|begin\{document\}|usepackage)\b/.test(source)) {
    return <div className='katex-display' dangerouslySetInnerHTML={{ __html: katex.renderToString(source, { displayMode: true, throwOnError: false }) }} />;
  }
  return <CodeView source={source} language={language} style={codeStyle} isCopyHidden={hiddenCodeCopyButton} />;
}

function MarkdownPre({ children, node: _node, ...props }: React.ComponentProps<'pre'> & ExtraProps) {
  const nodes = React.Children.toArray(children);
  if (nodes.length === 1 && React.isValidElement(nodes[0]) && nodes[0].type === MarkdownCode) return <MarkdownBlock.Provider value={true}>{children}</MarkdownBlock.Provider>;
  return <pre {...props}>{children}</pre>;
}

function MarkdownLink({ node: _node, ...props }: React.ComponentProps<'a'> & ExtraProps) {
  const { isExternalContent } = useContext(MarkdownOptions);
  const conversation = useConversationContextSafe();
  const { t } = useTranslation();
  const file = !isExternalContent && props.href ? resolveWorkspaceFileLink(props.href, conversation?.workspace) : null;
  if (file && conversation) return <WorkspaceFileLink {...props} conversation={conversation} file={file} />;
  return (
    <a
      {...props}
      target='_blank'
      rel='noopener noreferrer'
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!props.href) return;
        void openExternalUrl(props.href).catch(() => Message.error(t('messages.openLinkFailed')));
      }}
    />
  );
}

function MarkdownImage({ node: _node, ...props }: React.ComponentProps<'img'> & ExtraProps) {
  const { isExternalContent } = useContext(MarkdownOptions);
  if (isExternalContent) return <span>{props.alt}</span>;
  const src = typeof props.src === 'string' ? props.src : '';
  if (!/^(https?:|data:)/i.test(src)) return <LocalImageView src={decodeURIComponent(src.replace(/^file:\/\//, ''))} alt={props.alt || ''} className={props.className} style={{ width: '40%', borderRadius: 'var(--radius-md)' }} />;
  return <img {...props} />;
}

// Stable component identities preserve local fold state across stream updates.
const COMPONENTS: Components = {
  code: MarkdownCode,
  a: MarkdownLink,
  img: MarkdownImage,
  pre: MarkdownPre,
  table: ({ node: _node, ...props }) => (
    <div className='markdown-table'>
      <table {...props} />
    </div>
  ),
};

function MarkdownView({ hiddenCodeCopyButton, codeStyle, className, onRef, allowHtml, isExternalContent = false, children }: IMarkdownViewProps) {
  const options = useMemo(() => ({ hiddenCodeCopyButton, codeStyle, isExternalContent }), [hiddenCodeCopyButton, codeStyle, isExternalContent]);
  const normalizedChildren = useMemo(() => {
    if (isExternalContent) return convertLatexDelimiters(children);
    // Only normalize image targets; source code and other message text stay verbatim.
    return convertLatexDelimiters(children, (prose) => prose.replace(/!\[([^\]]*)\]\((?:\\\\\?\\)?([A-Za-z]:\\[^)]+)\)/g, (_match, alt: string, imagePath: string) => `![${alt}](${imagePath.replace(/\\/g, '/')})`));
  }, [children, isExternalContent]);

  return (
    <div className={classNames('relative w-full', className)}>
      <MarkdownSurface>
        <div ref={onRef} className='markdown-shadow-body'>
          <MarkdownOptions.Provider value={options}>
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={allowHtml && !isExternalContent ? HTML_REHYPE_PLUGINS : REHYPE_PLUGINS}
              skipHtml={isExternalContent}
              urlTransform={(url) => {
                if (isExternalContent) return /^https?:\/\//i.test(url) ? url : '';
                if (/^[A-Za-z]:[/\\]/.test(url) || /^file:\/\//i.test(url)) return url;
                return defaultUrlTransform(url);
              }}
              components={COMPONENTS}
            >
              {normalizedChildren}
            </ReactMarkdown>
          </MarkdownOptions.Provider>
        </div>
      </MarkdownSurface>
    </div>
  );
}

export default memo(MarkdownView);

interface IMarkdownViewProps {
  children: string;
  hiddenCodeCopyButton?: boolean;
  codeStyle?: React.CSSProperties;
  className?: string;
  onRef?: (el?: HTMLDivElement | null) => void;
  /** Enable raw HTML only for trusted sources. */
  allowHtml?: boolean;
  /** External providers cannot load HTML, images or workspace files. */
  isExternalContent?: boolean;
}
