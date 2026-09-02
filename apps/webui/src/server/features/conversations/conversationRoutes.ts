import { Router, type NextFunction, type Response } from 'express'
import { z, ZodError } from 'zod'
import { getAccessToken } from '../auth/authService.js'
import { findPrincipalById, type Principal } from '../auth/principalRepository.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import { MossHttpError } from '../../moss/MossHttpClient.js'
import {
  CreateConversationRequestSchema,
  ReorderPinnedRequestSchema,
  UpdateConversationMetaRequestSchema,
} from '@sudowork/contracts/conversations'
import {
  InvalidSelectionError,
  MossUnavailableError,
  SessionForbiddenError,
  SessionNotFoundError,
  createConversation,
  deleteConversation,
  getContext,
  getConversationOptions,
  getWorkspaceFile,
  getWorkspaceTree,
  listConversations,
  reorderPinnedConversations,
  terminateConversation,
  updateConversationMeta,
  uploadWorkspaceFile,
  type ConversationDeps,
} from './conversationService.js'
import { getDeliverables } from './deliverablesService.js'

/**
 * 会话 REST 路由（计划 Task 5）。
 * 每个请求经 session middleware 得到 principal，再按 3.3 强制归属过滤。
 */

export function createConversationRouter(deps: ConversationDeps): Router {
  const router = Router()

  async function resolvePrincipal(req: AuthedRequest): Promise<Principal | null> {
    return findPrincipalById(deps.pool, req.webSession!.principalId)
  }

  /** 当前 Web Session 自己的 Moss access token（计划 3.2）。 */
  async function resolveToken(req: AuthedRequest): Promise<string> {
    return getAccessToken(deps.auth, req.webSession!)
  }

  function convErrorHandler(err: unknown, res: Response, next: NextFunction): void {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'INVALID_REQUEST' })
      return
    }
    if (err instanceof SessionNotFoundError) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' })
      return
    }
    if (err instanceof SessionForbiddenError) {
      res.status(403).json({ error: 'SESSION_FORBIDDEN' })
      return
    }
    if (err instanceof MossUnavailableError) {
      res.status(503).json({ error: 'MOSS_UNAVAILABLE' })
      return
    }
    if (err instanceof InvalidSelectionError) {
      res.status(400).json({ error: 'SELECTION_NOT_AVAILABLE', field: err.field })
      return
    }
    if ((err instanceof MossHttpError && err.status === 413) || (err instanceof Error && err.message === 'FILE_TOO_LARGE')) {
      res.status(413).json({ error: 'FILE_TOO_LARGE' })
      return
    }
    next(err)
  }

  router.get('/', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const token = await resolveToken(req as AuthedRequest)
      res.status(200).json({ conversations: await listConversations(deps, principal, token) })
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  router.post('/', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const input = CreateConversationRequestSchema.parse(req.body)
      const token = await resolveToken(req as AuthedRequest)
      res.status(201).json(await createConversation(deps, principal, input, token))
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  router.get('/options', requireSession, (req, res, next) => {
    void (async () => {
      const token = await resolveToken(req as AuthedRequest)
      res.status(200).json(await getConversationOptions(deps, token))
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  router.get('/:id/context', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const token = await resolveToken(req as AuthedRequest)
      res.status(200).json(await getContext(deps, principal, id, token))
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  router.post('/:id/terminate', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const token = await resolveToken(req as AuthedRequest)
      await terminateConversation(deps, principal, id, token)
      res.status(200).json({ ok: true })
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  router.get('/:id/workspace/tree', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const path = typeof req.query.path === 'string' ? req.query.path : ''
      const search = typeof req.query.search === 'string' ? req.query.search : ''
      const token = await resolveToken(req as AuthedRequest)
      res.status(200).json(await getWorkspaceTree(deps, principal, id, path, token, search))
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  router.get('/:id/workspace/file', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const path = z.string().min(1).parse(req.query.path)
      const token = await resolveToken(req as AuthedRequest)
      res.status(200).json(await getWorkspaceFile(deps, principal, id, path, token))
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  router.post('/:id/workspace/file', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const body = z
        .object({ path: z.string().min(1).max(1024), content_base64: z.string().min(1) })
        .parse(req.body)
      const token = await resolveToken(req as AuthedRequest)
      res
        .status(200)
        .json(
        await uploadWorkspaceFile(deps, principal, id, body.path, body.content_base64, token),
      )
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  // 会话级可用技能（右侧面板「工作空间 → 可用技能」，透传 Moss）
  router.get('/:id/skills/available', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const token = await resolveToken(req as AuthedRequest)
      const json = (await deps.moss.sessionSkillsAvailable(token, id)) as {
        skills?: {
          name?: unknown
          displayName?: unknown
          description?: unknown
          icon?: unknown
          iconUrl?: unknown
          emoji?: unknown
          color?: unknown
        }[]
      }
      // 容忍裸数组（moss 未来形态变化时右侧面板不至恒空），字段白名单透传
      const rawSkills = Array.isArray(json) ? json : (json.skills ?? [])
      const skills = rawSkills.map((s) => ({
        name: typeof s.name === 'string' ? s.name : '',
        displayName: typeof s.displayName === 'string' ? s.displayName : (typeof s.name === 'string' ? s.name : ''),
        description: typeof s.description === 'string' ? s.description : '',
        icon: typeof s.icon === 'string' ? s.icon : '',
        iconUrl: typeof s.iconUrl === 'string' ? s.iconUrl : '',
        emoji: typeof s.emoji === 'string' ? s.emoji : null,
        color: typeof s.color === 'string' ? s.color : '',
      }))
      res.status(200).json({ skills })
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  // 交付物（从 Moss context 的 tool_use 重建）
  router.get('/:id/deliverables', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const token = await resolveToken(req as AuthedRequest)
      res.status(200).json(await getDeliverables(deps, principal, id, token))
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  // meta 更新（重命名/置顶）
  router.patch('/:id/meta', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const body = UpdateConversationMetaRequestSchema.parse(req.body)
      const token = await resolveToken(req as AuthedRequest)
      await updateConversationMeta(deps, principal, id, token, body)
      res.status(200).json({ ok: true })
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  // 置顶区拖拽排序
  router.post('/meta/reorder', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const body = ReorderPinnedRequestSchema.parse(req.body)
      await reorderPinnedConversations(deps, principal, body.orderedIds)
      res.status(200).json({ ok: true })
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  // 删除会话（本地 meta 删除 + Moss terminate + 关闭该会话 pty，对齐 Sudowork 删除语义）
  router.delete('/:id', requireSession, (req, res, next) => {
    void (async () => {
      const principal = await resolvePrincipal(req as AuthedRequest)
      if (!principal) return void res.status(401).json({ error: 'SESSION_REQUIRED' })
      const id = z.string().min(1).parse(req.params.id)
      const token = await resolveToken(req as AuthedRequest)
      await deleteConversation(deps, principal, id, token)
      res.status(200).json({ ok: true })
    })().catch((err: unknown) => convErrorHandler(err, res, next))
  })

  return router
}
