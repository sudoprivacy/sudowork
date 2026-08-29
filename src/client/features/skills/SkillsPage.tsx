import React, { useState } from 'react'
import { Message, Tabs } from '@arco-design/web-react'
import { useSkills } from './useSkills'
import { skillApi, type SkillItem } from './skillApi'
import { SkillCard } from './SkillCard'
import { SkillDetailModal } from './SkillDetailModal'

/** 技能库页面（计划 Task 6）：Enabled 开关为 admin:settings（服务端强制）。 */
export function SkillsPage(): React.ReactElement {
  const { installed, isLoading, canManage, refresh } = useSkills()
  const [detail, setDetail] = useState<SkillItem | null>(null)

  async function handleToggle(name: string, enabled: boolean): Promise<void> {
    try {
      await skillApi.setEnabled(name, enabled)
      Message.success(`${name} 已${enabled ? '启用' : '停用'}`)
      refresh()
    } catch (err) {
      Message.error(`操作失败：${(err as Error).message}`)
    }
  }

  async function handleUninstall(name: string): Promise<void> {
    try {
      await skillApi.uninstall(name)
      Message.success(`已卸载 ${name}`)
      refresh()
    } catch (err) {
      Message.error(`卸载失败：${(err as Error).message}`)
    }
  }

  return (
    <div className='size-full overflow-y-auto p-5' data-testid='skills-page'>
      <div className='max-w-5xl mx-auto flex flex-col gap-4'>
        <h1 className='text-20px font-700 m-0'>技能库</h1>
        <Tabs defaultActiveTab='installed'>
          <Tabs.TabPane key='installed' title={`已安装 (${installed.length})`}>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-3'>
              {isLoading ? <div className='text-13px text-tertiary'>加载中…</div> : null}
              {!isLoading && installed.length === 0 ? (
                <div className='text-13px text-tertiary'>暂无已安装技能</div>
              ) : null}
              {installed.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  canManage={canManage}
                  onDetail={() => setDetail(skill)}
                  onToggle={(enabled) => void handleToggle(skill.name, enabled)}
                  onUninstall={() => void handleUninstall(skill.name)}
                />
              ))}
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>
      <SkillDetailModal skill={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
