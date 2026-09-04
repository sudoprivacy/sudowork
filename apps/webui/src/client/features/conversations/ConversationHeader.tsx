/**
 * 会话页头部（对齐 Sudowork ChatLayout headerBlock，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 左：模型选择 + 标题；右：连接状态点 + SudoCode 标识 + 右侧面板开关。
 * 状态点语义对齐 Sudowork AgentStatusDot（连接状态而非 turn 运行态）；Sudowork 的
 * Connection 图标与"重启连接"下拉依赖其本地重连机制，webui socket 无重连逻辑，仅做色点。
 */
import React from 'react'
import { Dropdown, Menu } from '@arco-design/web-react'
import { PanelRight } from 'lucide-react'
import chinaTelecomLogo from '@client/assets/china-telecom-logo.svg'

/** Sudowork AgentStatusBanner DOT_COLORS 的三态映射（webui socket 无 error 态） */
const STATUS_DOT_COLORS: Record<'connecting' | 'open' | 'closed', string> = {
  connecting: '#165dff',
  open: '#00b42a',
  closed: '#ff7d00',
}

export function ConversationHeader({
  title,
  socketStatus,
  models,
  currentModel,
  onSetModel,
  onTogglePanel,
  statusHint,
  modelError,
}: {
  title: string
  socketStatus: 'connecting' | 'open' | 'closed'
  models: { id: string; name: string }[]
  currentModel: string | null
  onSetModel: (modelId: string) => void
  onTogglePanel: () => void
  statusHint: string | null
  modelError: string | null
}): React.ReactElement {
  const currentName =
    models.find((m) => m.id === currentModel || m.id === currentModel?.replace(/^proxy\//, ''))?.name
    ?? (currentModel ? currentModel.replace(/^proxy\//, '') : (models[0]?.name ?? '模型'))
  return (
    <div className='h-9 flex items-center justify-between p-4 gap-4 !bg-1 chat-layout-header overflow-hidden shrink-0'>
      <div className='flex flex-1 items-center gap-3 min-w-0'>
        {/* 模型选择 */}
        <Dropdown
          trigger='click'
          position='bl'
          droplist={
            <Menu style={{ minWidth: 220, maxHeight: 360, overflowY: 'auto' }}>
              {models.map((m) => (
                <Menu.Item key={m.id} onClick={() => onSetModel(m.id)}>
                  <span className='flex items-center gap-2'>
                    <span
                      className='inline-block size-1.5 rounded-full'
                      style={{ background: m.name === currentName ? 'var(--primary)' : 'var(--color-text-4)' }}
                    />
                    <span className='truncate'>{m.name}</span>
                  </span>
                </Menu.Item>
              ))}
            </Menu>
          }
        >
          <button
            type='button'
            aria-label='模型选择'
            className='inline-flex h-7 min-w-0 max-w-40 items-center gap-2 rd-full border px-3 text-13px font-500 transition-colors bg-fill-2 text-secondary hover:bg-fill-3 hover:text-foreground'
          >
            <span className='min-w-0 truncate'>{currentName}</span>
          </button>
        </Dropdown>
        {/* 会话标题 */}
        <div className='min-w-0 truncate text-14px font-600 text-foreground'>{title}</div>
      </div>
      <div className='flex items-center gap-3 shrink-0'>
        {modelError ? <span className='text-12px text-warning'>{modelError}</span> : null}
        {statusHint ? <span className='text-12px text-warning'>{statusHint}</span> : null}
        {/* 连接状态点 */}
        <span
          className='inline-block size-8px rounded-full shrink-0'
          style={{ background: STATUS_DOT_COLORS[socketStatus] }}
          aria-label={`连接状态 ${socketStatus}`}
          data-testid='conn-status-dot'
        />
        {/* SudoCode 标识（Sudowork 对应位置为 Remote Agent） */}
        <span className='inline-flex items-center gap-1 shrink-0'>
          <img
            src={chinaTelecomLogo}
            alt='CTCode'
            height={16}
            className='block h-4 w-auto max-w-none object-contain'
          />
          <span className='text-13px font-600 text-foreground'>CTCode</span>
        </span>
        {/* 右侧面板开关 */}
        <button
          type='button'
          aria-label='切换右侧面板'
          data-testid='toggle-right-panel'
          className='inline-flex items-center justify-center size-7 rd-4 cursor-pointer border-none bg-transparent text-secondary hover:bg-fill-2 transition-colors'
          onClick={onTogglePanel}
        >
          <PanelRight size={16} />
        </button>
      </div>
    </div>
  )
}
