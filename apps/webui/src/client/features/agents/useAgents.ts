import useSWR from 'swr'
import { useSWRConfig } from 'swr'
import { agentApi, type AgentItem } from './agentApi'

/** 智能体列表与权限投影（计划 Task 6：服务端按 role/scopes 决定操作可见性）。 */
export function useAgents() {
  const { mutate } = useSWRConfig()
  const installed = useSWR('agents/installed', agentApi.listInstalled)
  const scopes = useSWR('agents/scopes', agentApi.getScopes)

  const owned = scopes.data?.scopes ?? []
  const isAdmin = owned.includes('admin:settings')

  return {
    installed: (installed.data ?? []) as AgentItem[],
    isLoading: installed.isLoading,
    error: installed.error,
    canManage: isAdmin,
    refresh: () => void mutate('agents/installed'),
  }
}
