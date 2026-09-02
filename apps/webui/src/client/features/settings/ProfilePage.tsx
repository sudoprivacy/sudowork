import React from 'react'
import useSWR from 'swr'
import { Descriptions, Spin } from '@arco-design/web-react'
import { settingsApi } from './settingsApi'

/** 用户中心（计划 Task 8）：只展示身份/部门/角色/用量，无改密入口（上游限制）。 */
export function ProfilePage(): React.ReactElement {
  const { data, isLoading, error } = useSWR('settings/profile', settingsApi.profile)

  if (isLoading) return <div className='size-full f-center'><Spin /></div>
  if (error) {
    return (
      <div className='size-full f-center text-13px text-danger' data-testid='profile-page'>
        用户信息加载失败
      </div>
    )
  }

  const raw = (data ?? {}) as Record<string, unknown>
  // 上游 user/profile 响应带 {success, data} 包装（实测）
  const profile = (raw.data as Record<string, unknown> | undefined) ?? raw
  const user = (profile.user ?? profile) as Record<string, unknown>

  return (
    <div className='size-full overflow-y-auto p-6' data-testid='profile-page'>
      <div className='max-w-2xl mx-auto flex flex-col gap-4'>
        <h1 className='text-20px font-700 m-0'>用户中心</h1>
        <Descriptions
          column={1}
          data={[
            { label: '用户名', value: String(user.name ?? user.username ?? user.displayName ?? '—') },
            { label: '用户 ID', value: String(user.id ?? user.userId ?? '—') },
            { label: '部门', value: String(user.departmentName ?? user.department ?? user.departmentId ?? '—') },
            { label: '角色', value: String(user.role ?? '—') },
            { label: '累计 Token', value: formatNum(profile.totalTokens ?? profile.total_tokens ?? user.totalTokens) },
            { label: '会话数', value: formatNum(profile.sessionCount ?? profile.session_count ?? user.sessionCount) },
          ]}
        />
        <div className='text-12px text-tertiary'>密码修改由管理员在 Moss 侧管理（当前版本无自助改密）。</div>
      </div>
    </div>
  )
}

function formatNum(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}
