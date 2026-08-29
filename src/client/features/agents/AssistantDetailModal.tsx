import React from 'react'
import { Modal } from '@arco-design/web-react'
import type { AgentItem } from './agentApi'

export function AssistantDetailModal({
  agent,
  onClose,
}: {
  agent: AgentItem | null
  onClose: () => void
}): React.ReactElement | null {
  if (!agent) return null
  const rows: [string, unknown][] = [
    ['名称', agent.displayName ?? agent.name],
    ['标识', agent.name],
    ['描述', agent.description ?? '—'],
  ]
  return (
    <Modal
      title={String(agent.displayName ?? agent.name)}
      visible
      footer={null}
      onCancel={onClose}
      style={{ width: 520 }}
      data-testid='assistant-detail-modal'
    >
      <div className='flex flex-col gap-2 text-14px'>
        {rows.map(([label, value]) => (
          <div key={label} className='flex gap-3'>
            <div className='w-16 shrink-0 text-secondary'>{label}</div>
            <div className='flex-1 break-words'>{String(value)}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
