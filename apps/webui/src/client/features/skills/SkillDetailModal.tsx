import React from 'react'
import { Modal } from '@arco-design/web-react'
import type { SkillItem } from './skillApi'

export function SkillDetailModal({
  skill,
  onClose,
}: {
  skill: SkillItem | null
  onClose: () => void
}): React.ReactElement | null {
  if (!skill) return null
  return (
    <Modal
      title={skill.name}
      visible
      footer={null}
      onCancel={onClose}
      style={{ width: 520 }}
      data-testid='skill-detail-modal'
    >
      <div className='text-14px break-words'>{String(skill.description ?? '暂无描述')}</div>
    </Modal>
  )
}
