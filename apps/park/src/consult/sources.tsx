import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MarkdownBody, type SourceRange } from './MarkdownBody'
import { zh as t } from './locale'

export interface SourceRef {
  name: string
  version: string
  section: string
  document_id?: string
  wiki_id?: string
  source_id?: string
  ranges?: SourceRange[]
  preview_status?: 'available' | 'unavailable'
}
interface SourcePreview {
  name: string
  version: string
  markdown: string
  ranges: SourceRange[]
}

function rangeLabel(range: SourceRange): string {
  return (range.start === range.end ? t.sourceLine : t.sourceLineRange)
    .replace('{start}', String(range.start))
    .replace('{end}', String(range.end))
}

/** Show each filename once, preferring a retained preview when one is available. */
export function combineSources(sources: SourceRef[]): SourceRef[] {
  const groups = new Map<string, SourceRef>()
  for (const item of sources) {
    const key = item.name.trim()
    const previous = groups.get(key)
    if (
      !previous ||
      ((!previous.source_id || previous.preview_status === 'unavailable') &&
        item.source_id &&
        item.preview_status !== 'unavailable')
    )
      groups.set(key, item)
  }
  return [...groups.values()]
}

function SourcePreviewDialog({ source, sessionId, onClose }: ISourcePreviewDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(
          `/public/sessions/${encodeURIComponent(sessionId)}/sources/${encodeURIComponent(source.source_id!)}/preview`,
          {
            credentials: 'include',
            signal: controller.signal,
          },
        )
        if (!response.ok) {
          setError(response.status === 401 ? t.sourceExpired : t.sourceUnavailable)
          return
        }
        setPreview((await response.json()) as SourcePreview)
      } catch {
        if (!controller.signal.aborted) setError(t.sourceUnavailable)
      }
    })()
    return () => {
      controller.abort()
      element.close()
    }
  }, [sessionId, source])
  function onPosition(range: SourceRange) {
    const blocks = [...(body.current?.querySelectorAll<HTMLElement>('[data-line-start]') ?? [])]
    const target =
      blocks.find(
        (block) =>
          Number(block.dataset.lineStart) <= range.start &&
          Number(block.dataset.lineEnd) >= range.start,
      ) ?? blocks.find((block) => Number(block.dataset.lineStart) >= range.start)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  return (
    <dialog
      ref={dialog}
      className="source-preview"
      aria-labelledby="source-preview-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="source-preview-inner">
        <header>
          <div>
            <span>{t.sourcePreview}</span>
            <h2 id="source-preview-title">{source.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t.sourceClose}>
            ×
          </button>
        </header>
        <p className="source-preview-hint">{t.sourcePreviewHint}</p>
        {preview && (
          <nav aria-label={t.sourcePositions}>
            {preview.ranges.map((range) => (
              <button
                type="button"
                key={`${range.start}-${range.end}`}
                onClick={() => onPosition(range)}
              >
                {rangeLabel(range)}
              </button>
            ))}
          </nav>
        )}
        <div ref={body} className="source-preview-body markdown-body">
          {preview ? (
            <MarkdownBody text={preview.markdown} ranges={preview.ranges} />
          ) : (
            <p role="status">{error || t.sourceLoading}</p>
          )}
        </div>
      </div>
    </dialog>
  )
}

function SourceCards({ sources, sessionId }: ISourceCardsProps) {
  const [selected, setSelected] = useState<SourceRef | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  function onClose() {
    flushSync(() => setSelected(null))
    trigger.current?.focus()
  }
  return (
    <>
      {combineSources(sources).map((source, index) => (
        <div className="policy-source" key={index}>
          <span className="source-icon" aria-hidden="true">
            ▤
          </span>
          <div>
            <span className="source-label">{t.sourceLabel}</span>
            {source.source_id && source.preview_status !== 'unavailable' ? (
              <button
                className="source-open"
                type="button"
                onClick={(event) => {
                  trigger.current = event.currentTarget
                  setSelected(source)
                }}
              >
                {source.name}
              </button>
            ) : (
              <strong>{source.name}</strong>
            )}
          </div>
        </div>
      ))}
      {selected && (
        <SourcePreviewDialog source={selected} sessionId={sessionId} onClose={onClose} />
      )}
    </>
  )
}

export function renderSources(host: HTMLElement, sources: SourceRef[], sessionId: string): void {
  const container = document.createElement('div')
  container.className = 'message-sources'
  host.append(container)
  const root = createRoot(container)
  flushSync(() => root.render(<SourceCards sources={sources} sessionId={sessionId} />))
}

interface ISourceCardsProps {
  sources: SourceRef[]
  sessionId: string
}
interface ISourcePreviewDialogProps {
  source: SourceRef
  sessionId: string
  onClose: () => void
}
