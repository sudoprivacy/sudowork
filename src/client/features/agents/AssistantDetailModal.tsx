/**
 * 智能体详情弹窗（布局对齐 Sudowork AssistantDetailModal）。
 */
import React from 'react'
import { Button, Modal } from '@arco-design/web-react'
import { Bot } from 'lucide-react'
import type { AgentItem } from './agentApi'

export function AssistantDetailModal({
  agent,
  onClose,
}: {
  agent: AgentItem | null
  onClose: () => void
}): React.ReactElement | null {
  if (!agent) return null
  const displayName = String(agent.displayName ?? agent.display_name ?? agent.name ?? '')
  const categories = Array.isArray((agent as unknown as { categories?: unknown }).categories)
    ? ((agent as unknown as { categories: string[] }).categories ?? [])
    : []

  return (
    <Modal visible onCancel={onClose} footer={null} style={{ width: 480 }} data-testid='assistant-detail-modal'>
      <div className='flex flex-col max-h-80vh'>
        <div className='flex-1 min-h-0 overflow-y-auto'>
          <div className='px-2 pb-4'>
            {/* 头部：居中大图标 + 名称 + 分类 */}
            <div className='flex flex-col items-center mb-5'>
              <div className='size-18 rd-14px overflow-hidden mb-3 bg-control f-center'>
                <Bot size={34} className='text-primary' />
              </div>
              <div className='font-semibold text-17px text-foreground text-center'>{displayName}</div>
              {categories.length > 0 ? (
                <div className='flex gap-1 mt-1.5 flex-wrap justify-center'>
                  {categories.map((cat) => (
                    <span key={cat} className='px-7px py-1px bg-control text-secondary text-11px rd-1'>
                      {cat}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className='space-y-4'>
              <div className='bg-faint rd-10px p-3.5'>
                <div className='flex items-center gap-1.5 mb-2'>
                  <span className='text-14px'>✦</span>
                  <span className='font-medium text-13px text-foreground'>助手介绍</span>
                </div>
                <div className='text-12px text-secondary leading-relaxed'>
                  {String(agent.description ?? '暂无描述')}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className='px-2 pt-3 border-t border-light mt-1'>
          <div className='flex gap-2 items-center'>
            <Button type='primary' long size='large' className='flex-1' onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
