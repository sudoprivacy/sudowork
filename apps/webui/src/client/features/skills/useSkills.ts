import useSWR, { useSWRConfig } from 'swr'
import { skillApi, type SkillItem } from './skillApi'
import { agentApi } from '@client/features/agents/agentApi'

export function useSkills() {
  const { mutate } = useSWRConfig()
  const installed = useSWR('skills/installed', skillApi.listInstalled)
  const scopes = useSWR('agents/scopes', agentApi.getScopes)

  const owned = scopes.data?.scopes ?? []

  return {
    installed: (installed.data ?? []) as SkillItem[],
    isLoading: installed.isLoading,
    error: installed.error,
    canManage: owned.includes('admin:settings'),
    refresh: () => void mutate('skills/installed'),
  }
}
