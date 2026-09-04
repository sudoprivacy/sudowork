/**
 * 侧栏会话历史（对齐 Sudowork grouped-history，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 对话 tab：置顶区（dnd-kit 拖拽排序）+ 今天/昨天/最近7天/更早 分组（组头可折叠，localStorage 持久化）；
 * cron 会话不出现在普通时间线（仅定时任务 tab，对齐 Sudowork groupingHelpers 语义，前端过滤）。
 * 定时任务 tab：按 cron 任务名分组折叠。
 * 结构裁剪说明：Sudowork 为「时间→工作空间→会话」三级；webui 的 Moss 会话各自独立工作区、
 * 列表 DTO 无 workspace 字段，不做工作空间分组层（两级）。
 */
import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Empty, Modal, Message as ArcoMessage } from '@arco-design/web-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown } from 'lucide-react'
import type { ConversationListItem } from '@sudowork/contracts/conversations'
import {
  deleteConversation,
  getConversationOptions,
  listConversations,
  reorderPinnedConversations,
  updateConversationMeta,
} from './conversationApi'
import { ConversationRow } from './ConversationRow'
import { groupByTimeline, isCronConversation, parseSource, type TimelineLabel } from './grouping'

const EXPANSION_KEY = 'sudowork_timeline_expansion'
const SCHEDULED_EXPANSION_KEY = 'sudowork_scheduled_section_expanded'

function readExpandedSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function writeExpandedSet(key: string, set: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...set]))
}

export function ConversationHistory({ isScheduled }: { isScheduled: boolean }): React.ReactElement {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data, mutate } = useSWR('conversations', listConversations, { refreshInterval: 30_000 })
  const { data: options } = useSWR('conversation-options', getConversationOptions)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readExpandedSet(EXPANSION_KEY))
  const [scheduledCollapsed, setScheduledCollapsed] = useState(
    () => localStorage.getItem(SCHEDULED_EXPANSION_KEY) !== 'true',
  )
  const [confirmDelete, setConfirmDelete] = useState<ConversationListItem | null>(null)

  const agentIconByName = useMemo(() => {
    const map = new Map<string, { emoji: string; avatar: string }>()
    for (const a of options?.agents ?? []) map.set(a.displayName, { emoji: a.emoji, avatar: a.avatar })
    return map
  }, [options])

  const all = data?.conversations ?? []
  // cron 过滤在前端做（两个 tab 共用同一接口，服务端排除会让定时任务 tab 无数据）
  const items = all.filter((c) => (isScheduled ? isCronConversation(c.source) : !isCronConversation(c.source)))

  const toggleSection = (label: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      writeExpandedSet(EXPANSION_KEY, next)
      return next
    })
  }

  const handleOpen = (id: string): void => {
    void navigate(`/conversation/${id}`)
  }

  const handlePin = (item: ConversationListItem): void => {
    void updateConversationMeta(item.id, { pinned: !item.pinned }).then(() => mutate())
  }

  const handleRename = (item: ConversationListItem, title: string): void => {
    void updateConversationMeta(item.id, { title }).then(() => {
      ArcoMessage.success('已重命名')
      mutate()
    })
  }

  const handleDelete = (): void => {
    if (!confirmDelete) return
    const target = confirmDelete
    setConfirmDelete(null)
    void deleteConversation(target.id)
      .then(() => {
        ArcoMessage.success('已删除')
        if (pathname === `/conversation/${target.id}`) void navigate('/guid')
        mutate()
      })
      .catch(() => ArcoMessage.error('删除失败，请重试'))
  }

  if (items.length === 0) {
    return (
      <div className='size-full f-center' data-testid='conversation-history'>
        <Empty description={isScheduled ? '暂无执行记录' : '暂无对话历史'} />
      </div>
    )
  }

  if (isScheduled) {
    // 定时任务 tab：按 cron 任务名分组（默认折叠，对齐 Sudowork）
    const groups = new Map<string, ConversationListItem[]>()
    for (const c of items) {
      const name = parseSource(c.source)?.cronJobName ?? '未命名任务'
      const list = groups.get(name) ?? []
      list.push(c)
      groups.set(name, list)
    }
    return (
      <div
        className='size-full overflow-y-auto scrollbar-hide flex flex-col gap-0.5 px-1'
        data-testid='conversation-history'
      >
        {[...groups.entries()].map(([name, list]) => (
          <section key={name}>
            <button
              type='button'
              className='flex w-full items-center gap-1 px-3 py-2 text-13px text-secondary font-bold border-none bg-transparent cursor-pointer'
              onClick={() => {
                setScheduledCollapsed((v) => {
                  localStorage.setItem(SCHEDULED_EXPANSION_KEY, v ? 'true' : 'false')
                  return !v
                })
              }}
            >
              <ChevronDown
                size={12}
                className={`transition-transform ${scheduledCollapsed ? '-rotate-90' : ''}`}
              />
              <span className='truncate'>{name}</span>
              <span className='text-11px font-normal'>{list.length}</span>
            </button>
            {!scheduledCollapsed
              ? list.map((c) => (
                  <ConversationRow
                    key={c.id}
                    item={c}
                    active={pathname === `/conversation/${c.id}`}
                    emoji={c.assistantName ? (agentIconByName.get(c.assistantName)?.emoji ?? '') : ''}
                    avatar={c.assistantName ? (agentIconByName.get(c.assistantName)?.avatar ?? '') : ''}
                    onOpen={() => handleOpen(c.id)}
                    onPin={() => handlePin(c)}
                    onRename={(t) => handleRename(c, t)}
                    onDelete={() => setConfirmDelete(c)}
                  />
                ))
              : null}
          </section>
        ))}
        <DeleteConfirmModal visible={confirmDelete !== null} onOk={handleDelete} onCancel={() => setConfirmDelete(null)} />
      </div>
    )
  }

  return <TimelineHistory
    items={items}
    pathname={pathname}
    collapsed={collapsed}
    agentIconByName={agentIconByName}
    onToggle={toggleSection}
    onOpen={handleOpen}
    onPin={handlePin}
    onRename={handleRename}
    onDelete={setConfirmDelete}
    onRefresh={() => void mutate()}
  >
    <DeleteConfirmModal visible={confirmDelete !== null} onOk={handleDelete} onCancel={() => setConfirmDelete(null)} />
  </TimelineHistory>
}

function DeleteConfirmModal({
  visible,
  onOk,
  onCancel,
}: {
  visible: boolean
  onOk: () => void
  onCancel: () => void
}): React.ReactElement {
  return (
    <Modal
      title='删除会话'
      visible={visible}
      onCancel={onCancel}
      onOk={onOk}
      okText='删除'
      cancelText='取消'
      okButtonProps={{ status: 'danger' }}
    >
      删除后将终止该会话，且不可恢复。确定删除吗？
    </Modal>
  )
}

/** 普通时间线（置顶拖拽区 + 时间分组折叠） */
function TimelineHistory({
  items,
  pathname,
  collapsed,
  agentIconByName,
  onToggle,
  onOpen,
  onPin,
  onRename,
  onDelete,
  onRefresh,
  children,
}: {
  items: ConversationListItem[]
  pathname: string
  collapsed: Set<string>
  agentIconByName: Map<string, { emoji: string; avatar: string }>
  onToggle: (label: string) => void
  onOpen: (id: string) => void
  onPin: (item: ConversationListItem) => void
  onRename: (item: ConversationListItem, title: string) => void
  onDelete: (item: ConversationListItem) => void
  onRefresh: () => void
  children: React.ReactNode
}): React.ReactElement {
  const pinned = useMemo(
    () => items.filter((c) => c.pinned).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [items],
  )
  const [pinnedOrder, setPinnedOrder] = useState<string[] | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const orderedPinned = useMemo(() => {
    if (!pinnedOrder) return pinned
    const map = new Map(pinned.map((c) => [c.id, c]))
    const ordered = pinnedOrder.map((id) => map.get(id)).filter((c): c is ConversationListItem => Boolean(c))
    // 新置顶（不在旧序里）的追加到末尾
    for (const c of pinned) if (!pinnedOrder.includes(c.id)) ordered.push(c)
    return ordered
  }, [pinned, pinnedOrder])

  const timelineItems = useMemo(() => items.filter((c) => !c.pinned), [items])
  const groups = useMemo(() => groupByTimeline(timelineItems), [timelineItems])

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedPinned.findIndex((c) => c.id === active.id)
    const newIndex = orderedPinned.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(orderedPinned, oldIndex, newIndex)
    setPinnedOrder(next.map((c) => c.id))
    void reorderPinnedConversations(next.map((c) => c.id)).then(() => onRefresh())
  }

  return (
    <div className='size-full overflow-y-auto scrollbar-hide flex flex-col gap-0.5 px-1' data-testid='conversation-history'>
      {orderedPinned.length > 0 ? (
        <section>
          <div className='px-3 py-2 text-13px text-secondary font-bold'>置顶</div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={orderedPinned.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {orderedPinned.map((c) => (
                <SortableRow
                  key={c.id}
                  item={c}
                  active={pathname === `/conversation/${c.id}`}
                  emoji={c.assistantName ? (agentIconByName.get(c.assistantName)?.emoji ?? '') : ''}
                  avatar={c.assistantName ? (agentIconByName.get(c.assistantName)?.avatar ?? '') : ''}
                  onOpen={() => onOpen(c.id)}
                  onPin={() => onPin(c)}
                  onRename={(t) => onRename(c, t)}
                  onDelete={() => onDelete(c)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </section>
      ) : null}
      {groups.map(({ label, items: list }: { label: TimelineLabel; items: ConversationListItem[] }) => (
        <section key={label}>
          <button
            type='button'
            className='flex w-full items-center gap-1 px-3 py-2 text-13px text-secondary font-bold border-none bg-transparent cursor-pointer'
            onClick={() => onToggle(label)}
          >
            <ChevronDown size={12} className={`transition-transform ${collapsed.has(label) ? '-rotate-90' : ''}`} />
            {label}
          </button>
          {!collapsed.has(label)
            ? list.map((c) => (
                <ConversationRow
                  key={c.id}
                  item={c}
                  active={pathname === `/conversation/${c.id}`}
                  emoji={c.assistantName ? (agentIconByName.get(c.assistantName)?.emoji ?? '') : ''}
                  avatar={c.assistantName ? (agentIconByName.get(c.assistantName)?.avatar ?? '') : ''}
                  onOpen={() => onOpen(c.id)}
                  onPin={() => onPin(c)}
                  onRename={(t) => onRename(c, t)}
                  onDelete={() => onDelete(c)}
                />
              ))
            : null}
        </section>
      ))}
      {children}
    </div>
  )
}

/** 可拖拽的置顶行 */
function SortableRow(props: React.ComponentProps<typeof ConversationRow>): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-60 z-10' : ''}
      {...attributes}
      {...listeners}
    >
      <ConversationRow {...props} />
    </div>
  )
}
