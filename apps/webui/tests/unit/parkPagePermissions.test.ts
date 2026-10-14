import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import ParkLeadsPage from '@sudowork/renderer/pages/park/leads/index'
import ParkLeadDetailPage from '@sudowork/renderer/pages/park/leads/detail'

const state = vi.hoisted(() => ({ role: 'park_ops', userId: 'ops-1' }))

vi.mock('@arco-design/web-react', async () => {
  const { createElement } = await import('react')
  const Container = ({ children }: { children?: import('react').ReactNode }) =>
    createElement('div', null, children)
  return {
    Button: ({ children }: { children?: import('react').ReactNode }) =>
      createElement('button', null, children),
    Card: Container,
    Descriptions: () => null,
    Input: () => createElement('input'),
    Message: { success: vi.fn(), error: vi.fn() },
    Modal: ({ visible, children }: { visible: boolean; children?: import('react').ReactNode }) =>
      visible ? createElement('div', null, children) : null,
    Radio: Object.assign(Container, { Group: Container }),
    Select: Object.assign(Container, { Option: Container }),
    Space: Container,
    Table: () => null,
    Tag: Container,
    Typography: { Text: Container },
  }
})
vi.mock('@arco-design/web-react/icon', () => ({ IconPlus: () => null }))
vi.mock('@renderer/components/base/PageWrapper', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      title,
      actions,
      children,
    }: {
      title: import('react').ReactNode
      actions?: import('react').ReactNode
      children?: import('react').ReactNode
    }) => createElement('div', null, title, actions, children),
  }
})
vi.mock('@renderer/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: state.userId } }),
}))
vi.mock('@renderer/hooks/usePark', () => ({
  useParkOrgId: () => ({ parkOrgId: 'park-1', role: state.role }),
  useParkQuery: (method: string) => ({
    data:
      method === 'getLeadDetail'
        ? {
            lead_id: 'lead-1',
            enterprise_org_id: 'ent-1',
            status: 'assigned',
            owner_id: 'ops-1',
            industry_tags: [],
          }
        : { items: [] },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  invokePark: vi.fn(),
}))

const rendererRequire = createRequire(
  resolve(process.cwd(), '../../packages/renderer/package.json'),
)
const React = rendererRequire('react') as typeof import('react')
const { renderToStaticMarkup } = rendererRequire(
  'react-dom/server',
) as typeof import('react-dom/server')
const { MemoryRouter } = rendererRequire('react-router-dom') as typeof import('react-router-dom')
function renderPage(Page: typeof ParkLeadsPage = ParkLeadsPage): string {
  return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Page)))
}

describe('park 页面权限渲染', () => {
  it('招商运营显示新建线索，领导显示关注筛选', () => {
    state.role = 'park_ops'
    const opsHtml = renderPage()
    expect(opsHtml).toContain('新建线索')
    expect(opsHtml).not.toContain('已关注')

    state.role = 'park_leader'
    const leaderHtml = renderPage()
    expect(leaderHtml).toContain('已关注')
    expect(leaderHtml).not.toContain('新建线索')
  })

  it('线索已分派时仅领导显示负责人分派，运营只显示跟进操作', () => {
    state.role = 'park_leader'
    const leaderHtml = renderPage(ParkLeadDetailPage)
    expect(leaderHtml).toContain('分派')
    expect(leaderHtml).not.toContain('跟进中')

    state.role = 'park_ops'
    const opsHtml = renderPage(ParkLeadDetailPage)
    expect(opsHtml).toContain('跟进中')
    expect(opsHtml).not.toContain('分派')
  })
})
