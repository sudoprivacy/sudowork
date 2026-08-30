/**
 * 右侧面板「交付物」tab（对齐 Sudowork DeliverablesPanel 的分组与卡片形态，
 * Apache-2.0, Copyright 2026 SudoPrivacy）。数据从 Moss context 的 tool_use 重建（服务端提取）。
 * 点击行为（裁剪说明）：统一为内容预览（workspace/file）+ 下载；Sudowork 的「html 进浏览器 tab」
 * 「系统打开/显示于文件夹」依赖 Electron/浏览器 tab，webui 无对应物不做。
 */
import React, { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Empty, Modal } from '@arco-design/web-react'
import { Download, FileText } from 'lucide-react'
import { getDeliverables, getWorkspaceFile, type DeliverableItem } from '../conversationApi'

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (day === today) return '今天'
  if (today - day === 86_400_000) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function DeliverablesTab({
  conversationId,
  active,
  turnFinishedAt,
}: {
  conversationId: string
  active: boolean
  turnFinishedAt: number
}): React.ReactElement {
  const { data, mutate: refreshDeliverables } = useSWR(
    conversationId ? ['deliverables', conversationId] : null,
    () => getDeliverables(conversationId),
  )
  const [preview, setPreview] = useState<{ name: string; mime: string; content: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // turn 结束后面板激活时刷新
  useEffect(() => {
    if (active) void refreshDeliverables()
  }, [turnFinishedAt, active, refreshDeliverables])

  const items = data?.items ?? []
  const groups = useMemo(() => {
    const map = new Map<string, DeliverableItem[]>()
    for (const item of items) {
      const label = dayLabel(item.createdAt)
      const list = map.get(label) ?? []
      list.push(item)
      map.set(label, list)
    }
    return [...map.entries()]
  }, [items])

  async function openPreview(item: DeliverableItem): Promise<void> {
    setPreviewLoading(true)
    try {
      const file = await getWorkspaceFile(conversationId, item.relativePath)
      setPreview({ name: item.name, mime: file.mime, content: file.content })
    } catch {
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  function download(item: DeliverableItem): void {
    void (async () => {
      const file = await getWorkspaceFile(conversationId, item.relativePath)
      const isText = file.mime.startsWith('text/') || file.mime === 'application/json' || file.mime === 'image/svg+xml'
      const a = document.createElement('a')
      if (isText) {
        a.href = `data:${file.mime};charset=utf-8,${encodeURIComponent(file.content)}`
      } else {
        a.href = `data:${file.mime};base64,${file.content}`
      }
      a.download = item.name
      a.click()
    })()
  }

  return (
    <div className='w-full h-full min-h-0 overflow-y-auto px-12px py-12px flex flex-col gap-12px'>
      {groups.length === 0 ? (
        <Empty description='暂无交付物' className='mt-8' />
      ) : (
        groups.map(([label, list]) => (
          <div key={label} className='flex flex-col gap-8px'>
            <div className='flex items-center gap-2 text-11px text-tertiary uppercase tracking-wide'>
              <span>{label}</span>
              <span className='inline-flex items-center justify-center min-w-14px h-14px rd-full bg-fill-2 text-10px text-secondary'>
                {list.length}
              </span>
            </div>
            {list.map((item) => (
              <div
                key={item.relativePath}
                className='w-[90%] rounded-16px border b-solid border-[var(--border-light)] bg-[var(--color-bg-2)] p-12px flex items-center gap-10px cursor-pointer hover:bg-[var(--color-bg-3)] active:scale-98 transition-all'
                onClick={() => void openPreview(item)}
                data-testid='deliverable-card'
              >
                <span className='inline-flex items-center justify-center size-48px shrink-0 rounded-10px bg-fill-2 text-secondary'>
                  <FileText size={20} />
                </span>
                <div className='min-w-0 flex flex-col gap-2px flex-1'>
                  <span className='text-13px text-1 font-500 truncate'>{item.name}</span>
                  <span className='text-11px text-tertiary truncate'>{item.relativePath}</span>
                  <span className='flex items-center gap-6px text-11px text-tertiary'>
                    <span
                      className={`inline-block px-6px h-16px leading-16px rd-full text-10px ${
                        item.kind === 'create'
                          ? 'bg-[color-mix(in_srgb,var(--ui-accent-orange)_12%,transparent)] text-[var(--ui-accent-orange)]'
                          : 'bg-fill-3 text-secondary'
                      }`}
                    >
                      {item.kind === 'create' ? '新建' : '编辑'}
                    </span>
                    {typeof item.size === 'number' ? <span>{(item.size / 1024).toFixed(1)} KB</span> : null}
                  </span>
                </div>
                <button
                  type='button'
                  aria-label='下载'
                  className='inline-flex items-center justify-center size-7 rd-4 border-none bg-transparent text-secondary cursor-pointer hover:bg-fill-3 shrink-0'
                  onClick={(e) => {
                    e.stopPropagation()
                    download(item)
                  }}
                >
                  <Download size={14} />
                </button>
              </div>
            ))}
          </div>
        ))
      )}
      <Modal
        title={preview?.name ?? '预览'}
        visible={preview !== null || previewLoading}
        onCancel={() => setPreview(null)}
        footer={null}
        style={{ width: 680, maxHeight: '80vh' }}
      >
        {previewLoading ? (
          <div className='py-8 text-center text-13px text-tertiary'>加载中…</div>
        ) : preview ? (
          preview.mime.startsWith('image/') && preview.mime !== 'image/svg+xml' ? (
            <img
              src={`data:${preview.mime};base64,${preview.content}`}
              alt={preview.name}
              className='max-w-full'
            />
          ) : (
            <pre className='max-h-[60vh] overflow-auto text-12px whitespace-pre-wrap break-words text-foreground'>
              {preview.content}
            </pre>
          )
        ) : null}
      </Modal>
    </div>
  )
}
