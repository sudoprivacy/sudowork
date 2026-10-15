import { Router, type Request, type Response, type NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { getMossContext } from '../auth/authService.js'
import { findPrincipalById, type Principal } from '../auth/principalRepository.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import type { MossCallContext, MossFetch, MossHttpError, MossParkPort } from '@sudowork/moss-client'
import {
  assertParkSystemOperator,
  listConsultations,
  listLeads,
  ParkRoleDeniedError,
  registerEnterprise,
  removeMember,
  unassignAssistant,
} from './parkService.js'

/**
 * Park business domain BFF（园区 AI 招商 P0）。
 * 三条前缀：
 *   - /api/park        ：注册（免登录，墙前语义——session 中间件解析但不强制）+ context
 *   - /api/enterprise  ：企业侧只读端点
 *   - /api/parks       ：园区侧业务端点（镜像 moss 路径 /:parkOrgId/...）
 * 转发用 MossParkPort（白名单），组织上下文由 moss 从会话 token 推导。
 */

export interface ParkRouterDeps {
  pool: Parameters<typeof findPrincipalById>[0]
  config: Parameters<typeof getMossContext>[0]['config']
  mossAuth: Parameters<typeof getMossContext>[0]['mossAuth']
  park: MossParkPort
  mossFetch: MossFetch
  findPrincipal?: typeof findPrincipalById
}

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 注册与登录同窗口限流（进程内存存储，单实例约束与 authRoutes 一致）。
  limit: Number(process.env.PARK_REGISTER_RATE_LIMIT ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
})

type Handler = (req: AuthedRequest, res: Response, next: NextFunction) => void

function withPrincipal(
  deps: ParkRouterDeps,
  handler: (args: {
    req: AuthedRequest
    res: Response
    principal: Principal
    ctx: MossCallContext
  }) => Promise<void>,
): Handler {
  return (req, res, next) => {
    void (async () => {
      const finder =
        deps.findPrincipal ?? (await import('../auth/principalRepository.js')).findPrincipalById
      const principal = await finder(deps.pool, req.webSession!.principalId)
      if (!principal) {
        res.status(401).json({ error: { code: 'principal_missing', message: '会话主体不存在' } })
        return
      }
      const ctx = await getMossContext(
        { pool: deps.pool, config: deps.config, mossAuth: deps.mossAuth },
        req.webSession!,
      )
      await handler({ req, res, principal, ctx })
    })().catch(next)
  }
}

function forward(res: Response): (upstream: unknown) => void {
  return (upstream) => {
    res.status(200).json(upstream)
  }
}

function mossErrorHandler(res: Response): (err: unknown) => void {
  return (err) => {
    if (err && typeof err === 'object' && (err as MossHttpError).status != null) {
      const httpErr = err as MossHttpError
      res.status(httpErr.status).json({ error: { code: 'moss_error', message: httpErr.message } })
      return
    }
    res.status(502).json({ error: { code: 'moss_unavailable', message: 'moss 请求失败' } })
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  return (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
}

export function createParkRouter(deps: ParkRouterDeps): Router {
  const router = Router()

  // 免登录注册（session 中间件只解析不强制；本路由不用 requireSession）。
  // req.ip 转发给 moss 作 x-forwarded-for——moss 侧限流按客户端 IP 分桶，
  // 没有它 moss 只能看到 BFF 服务器地址（全部注册共享一个桶）。
  router.post('/register-enterprise', registerLimiter, (req, res) => {
    void (async () => {
      const upstream = await registerEnterprise(deps, await readBody(req), req.ip)
      res.status(200).json(upstream)
    })().catch(mossErrorHandler(res))
  })

  router.get(
    '/context',
    requireSession,
    withPrincipal(deps, async ({ res, ctx }) => {
      await deps.park.context(ctx).then(forward(res)).catch(mossErrorHandler(res))
    }) as Handler,
  )

  return router
}

export function createEnterpriseRouter(deps: ParkRouterDeps): Router {
  const router = Router()
  router.use(requireSession)

  const get = (path: string, call: (ctx: MossCallContext) => Promise<unknown>) => {
    router.get(
      path,
      withPrincipal(deps, async ({ res, ctx }) => {
        await call(ctx).then(forward(res)).catch(mossErrorHandler(res))
      }) as Handler,
    )
  }

  get('/profile', (ctx) => deps.park.enterpriseProfile(ctx))
  get('/policies', (ctx) => deps.park.enterprisePolicies(ctx))
  get('/services', (ctx) => deps.park.enterpriseServices(ctx))
  get('/inquiries', (ctx) => deps.park.enterpriseInquiries(ctx))
  get('/assistant', (ctx) => deps.park.enterpriseAssistants(ctx))

  return router
}

export function createParksRouter(deps: ParkRouterDeps): Router {
  const router = Router()
  router.use(requireSession)

  const parkOrgId = (req: AuthedRequest): string => String(req.params.parkOrgId ?? '')

  const handle = (
    fn: (args: {
      res: Response
      ctx: MossCallContext
      parkOrgId: string
      req: AuthedRequest
    }) => Promise<void>,
  ): Handler =>
    withPrincipal(deps, async ({ req, res, ctx }) => {
      await fn({ res, ctx, parkOrgId: parkOrgId(req), req })
    }) as Handler

  const get = (
    pattern: string,
    fn: (args: { ctx: MossCallContext; parkOrgId: string; req: AuthedRequest }) => Promise<unknown>,
  ) => {
    router.get(
      pattern,
      handle(async ({ res, ...rest }) => {
        await fn(rest).then(forward(res)).catch(mossErrorHandler(res))
      }),
    )
  }
  const mutate = (
    method: 'post' | 'patch' | 'put' | 'delete',
    pattern: string,
    fn: (args: { ctx: MossCallContext; parkOrgId: string; req: AuthedRequest }) => Promise<unknown>,
  ) => {
    router[method](
      pattern,
      handle(async ({ res, ...rest }) => {
        await fn(rest).then(forward(res)).catch(mossErrorHandler(res))
      }),
    )
  }

  get('/:parkOrgId/settings', ({ ctx, parkOrgId }) => deps.park.settings(ctx, parkOrgId))
  mutate('put', '/:parkOrgId/settings', async ({ ctx, parkOrgId, req }) =>
    deps.park.updateSettings(ctx, parkOrgId, await readBody(req)),
  )

  get('/:parkOrgId/enterprises', ({ ctx, parkOrgId }) => deps.park.enterprises(ctx, parkOrgId))
  get('/:parkOrgId/enterprises/:enterpriseOrgId', ({ ctx, parkOrgId, req }) =>
    deps.park.enterpriseDetail(ctx, parkOrgId, String(req.params.enterpriseOrgId)),
  )
  mutate('patch', '/:parkOrgId/enterprises/:enterpriseOrgId', async ({ ctx, parkOrgId, req }) =>
    deps.park.updateEnterpriseFollowUp(
      ctx,
      parkOrgId,
      String(req.params.enterpriseOrgId),
      await readBody(req),
    ),
  )
  mutate('post', '/:parkOrgId/enterprise-bindings', async ({ ctx, parkOrgId, req }) =>
    deps.park.createBinding(ctx, parkOrgId, await readBody(req)),
  )

  get('/:parkOrgId/leads', ({ ctx, parkOrgId, req }) =>
    listLeads(deps, ctx, parkOrgId, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      watched: req.query.watched === '1',
    }),
  )
  mutate('post', '/:parkOrgId/leads', async ({ ctx, parkOrgId, req }) =>
    deps.park.createManualLead(ctx, parkOrgId, await readBody(req)),
  )
  get('/:parkOrgId/leads/:leadId', ({ ctx, parkOrgId, req }) =>
    deps.park.leadDetail(ctx, parkOrgId, String(req.params.leadId)),
  )
  mutate('post', '/:parkOrgId/leads/:leadId/claim', ({ ctx, parkOrgId, req }) =>
    deps.park.claimLead(ctx, parkOrgId, String(req.params.leadId)),
  )
  mutate('patch', '/:parkOrgId/leads/:leadId', async ({ ctx, parkOrgId, req }) =>
    deps.park.updateLead(ctx, parkOrgId, String(req.params.leadId), await readBody(req)),
  )
  mutate('post', '/:parkOrgId/leads/:leadId/watch', ({ ctx, parkOrgId, req }) =>
    deps.park.watchLead(ctx, parkOrgId, String(req.params.leadId)),
  )
  mutate('delete', '/:parkOrgId/leads/:leadId/watch', ({ ctx, parkOrgId, req }) =>
    deps.park.unwatchLead(ctx, parkOrgId, String(req.params.leadId)),
  )

  get('/:parkOrgId/consultations', ({ ctx, parkOrgId, req }) => {
    const dateParam = (name: string): number | undefined => {
      const value = Number(req.query[name])
      return req.query[name] !== undefined && Number.isFinite(value) ? value : undefined
    }
    return listConsultations(deps, ctx, parkOrgId, {
      enterprise_org_id:
        typeof req.query.enterprise_org_id === 'string' ? req.query.enterprise_org_id : undefined,
      before_created_at: dateParam('before_created_at'),
      after_created_at: dateParam('after_created_at'),
    })
  })
  get('/:parkOrgId/metrics', ({ ctx, parkOrgId }) => deps.park.metrics(ctx, parkOrgId))
  get('/:parkOrgId/audit-events', ({ ctx, parkOrgId }) => deps.park.auditEvents(ctx, parkOrgId))

  get('/:parkOrgId/members', ({ ctx, parkOrgId }) => deps.park.members(ctx, parkOrgId))
  mutate('post', '/:parkOrgId/members', async ({ ctx, parkOrgId, req }) =>
    deps.park.addMember(ctx, parkOrgId, await readBody(req)),
  )
  mutate('delete', '/:parkOrgId/members', async ({ ctx, parkOrgId, req }) =>
    removeMember(deps, ctx, parkOrgId, String((await readBody(req)).user_id ?? '')),
  )

  get('/:parkOrgId/assistant-assignments', ({ ctx, parkOrgId }) =>
    deps.park.assignments(ctx, parkOrgId),
  )
  // admin Modal 下拉候选（moss park 模块新增，计划 4.1-B）
  get('/:parkOrgId/assistant-candidates', ({ ctx, parkOrgId }) =>
    deps.park.listAssistantCandidates(ctx, parkOrgId),
  )
  get('/:parkOrgId/bindable-enterprises', ({ ctx, parkOrgId }) =>
    deps.park.listBindableEnterprises(ctx, parkOrgId),
  )
  get('/:parkOrgId/member-candidates', ({ ctx, parkOrgId, req }) =>
    deps.park.searchMemberCandidates(
      ctx,
      parkOrgId,
      typeof req.query.q === 'string' ? req.query.q : '',
    ),
  )
  mutate('post', '/:parkOrgId/assistant-assignments', async ({ ctx, parkOrgId, req }) =>
    deps.park.assignAssistant(ctx, parkOrgId, await readBody(req)),
  )
  mutate('delete', '/:parkOrgId/assistant-assignments', async ({ ctx, parkOrgId, req }) => {
    const body = await readBody(req)
    return unassignAssistant(
      deps,
      ctx,
      parkOrgId,
      String(body.assistant_id ?? ''),
      String(body.enterprise_org_id ?? ''),
    )
  })

  // Document Center APIs are scoped to the token's organization. Authorization
  // lives in parkService (assertParkSystemOperator); here we only map the
  // domain error to HTTP.
  const policy = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    call: (ctx: MossCallContext, req: AuthedRequest) => Promise<unknown>,
  ) => {
    router[method](
      path,
      withPrincipal(deps, async ({ req, res, ctx }) => {
        try {
          await assertParkSystemOperator(deps, ctx, String(req.params.parkOrgId))
          res.status(200).json(await call(ctx, req))
        } catch (error) {
          if (error instanceof ParkRoleDeniedError) {
            res.status(403).json({ error: { code: 'park_role_denied', message: error.message } })
            return
          }
          mossErrorHandler(res)(error)
        }
      }) as Handler,
    )
  }
  policy('get', '/:parkOrgId/policy/tree', (ctx) => deps.park.documentTree(ctx))
  policy('post', '/:parkOrgId/policy/tree/nodes', async (ctx, req) =>
    deps.park.createDocumentNode(ctx, String((await readBody(req)).name ?? '')),
  )
  policy('get', '/:parkOrgId/policy/nodes/:nodeId/documents', (ctx, req) =>
    deps.park.documents(ctx, String(req.params.nodeId)),
  )
  policy('post', '/:parkOrgId/policy/nodes/:nodeId/documents', async (ctx, req) =>
    deps.park.uploadDocument(ctx, String(req.params.nodeId), await readBody(req)),
  )
  policy('delete', '/:parkOrgId/policy/documents/:documentId', (ctx, req) =>
    deps.park.deleteDocument(ctx, String(req.params.documentId)),
  )
  policy('get', '/:parkOrgId/policy/wikis', (ctx) => deps.park.wikis(ctx))
  policy('post', '/:parkOrgId/policy/wikis', async (ctx, req) =>
    deps.park.createWiki(ctx, await readBody(req)),
  )
  policy('patch', '/:parkOrgId/policy/wikis/:wikiId', async (ctx, req) =>
    deps.park.updateWiki(ctx, String(req.params.wikiId), await readBody(req)),
  )
  policy('post', '/:parkOrgId/policy/wikis/:wikiId/build', (ctx, req) =>
    deps.park.buildWiki(ctx, String(req.params.wikiId)),
  )
  policy('get', '/:parkOrgId/policy/wikis/:wikiId/build-status', (ctx, req) =>
    deps.park.wikiBuildStatus(ctx, String(req.params.wikiId)),
  )

  return router
}
