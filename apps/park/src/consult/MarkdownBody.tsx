import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Root, Nodes } from 'mdast'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
export interface SourceRange {
  start: number
  end: number
}

/** Attach original text positions without splitting Markdown blocks or tables. */
function remarkPositions(ranges: SourceRange[]) {
  return () => (tree: Root) => {
    function visit(node: Nodes) {
      const position = node.position
      if (
        position &&
        ['heading', 'paragraph', 'list', 'listItem', 'blockquote', 'code', 'table'].includes(
          node.type,
        )
      ) {
        node.data ??= {}
        node.data.hProperties = {
          ...node.data.hProperties,
          'data-line-start': position.start.line,
          'data-line-end': position.end.line,
          ...(ranges.some(
            (range) => range.start <= position.end.line && range.end >= position.start.line,
          )
            ? { className: 'is-referenced' }
            : {}),
        }
      }
      if ('children' in node) for (const child of node.children) visit(child)
    }
    visit(tree)
  }
}

export function MarkdownBody({ text, ranges = [] }: IMarkdownBodyProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, remarkPositions(ranges)]}
      skipHtml
      urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : '')}
      components={{
        a: ({ node: _node, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
        img: ({ alt }) => <span>{alt}</span>,
        table: ({ node: _node, ...props }) => (
          <div className="markdown-table">
            <table {...props} />
          </div>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

const roots = new WeakMap<HTMLElement, ReactRoot>()

export function renderMarkdown(host: HTMLElement, text: string): void {
  let root = roots.get(host)
  if (!root) {
    root = createRoot(host)
    roots.set(host, root)
  }
  flushSync(() => root.render(<MarkdownBody text={text} />))
}

export function disposeMarkdown(host: HTMLElement): void {
  roots.get(host)?.unmount()
  roots.delete(host)
}

interface IMarkdownBodyProps {
  text: string
  ranges?: SourceRange[]
}
