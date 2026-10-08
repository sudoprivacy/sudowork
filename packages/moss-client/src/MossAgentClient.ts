import { type MossCallContext, type MossFetch } from './MossHttpClient.js'

/**
 * Moss Agent 端口 —— 一个人自己的智能体，不是智能体模板。
 *
 * 模板是组织共享的定义（见 MossAgentTemplatePort）；agent 是属于某个人的持久
 * 主体，有自己的记忆、对话与信箱。两者分开成两个端口，是因为它们是两种东西：
 * 把「我的 agent」挂进模板端口，等于在客户端这一层又把它们混回去。
 *
 * 三种 agent（隐式默认、用户自建、从模板实例化）由服务端在一处拼装并命名 ——
 * 客户端拿不到也不需要知道每一类的名字存在哪里。
 */

/** 端点路径的单一来源；webui 的转发白名单按挂载前缀列同一条。 */
export const MOSS_MY_AGENTS_PATH = '/api/v1/agents/mine'

export type MossMyAgent = {
  /** 会话里存的那个引用，也是分组的键。 */
  ref: string
  displayName: string
  kind: 'default' | 'own' | 'template'
}

export interface MossAgentPort {
  /** 这个人拥有的 agent。从未开过会话的模板不在其中：那是模板，不是他的 agent。 */
  mine(ctx: MossCallContext): Promise<MossMyAgent[]>
  /** 新建一个属于自己的 agent（不来自任何模板）。 */
  create(ctx: MossCallContext, body: { displayName: string }): Promise<unknown>
}

/** 服务端统一用 `{ success, data }` 包一层；只有 `data` 是调用方要的。 */
function unwrapList(payload: unknown): MossMyAgent[] {
  if (Array.isArray(payload)) return payload as MossMyAgent[]
  const data = (payload as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as MossMyAgent[]) : []
}

export function createMossAgentPort(mossFetch: MossFetch): MossAgentPort {
  return {
    mine: async (ctx) =>
      unwrapList(
        await mossFetch(ctx.baseUrl, {
          method: 'GET',
          path: MOSS_MY_AGENTS_PATH,
          accessToken: ctx.accessToken,
        }),
      ),
    create: (ctx, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/user-agents',
        accessToken: ctx.accessToken,
        body,
      }),
  }
}
