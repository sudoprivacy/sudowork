/**
 * 会话页右侧面板（对齐 Sudowork ChatLayout 右栏 + ChatSider，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 2 个 tab（工作空间/交付物；终端 tab 可操作服务器 shell，按用户决策隐藏，组件与服务端入口保留）：
 * tab 条 + 常驻内容栈。
 * 宽度为像素制（对齐 Sudowork ChatLayout：max(300, min(500, ratio%×行宽))，ratio 拖拽 12%~40%，
 * 默认 20%，双击重置）——CSS 百分比在 auto 宽 flex 项内不可解析（max() 整体失效），必须 JS 算像素。
 * 组合差异说明：Sudowork 中头部开关按钮（Windows）与浮动展开箭头（Linux）按平台互斥，
 * webui 无平台之分且需求明确要求头部按钮，故两者兼做。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceTab } from './WorkspaceTab'
import { DeliverablesTab } from './DeliverablesTab'

const RATIO_KEY = 'chat-workspace-split-ratio'
const TAB_KEY_PREFIX = 'sudowork_right_panel_active_tab:'
const DEFAULT_RATIO = 20
const MIN_RATIO = 12
const MAX_RATIO = 40
const MIN_PANEL_PX = 300
/** 对齐 Sudowork effectiveWorkspaceMaxWidthPx（ChatLayout.tsx:343） */
const MAX_PANEL_PX = 500

export function RightPanel({
  conversationId,
  open,
  turnFinishedAt,
  workspaceRefreshKey,
}: {
  conversationId: string
  open: boolean
  /** turn 结束时间戳（result 后递增）：驱动工作空间/交付物刷新 */
  turnFinishedAt: number
  /** 会话进行中刷新信号（tool_use 防抖递增）：仅驱动工作空间，不打扰交付物 */
  workspaceRefreshKey: number
}): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ratio, setRatio] = useState<number>(() => {
    const stored = Number(localStorage.getItem(RATIO_KEY))
    return Number.isFinite(stored) && stored >= MIN_RATIO && stored <= MAX_RATIO ? stored : DEFAULT_RATIO
  })
  const [tab, setTab] = useState<'workspace' | 'deliverables'>(() => {
    const stored = localStorage.getItem(TAB_KEY_PREFIX + conversationId)
    return stored === 'workspace' || stored === 'deliverables' ? stored : 'workspace'
  })
  const [dragging, setDragging] = useState(false)
  /** 外层 flex 行宽度（ResizeObserver + 取整，防高 DPI 亚像素抖动，对齐 Sudowork ChatLayout:253-265） */
  const [rowWidth, setRowWidth] = useState(0)

  useEffect(() => {
    localStorage.setItem(TAB_KEY_PREFIX + conversationId, tab)
  }, [conversationId, tab])

  useEffect(() => {
    localStorage.setItem(RATIO_KEY, String(ratio))
  }, [ratio])

  // 量外层 flex 行（消息列+面板的父容器）宽度：RightPanel 根自身 auto 宽不可作基准。
  // 依赖 open：面板收起时组件返回 null、ref 未挂载，展开后需重新测量。
  useEffect(() => {
    const container = containerRef.current
    const row = container?.parentElement ?? null
    if (!row) {
      setRowWidth(0)
      return
    }
    setRowWidth(Math.round(row.clientWidth))
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      setRowWidth((prev) => (prev === width ? prev : width))
    })
    observer.observe(row)
    return () => {
      observer.disconnect()
    }
  }, [open])

  /** 像素宽度（对齐 Sudowork ChatLayout:344,411：clamp 到 [300, 500]，比例基准为行宽） */
  const panelWidth = rowWidth
    ? Math.max(MIN_PANEL_PX, Math.round(Math.min(MAX_PANEL_PX, Math.max(200, (ratio / 100) * rowWidth))))
    : MIN_PANEL_PX

  /** 左缘拖拽把手：向左拖变宽（reverse 语义对齐 Sudowork createWorkspaceDragHandle；基准为行宽） */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return
      const containerWidth = rowWidth || (container.parentElement?.clientWidth ?? 1)
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      setDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: PointerEvent): void => {
        const next = ((containerWidth - ev.clientX + container.getBoundingClientRect().left) / containerWidth) * 100
        const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, next))
        // minWidth 300px 兜底：比例换算后的像素宽度不小于 300
        if (clamped === MIN_RATIO && (clamped / 100) * containerWidth < MIN_PANEL_PX) {
          setRatio((MIN_PANEL_PX / containerWidth) * 100 > MAX_RATIO ? MAX_RATIO : (MIN_PANEL_PX / containerWidth) * 100)
        } else {
          setRatio(clamped)
        }
      }
      const onUp = (): void => {
        handle.releasePointerCapture(e.pointerId)
        setDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [rowWidth],
  )

  /** 双击重置默认比例 */
  const onDoubleClick = useCallback(() => setRatio(DEFAULT_RATIO), [])

  if (!open) return null

  return (
    <div ref={containerRef} className='relative flex h-full min-h-0 shrink-0'>
      <div
        className={`right-panel-drag-handle${dragging ? ' right-panel-drag-handle--active' : ''}`}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        aria-label='拖拽调整面板宽度'
      />
      <div
        className='flex h-full min-h-0 flex-col bg-[var(--color-bg-1)] border-l b-solid'
        style={{
          width: `${panelWidth}px`,
          borderLeft: '1px solid var(--bg-3)',
        }}
        data-testid='right-panel'
      >
        {/* tab 条 */}
        <div className='right-panel-tabs shrink-0' role='tablist'>
          {(
            [
              ['workspace', '工作空间'],
              ['deliverables', '交付物'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type='button'
              role='tab'
              aria-selected={tab === key}
              className={`right-panel-tabs__item${tab === key ? ' right-panel-tabs__item--active' : ''}`}
              onClick={() => setTab(key)}
              data-testid={`right-panel-tab-${key}`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 内容栈：常驻挂载，display 切换（对齐 Sudowork） */}
        <div className='right-panel-stack'>
          <div className={`right-panel-stack__pane${tab === 'workspace' ? ' right-panel-stack__pane--active' : ''}`}>
            <WorkspaceTab
              conversationId={conversationId}
              active={tab === 'workspace'}
              turnFinishedAt={turnFinishedAt}
              workspaceRefreshKey={workspaceRefreshKey}
            />
          </div>
          <div className={`right-panel-stack__pane${tab === 'deliverables' ? ' right-panel-stack__pane--active' : ''}`}>
            <DeliverablesTab conversationId={conversationId} active={tab === 'deliverables'} turnFinishedAt={turnFinishedAt} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 收起态浮动展开按钮（Sudowork Linux 形态：容器右缘垂直居中） */
export function RightPanelFloatingExpand({ onExpand }: { onExpand: () => void }): React.ReactElement {
  return (
    <button
      type='button'
      className='right-panel-floating-expand'
      onClick={onExpand}
      aria-label='展开右侧面板'
      data-testid='right-panel-floating-expand'
    >
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
        <polyline points='15 18 9 12 15 6' />
      </svg>
    </button>
  )
}
