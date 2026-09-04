/**
 * 初始页「智能体选中态」视图（对齐 Sudowork guid 选中态，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 结构：返回箭头 + emoji 头像 + 名称 + 描述卡。编辑按钮/agent 下拉/推荐提示词依赖 Sudowork 本地
 * 助手数据源，Moss 接口无对应字段，按计划裁剪不做。
 */
import React from 'react'
import { ArrowLeft, Bot } from 'lucide-react'
import { resolveAgentAvatar } from '@client/components/agentAvatar'

export interface SelectedAgentInfo {
  name: string
  displayName: string
  emoji: string
  description: string
  avatar: string
  promptsI18n: { 'zh-CN': string[] }
}

export function AgentSelectedView({
  agent,
  onBack,
}: {
  agent: SelectedAgentInfo
  onBack: () => void
}): React.ReactElement {
  return (
    <>
      {/* 头部：返回 + 头像 + 名称（对齐 Sudowork guid/index.tsx 选中态头部） */}
      <div className='flex items-center gap-12px flex-1 min-w-0 w-full mb-3 animate-fade-in animate-duration-400 animate-ease-out'>
        <div
          className='flex items-center justify-center w-32px h-32px rd-full cursor-pointer hover:bg-fill-2 transition-colors flex-shrink-0'
          onClick={onBack}
          aria-label='返回'
        >
          <ArrowLeft size={18} color='var(--color-text-2)' />
        </div>
        <div className='flex-shrink-0'>
          {(() => {
            const resolved = resolveAgentAvatar(agent.avatar)
            if (resolved?.kind === 'image') {
              return (
                <img src={resolved.value} alt={agent.displayName} className='w-24px h-24px rd-full object-cover' />
              )
            }
            if (resolved?.kind === 'emoji') {
              return <span style={{ fontSize: 24, lineHeight: '28px' }}>{resolved.value}</span>
            }
            return agent.emoji ? (
              <span style={{ fontSize: 24, lineHeight: '28px' }}>{agent.emoji}</span>
            ) : (
              <Bot size={24} />
            )
          })()}
        </div>
        <span className='text-xl font-semibold text-foreground truncate'>{agent.displayName}</span>
      </div>
      {/* 描述卡 */}
      <div className='w-full px-4 py-3 mb-4 rd-2xl text-sm border box-border animate-fade-in animate-duration-400 animate-ease-out'>
        {agent.description || '暂无描述'}
      </div>
    </>
  )
}
