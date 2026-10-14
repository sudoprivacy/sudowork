import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { MossParkPort, MossCallContext } from '@sudowork/moss-client'
import { MossHttpError } from '@sudowork/moss-client'
import { encryptToken } from '../../src/server/security/tokenCipher'

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

async function buildTestApp(
  options: { authenticated?: boolean; port?: MossParkPort } = {},
): Promise<Express> {
  const [{ default: express }, session, parkRoutes] = await Promise.all([
    import('express'),
    import('../../src/server/features/auth/sessionMiddleware'),
    import('../../src/server/features/park/parkRoutes'),
  ])
  const app = express()
  app.use(express.json())
  // 与生产同构：/api 前缀挂 session 解析（不强制），各 router 自行 requireSession
  app.use('/api', session.createSessionMiddleware(undefined as never, Buffer.from('test-hmac-key')))
  const tokenKey = Buffer.alloc(32, 7)
  if (options.authenticated) {
    const encrypted = encryptToken(
      JSON.stringify({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
      }),
      tokenKey,
    )
    app.use('/api', (req, _res, next) => {
      ;(req as typeof req & { webSession: unknown }).webSession = {
        principalId: 'principal-1',
        encryptedMossTokens: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
      }
      next()
    })
  }
  const deps = {
    pool: undefined as never,
    config: { moss: { baseUrl: 'http://moss.test' }, tokenAesKey: tokenKey } as never,
    mossAuth: undefined as never,
    park: options.port ?? stubParkPort(),
    mossFetch: (async () => ({})) as never,
    findPrincipal: async () => ({ id: 'principal-1' }) as never,
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

  it('注册转发限流：超过 PARK_REGISTER_RATE_LIMIT 后 429（模块级 env，需重载模块）', async () => {
    vi.resetModules()
    process.env.PARK_REGISTER_RATE_LIMIT = '2'
    try {
      const app = await buildTestApp()
      const body = {
        phone: '13800000001',
        sms_code: '123456',
        enterprise_name: '限流企业',
        contact_name: '李四',
      }
      const first = await request(app).post('/api/park/register-enterprise').send(body)
      const second = await request(app).post('/api/park/register-enterprise').send(body)
      const third = await request(app).post('/api/park/register-enterprise').send(body)
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(third.status).toBe(429)
    } finally {
      delete process.env.PARK_REGISTER_RATE_LIMIT
      vi.resetModules()
    }
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

  it('已登录的 context、线索列表和脱敏详情按路径透传', async () => {
    const port = stubParkPort()
    const context = vi
      .fn()
      .mockResolvedValue({ org_type: 'park', park_org_id: 'park-1', park_role: 'park_ops' })
    const leads = vi.fn().mockResolvedValue({ items: [{ lead_id: 'lead-1', status: 'proposed' }] })
    const leadDetail = vi
      .fn()
      .mockResolvedValue({ lead_id: 'lead-1', inquiry_summary: { redacted_question: '电话 ***' } })
    Object.assign(port, { context, leads, leadDetail })
    const app = await buildTestApp({ authenticated: true, port })
    expect((await request(app).get('/api/park/context')).body.park_role).toBe('park_ops')
    expect(
      (await request(app).get('/api/parks/park-1/leads?status=proposed')).body.items[0].lead_id,
    ).toBe('lead-1')
    const detail = await request(app).get('/api/parks/park-1/leads/lead-1')
    expect(detail.body.inquiry_summary.redacted_question).toBe('电话 ***')
    expect(JSON.stringify(detail.body)).not.toContain('question_ref')
    expect(leads).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token' }),
      'park-1',
      expect.objectContaining({ status: 'proposed' }),
    )
    expect(leadDetail).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token' }),
      'park-1',
      'lead-1',
    )
  })

  it('上游错误码保持 403；政策管理仅园区系统运营可转发', async () => {
    const port = stubParkPort()
    const context = vi
      .fn()
      .mockResolvedValue({ org_type: 'park', park_org_id: 'park-1', park_role: 'park_ops' })
    const documentTree = vi.fn().mockResolvedValue({ nodes: [] })
    Object.assign(port, {
      context,
      documentTree,
      leads: vi.fn().mockRejectedValue(new MossHttpError(403, 'forbidden', '/leads')),
    })
    const app = await buildTestApp({ authenticated: true, port })
    expect((await request(app).get('/api/parks/park-1/leads')).status).toBe(403)
    expect((await request(app).get('/api/parks/park-1/policy/tree')).status).toBe(403)
    expect(documentTree).not.toHaveBeenCalled()
    context.mockResolvedValue({
      org_type: 'park',
      park_org_id: 'park-1',
      park_role: 'park_system_operator',
    })
    const allowed = await request(app).get('/api/parks/park-1/policy/tree')
    expect(allowed.status).toBe(200)
    expect(documentTree).toHaveBeenCalledTimes(1)
  })

  it('系统运营上传、删旧、更新 Wiki 并构建时传递组织 token 和参数', async () => {
    const port = stubParkPort()
    const context = vi.fn().mockResolvedValue({
      org_type: 'park',
      park_org_id: 'park-1',
      park_role: 'park_system_operator',
    })
    const uploadDocument = vi.fn().mockResolvedValue({ id: 'doc-2' })
    const deleteDocument = vi.fn().mockResolvedValue({ ok: true })
    const updateWiki = vi.fn().mockResolvedValue({ id: 'wiki-1' })
    const buildWiki = vi.fn().mockResolvedValue({ job_id: 'build-1' })
    Object.assign(port, { context, uploadDocument, deleteDocument, updateWiki, buildWiki })
    const app = await buildTestApp({ authenticated: true, port })
    const upload = { file_name: '新政策.md', mime_type: 'text/markdown', content_base64: 'YQ==' }
    expect(
      (await request(app).post('/api/parks/park-1/policy/nodes/node-1/documents').send(upload))
        .status,
    ).toBe(200)
    expect((await request(app).delete('/api/parks/park-1/policy/documents/doc-1')).status).toBe(200)
    expect(
      (
        await request(app)
          .patch('/api/parks/park-1/policy/wikis/wiki-1')
          .send({ source_document_ids: ['doc-2'] })
      ).status,
    ).toBe(200)
    expect((await request(app).post('/api/parks/park-1/policy/wikis/wiki-1/build')).status).toBe(
      200,
    )
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token' }),
      'node-1',
      upload,
    )
    expect(deleteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token' }),
      'doc-1',
    )
    expect(updateWiki).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token' }),
      'wiki-1',
      { source_document_ids: ['doc-2'] },
    )
    expect(buildWiki).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token' }),
      'wiki-1',
    )
  })
})
