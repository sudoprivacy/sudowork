/**
 * 历史会话单行（对齐 Sudowork ConversationRow，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 单行布局（不显示时间戳——时间仅作分组依据）；hover 行尾渐隐遮罩 + 三点菜单
 * （置顶/重命名/删除）；「导出」不做（Sudowork 仅本地会话有，webui 全远程）。
 */
import React, { useState } from 'react'
import { Dropdown, Menu, Modal, Input, Message as ArcoMessage } from '@arco-design/web-react'
import { MessageOne } from '@icon-park/react'
import { Pin } from 'lucide-react'
import type { ConversationListItem } from '@sudowork/contracts/conversations'
import { resolveAgentAvatar } from '@client/components/agentAvatar'

export function ConversationRow({
  item,
  active,
  emoji,
  avatar,
  onOpen,
  onPin,
  onRename,
  onDelete,
}: {
  item: ConversationListItem
  active: boolean
  emoji: string | null
  avatar: string | null
  onOpen: () => void
  onPin: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.ReactElement {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')

  const title = item.title ?? item.assistantName ?? '会话'

  return (
    <>
      <div
        data-testid='conversation-row'
        className={`chat-history__item group relative flex w-full items-center overflow-hidden rounded-lg px-3 py-2 cursor-pointer shrink-0 min-w-0 transition-colors conversation-item ${
          active ? '!bg-active conversation-item--selected' : 'hover:bg-hover'
        }`}
        onClick={onOpen}
      >
        {/* 前置图标：头像（tenant 走同源代理）/ emoji / 兜底 MessageOne（对齐 Sudowork ConversationRow） */}
        <span className='mr-2 inline-flex size-20px shrink-0 items-center justify-center overflow-hidden'>
          {(() => {
            const resolved = resolveAgentAvatar(avatar)
            if (resolved?.kind === 'image') {
              return <img src={resolved.value} alt='' className='h-20px w-20px object-contain' />
            }
            if (resolved?.kind === 'emoji') {
              return <span className='text-14px leading-none'>{resolved.value}</span>
            }
            return emoji ? (
              <span className='text-14px leading-none'>{emoji}</span>
            ) : (
              <MessageOne theme='outline' size='20' className='line-height-0 flex-shrink-0' />
            )
          })()}
        </span>
        {/* 标题（单行截断；不显示时间戳，对齐 Sudowork） */}
        <span
          className={`min-w-0 flex-1 truncate text-14px lh-24px whitespace-nowrap transition-all ${
            active ? 'text-1 font-medium' : 'text-2 group-hover:mr-9'
          }`}
        >
          {title}
        </span>
        {/* 置顶标记 */}
        {item.pinned ? (
          <Pin size={14} className='ml-1 shrink-0 text-secondary' aria-label='已置顶' />
        ) : null}
        {/* hover 渐隐遮罩 + 三点菜单 */}
        <span className='conversation-item__menu absolute right-6px top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity'>
          <Dropdown
            trigger='click'
            position='br'
            droplist={
              <Menu style={{ minWidth: 120 }}>
                <Menu.Item key='pin' onClick={(e) => { e?.stopPropagation?.(); onPin() }}>
                  {item.pinned ? '取消置顶' : '置顶'}
                </Menu.Item>
                <Menu.Item
                  key='rename'
                  onClick={(e) => {
                    e?.stopPropagation?.()
                    setDraft(title)
                    setRenaming(true)
                  }}
                >
                  重命名
                </Menu.Item>
                <Menu.Item key='delete' style={{ color: 'rgb(var(--red-6))' }} onClick={(e) => { e?.stopPropagation?.(); onDelete() }}>
                  删除
                </Menu.Item>
              </Menu>
            }
          >
            <button
              type='button'
              aria-label='会话操作'
              className='flex items-center border-none bg-transparent cursor-pointer p-1'
              onClick={(e) => e.stopPropagation()}
            >
              <span className='flex flex-col gap-0.5'>
                <span className='block w-0.5 h-0.5 rounded-full bg-current' />
                <span className='block w-0.5 h-0.5 rounded-full bg-current' />
                <span className='block w-0.5 h-0.5 rounded-full bg-current' />
              </span>
            </button>
          </Dropdown>
        </span>
      </div>
      {/* 重命名 Modal（对齐 Sudowork 重命名弹窗语义） */}
      <Modal
        title='重命名会话'
        visible={renaming}
        onCancel={() => setRenaming(false)}
        onOk={() => {
          const next = draft.trim()
          if (!next) {
            ArcoMessage.warning('标题不能为空')
            return
          }
          onRename(next)
          setRenaming(false)
        }}
        okText='保存'
        cancelText='取消'
        style={{ width: 380 }}
      >
        <Input
          value={draft}
          onChange={setDraft}
          placeholder='输入会话标题'
          aria-label='会话标题'
          maxLength={100}
        />
      </Modal>
    </>
  )
}
