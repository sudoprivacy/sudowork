import { describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { MossParkPort, MossCallContext } from '@sudowork/moss-client'

/**
 * Park BFF 集成测试：路由注册与鉴权语义（不落库的最小 express app）。
 * - 注册端点免登录（无 cookie 不返回 401），并转发到 moss park port
 * - context / enterprise / parks 端点无会话返回 401（requireSession）
 */

const registered: unknown[] = []

function stubParkPort(): MossParkPort {
  const passthrough = async () => ({ items: [] })
  return {
    context: passthrough,
    settings: passthrough,
    updateSettings: passthrough,
    enterprises: passthrough,
    enterpriseDetail: passthrough,
    updateEnterpriseFollowUp: passthrough,
    createBinding: passthrough,
    leads: passthrough,
    createManualLead: passthrough,
    leadDetail: passthrough,
    claimLead: passthrough,
    updateLead: passthrough,
    watchLead: passthrough,
    unwatchLead: passthrough,
    consultations: passthrough,
    metrics: passthrough,
    auditEvents: passthrough,
    members: passthrough,
    addMember: passthrough,
    removeMember: passthrough,
    assignments: passthrough,
    assignAssistant: passthrough,
    unassignAssistant: passthrough,
    enterpriseProfile: passthrough,
    enterprisePolicies: passthrough,
    enterpriseServices: passthrough,
    enterpriseInquiries: passthrough,
    enterpriseAssistants: passthrough,
    registerEnterprise: async (_baseUrl: string, body: unknown) => {
      registered.push(body)
      return { enterprise_org_id: 'ent-1', park_org_id: 'park-1', user_id: 'u-1' }
    },
  } as unknown as MossParkPort
}

async function buildTestApp(): Promise<Express> {
  const [{ default: express }, session, parkRoutes] = await Promise.all([
    import('express'),
    import('../../src/server/features/auth/sessionMiddleware'),
    import('../../src/server/features/park/parkRoutes'),
  ])
  const app = express()
  app.use(express.json())
  // 与生产同构：/api 前缀挂 session 解析（不强制），各 router 自行 requireSession
  app.use('/api', session.createSessionMiddleware(undefined as never, Buffer.from('test-hmac-key')))
  const deps = {
    pool: undefined as never,
    config: { moss: { baseUrl: 'http://moss.test' } } as never,
    mossAuth: undefined as never,
    park: stubParkPort(),
    mossFetch: (async () => ({})) as never,
  }
  app.use('/api/park', parkRoutes.createParkRouter(deps))
  app.use('/api/enterprise', parkRoutes.createEnterpriseRouter(deps))
  app.use('/api/parks', parkRoutes.createParksRouter(deps))
  return app
}

void ({} as MossCallContext)

describe('park BFF 路由（转发层）', () => {
  it('注册端点免登录：无 cookie 不返回 401，成功转发 moss 并透传响应', async () => {
    const app = await buildTestApp()
    const res = await request(app).post('/api/park/register-enterprise').send({
      phone: '13800000000',
      sms_code: '123456',
      enterprise_name: '星澜智能',
      contact_name: '张三',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ enterprise_org_id: 'ent-1', park_org_id: 'park-1' })
    expect(registered).toHaveLength(1)
  })

  it('context 端点未登录返回 401', async () => {
    const app = await buildTestApp()
    const res = await request(app).get('/api/park/context')
    expect(res.status).toBe(401)
  })

  it('企业侧端点未登录返回 401', async () => {
    const app = await buildTestApp()
    const res = await request(app).get('/api/enterprise/inquiries')
    expect(res.status).toBe(401)
  })

  it('园区侧端点未登录返回 401', async () => {
    const app = await buildTestApp()
    const res = await request(app).get('/api/parks/park-1/leads')
    expect(res.status).toBe(401)
  })
})
