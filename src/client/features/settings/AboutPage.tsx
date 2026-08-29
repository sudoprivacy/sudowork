import React from 'react'
import useSWR from 'swr'
import { Descriptions, Spin } from '@arco-design/web-react'
import { settingsApi } from './settingsApi'

/** 关于（计划 Task 8）：tenant branding + WebUI build 元数据；无 updater/Electron 组件。 */
export function AboutPage(): React.ReactElement {
  const { data, isLoading } = useSWR('settings/about', settingsApi.about)

  if (isLoading) return <div className='size-full f-center'><Spin /></div>

  const about = (data ?? {}) as {
    branding?: { appName?: string; logo?: string }
    webui?: { name?: string; version?: string; node?: string }
    mossBaseUrl?: string
  }

  return (
    <div className='size-full overflow-y-auto p-6' data-testid='about-page'>
      <div className='max-w-xl mx-auto flex flex-col gap-4'>
        <h1 className='text-20px font-700 m-0'>关于</h1>
        <Descriptions
          column={1}
          data={[
            { label: '应用', value: about.branding?.appName ?? 'Sudowork WebUI' },
            { label: 'WebUI', value: about.webui?.name ?? 'sudowork-webui' },
            { label: 'WebUI 版本', value: about.webui?.version ?? '0.1.0' },
            { label: 'Node', value: about.webui?.node ?? '—' },
            { label: 'Moss 服务', value: about.mossBaseUrl ?? '—' },
          ]}
        />
        <div className='text-12px text-tertiary'>
          本服务不修改 Moss；会话与业务数据均以 Moss 为唯一来源。
        </div>
      </div>
    </div>
  )
}
