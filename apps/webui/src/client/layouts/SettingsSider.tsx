/**
 * 设置侧栏（摘取自 Sudowork layouts/components/SettingsSider.tsx，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * WebUI 范围：严格四项 —— 用户中心 / MCP 服务 / 显示 / 关于（计划 1.1 第 9 条）。
 */
import { Cable, Info, Monitor, User } from 'lucide-react'
import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import SidebarNavItem from '@sudowork/ui/components/SidebarNavItem'

const SETTINGS_ITEMS = [
  { id: 'profile', label: '用户中心', path: 'profile', Icon: User },
  { id: 'mcp', label: 'MCP 服务', path: 'mcp', Icon: Cable },
  { id: 'display', label: '显示', path: 'display', Icon: Monitor },
  { id: 'about', label: '关于', path: 'about', Icon: Info },
] as const

export function SettingsSider(): React.ReactElement {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className='flex-1 min-h-0 settings-sider flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden scrollbar-hide'>
      {SETTINGS_ITEMS.map((item) => {
        const selected = pathname === `/settings/${item.path}`
        return (
          <SidebarNavItem
            key={item.id}
            icon={<item.Icon size={20} strokeWidth={1.8} className='flex' />}
            label={item.label}
            selected={selected}
            className='settings-sider__item shrink-0'
            dataAttributes={{ 'data-settings-id': item.id }}
            onClick={() => void navigate(`/settings/${item.path}`)}
          />
        )
      })}
    </div>
  )
}
