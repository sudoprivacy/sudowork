import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@client/features/cron/cronApi', () => ({
  cronApi: {
    list: vi.fn().mockResolvedValue({
      jobs: [
        {
          id: 'job-1',
          name: '每日日报',
          enabled: true,
          schedule: { kind: 'cron', value: '0 9 * * *' },
          conversationMode: 'new',
          lastStatus: 'success',
        },
        {
          id: 'job-2',
          name: '间隔任务',
          enabled: false,
          schedule: { kind: 'every', value: '30m' },
          conversationMode: 'reuse',
          boundSessionId: 'sess-x',
        },
      ],
      canCreate: true,
    }),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({}),
    trigger: vi.fn().mockResolvedValue({}),
    runs: vi.fn().mockResolvedValue({ runs: [] }),
  },
}))

import { CronPage } from '@client/features/cron/CronPage'
import { cronApi } from '@client/features/cron/cronApi'

describe('CronPage（计划 Task 7）', () => {
  test('renders jobs with schedule value and operations', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <CronPage />
        </MemoryRouter>
      </SWRConfig>,
    )
    await waitFor(() => expect(screen.getByText('每日日报')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('间隔任务')).toBeTruthy()
    expect(screen.getByText('cron: 0 9 * * *')).toBeTruthy()
    expect(screen.getByText('every: 30m')).toBeTruthy()
    // canCreate → 新建按钮可见
    expect(screen.getByText('新建任务')).toBeTruthy()

    // 触发操作
    fireEvent.click(screen.getAllByText('触发')[0]!)
    await waitFor(() => expect(cronApi.trigger).toHaveBeenCalledWith('job-1'), { timeout: 5000 })
  })
})
