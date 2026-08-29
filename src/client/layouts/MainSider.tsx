/**
 * 主侧栏（摘取自 Sudowork layouts/components/Sider.tsx，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 按 WebUI 范围裁剪（计划 Task 4）：
 * - 保留：新会话、Agent、Skill、Cron 菜单；对话/定时任务历史 Tab；用户设置/退出
 * - 移除：批量管理、本地知识库、安全中心、频道、团队、游客模式、command palette
 */
import { AlarmClock, ArrowLeft, Bot, ChevronDown, LogOut, Plus, Settings, Sparkles } from 'lucide-react'
import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Dropdown, Menu, Tabs } from '@arco-design/web-react'
import { useSession } from '@client/features/auth/useAuth'
import { logout } from '@client/features/auth/authApi'
import SidebarNavItem from '@client/components/SidebarNavItem'
import { SettingsSider } from './SettingsSider'

const SIDER_TAB_STORAGE_KEY = 'sudowork_sider_tab'

export function MainSider(): React.ReactElement {
  const pathname = useLocation().pathname
  const navigate = useNavigate()
  const { session } = useSession()

  const isSettings = pathname.startsWith('/settings')

  const [activeTab, setActiveTab] = useState<'timeline' | 'scheduled'>(() => {
    try {
      const stored = localStorage.getItem(SIDER_TAB_STORAGE_KEY)
      if (stored === 'scheduled') return 'scheduled'
    } catch {
      // ignore
    }
    return 'timeline'
  })

  const menus = [
    { id: 'agent', label: '智能体', path: '/agents' },
    { id: 'skills', label: '技能库', path: '/skills' },
    { id: 'cron', label: '定时任务', path: '/cron' },
  ]

  const userName = session?.user?.name ?? '未登录'

  const handleLogout = async (): Promise<void> => {
    try {
      await logout()
    } finally {
      // 硬刷新清空 SWR 缓存，避免残留上一个用户的数据（计划 3.7）
      window.location.assign('/login')
    }
  }

  const goNewConversation = (): void => {
    void navigate('/guid')
  }

  if (isSettings) {
    return (
      <div className='size-full flex flex-col'>
        <div className='flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
          <SettingsSider />
        </div>
        <div className='shrink-0 mt-auto pt-2 px-0'>
          <div
            className='border rd-3 flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors hover:bg-hover active:bg-fill-2 ml-0.5'
            onClick={() => void navigate('/guid')}
          >
            <div className='size-8 rd-50% bg-fill-3 f-center text-foreground text-14px font-bold shrink-0'>
              <ArrowLeft size={16} strokeWidth={1.8} />
            </div>
            <div className='flex-1 min-w-0'>
              <div className='text-14px font-medium text-foreground truncate'>返回</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='size-full flex flex-col'>
      <div className='flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
        <div className='h-full min-h-0 flex flex-col overflow-hidden py-2 box-border'>
          <div className='min-h-0 shrink overflow-y-auto scrollbar-hide'>
            {/* 新会话 */}
            <div
              className='h-10.5 flex-shrink-0 f-center gap-2 px-3.5 mb-3 rd-3 cursor-pointer transition-all border bg-subtle hover:bg-hover active:bg-fill-2'
              onClick={goNewConversation}
              data-testid='new-conversation'
            >
              <Plus size={18} strokeWidth={1.8} className='text-foreground shrink-0' />
              <span className='text-15px font-medium text-foreground truncate'>新会话</span>
            </div>

            {/* 功能菜单：仅 Agent / Skill / Cron（计划 1.1） */}
            <div className='mb-4 flex flex-col gap-0.5'>
              {menus.map((menu) => {
                const selected = pathname === menu.path
                const icons = {
                  agent: <Bot size={20} strokeWidth={1.8} className='block leading-none' />,
                  skills: <Sparkles size={20} strokeWidth={1.8} className='block leading-none' />,
                  cron: <AlarmClock size={20} strokeWidth={1.8} className='block leading-none' />,
                } as const
                return (
                  <SidebarNavItem
                    key={menu.id}
                    icon={icons[menu.id as keyof typeof icons]}
                    label={menu.label}
                    selected={selected}
                    dataAttributes={{ 'data-menu-id': menu.id }}
                    onClick={() => void navigate(menu.path)}
                  />
                )
              })}
            </div>
          </div>

          {/* 对话 / 定时任务 历史 Tab（历史列表在 Task 5 填充） */}
          <div className='shrink-0 mb-2 px-2 flex items-center justify-between'>
            <Tabs
              className='sidebar-tabs flex-1 shrink-0'
              type='line'
              activeTab={activeTab}
              headerPadding={false}
              onChange={(tab) => {
                const next = tab as 'timeline' | 'scheduled'
                setActiveTab(next)
                try {
                  localStorage.setItem(SIDER_TAB_STORAGE_KEY, next)
                } catch {
                  // ignore
                }
              }}
            >
              <Tabs.TabPane key='timeline' title='对话' />
              <Tabs.TabPane key='scheduled' title='定时任务' />
            </Tabs>
          </div>

          <div className='flex min-h-24 flex-1 flex-col' data-testid='history-list-placeholder'>
            <div className='size-full f-center text-12px text-tertiary'>历史列表（Task 5）</div>
          </div>
        </div>
      </div>

      {/* 用户区 */}
      <div className='shrink-0 mt-auto pt-2 px-0'>
        <Dropdown
          droplist={
            <Menu
              style={{ minWidth: 200 }}
              onClickMenuItem={(key) => {
                if (key === 'settings') {
                  void navigate('/settings/profile')
                } else if (key === 'logout') {
                  void handleLogout()
                }
              }}
            >
              <Menu.Item key='settings'>
                <div className='flex items-center gap-2.5'>
                  <Settings size={17} strokeWidth={1.8} className='text-secondary' />
                  <span>设置</span>
                </div>
              </Menu.Item>
              <Menu.Item key='logout'>
                <div className='flex items-center gap-2.5 text-danger'>
                  <LogOut size={17} strokeWidth={1.8} className='text-danger' />
                  <span>退出登录</span>
                </div>
              </Menu.Item>
            </Menu>
          }
          trigger='click'
          position='tr'
        >
          <div className='flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors rd-3 border hover:bg-hover active:bg-fill-2 ml-0.5'>
            <div className='size-8 rd-50% bg-fill-3 f-center text-foreground text-14px font-bold shrink-0'>
              <span>{userName.charAt(0).toUpperCase()}</span>
            </div>
            <div className='flex-1 min-w-0'>
              <div className='text-14px font-medium text-foreground truncate'>{userName}</div>
              <div className='text-12px text-secondary truncate'>
                {session?.organization?.name ?? ''}
              </div>
            </div>
            <ChevronDown size={16} strokeWidth={1.8} className='shrink-0 text-secondary' />
          </div>
        </Dropdown>
      </div>
    </div>
  )
}
