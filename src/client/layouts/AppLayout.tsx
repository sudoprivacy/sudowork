/**
 * 应用外壳（摘取自 Sudowork layouts/layout.tsx，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 按 WebUI 范围裁剪：移除 Titlebar/UpdateModal/DebugPanel/DeepLink/目录选择等 Electron 能力。
 */
import { Layout as ArcoLayout } from '@arco-design/web-react'
import React from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { MainSider } from './MainSider'

const DEFAULT_SIDER_WIDTH = 260

export function AppLayout(): React.ReactElement {
  const navigate = useNavigate()

  const goToNewConversation = (): void => {
    void navigate('/guid')
  }

  return (
    <div
      className='app-shell relative flex flex-col size-full min-h-0 app-shell--sider-divider'
      style={{ '--layout-sider-width': `${DEFAULT_SIDER_WIDTH}px` } as React.CSSProperties}
    >
      <ArcoLayout className='size-full layout flex-1 min-h-0'>
        <ArcoLayout.Sider
          collapsedWidth={0}
          collapsed={false}
          width={DEFAULT_SIDER_WIDTH}
          className='layout-sider'
        >
          <ArcoLayout.Header className='flex items-center justify-start py-2 px-4 pl-4.5 gap-2.5 layout-sider-header'>
            <div
              className='shrink-0 size-8.5 relative rd-0.5rem f-center cursor-pointer'
              onClick={goToNewConversation}
              aria-label='新会话'
            >
              <div
                className='absolute inset-0 m-auto w-5 h-5 rd-2 f-center text-12px font-800 text-white bg-[var(--ui-accent-orange)]'
                style={{ objectFit: 'contain' }}
              >
                S
              </div>
            </div>
            <div
              className='flex-1 text-20px text-1 font-800 cursor-pointer'
              onClick={goToNewConversation}
            >
              Sudowork
            </div>
          </ArcoLayout.Header>
          <ArcoLayout.Content className='p-2.5 layout-sider-content'>
            <MainSider />
          </ArcoLayout.Content>
        </ArcoLayout.Sider>

        <ArcoLayout.Content className='bg-2 layout-content flex flex-col min-h-0 overflow-y-hidden'>
          <Outlet />
        </ArcoLayout.Content>
      </ArcoLayout>
    </div>
  )
}
