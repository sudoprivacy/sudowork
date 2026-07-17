import type { ITeamAssistantCandidate } from '@/common/ipcBridge';
import { getAgentPriority, resolvePresetAgentBackend } from '@/types/acpTypes';

/** Structural input shapes (DetectedAgent is not exported from AcpDetector; IAssistantInfo is). */
export interface DetectedAgentLike {
  backend: string;
  name: string;
  customAgentId?: string;
  isPreset?: boolean;
  avatar?: string | null;
  presetAgentType?: string;
}

export interface InstalledAssistantLike {
  isBuiltin: boolean;
  isHubInstalled: boolean;
  enabled?: boolean;
  name: string;
  meta: {
    id?: string;
    display_name?: string;
    name?: string;
    nameI18n?: Record<string, string>;
    descriptionI18n?: Record<string, string>;
    presetAgentType?: string;
    avatar?: string | null;
  };
}

export type TeamAssistantEntry = ITeamAssistantCandidate;

function getInstalledAssistantKey(info: InstalledAssistantLike): string {
  return info.isBuiltin ? `builtin-${info.meta.id || info.name}` : info.meta.id || info.name;
}

function getInstalledAssistantDisplayName(info: InstalledAssistantLike): string {
  return info.meta.nameI18n?.['zh-CN'] || info.meta.nameI18n?.['en-US'] || info.meta.display_name || info.meta.name || info.meta.id || info.name;
}

function getInstalledAssistantDescription(info: InstalledAssistantLike): string | null {
  return info.meta.descriptionI18n?.['zh-CN'] || info.meta.descriptionI18n?.['en-US'] || null;
}

function getDetectedAgentDescription(agent: DetectedAgentLike): string | null {
  if (agent.backend === 'scode') return 'Sudo Code CLI 智能体，适合软件开发、代码修改、工程任务执行与结果验证。';
  if (agent.backend === 'claude') return 'Claude Code CLI 智能体，适合代码理解、任务拆解、实现与验证。';
  return null;
}

/**
 * Merge guide-detected agents ∪ installed assistants (附录 A2).
 *
 * Dedupe by the `isBuiltin ? "builtin-"+(id||name) : (id||name)` key (matches AcpDetector's
 * customAgentId formula). Installed assistants win over the matching detected entry and report
 * their resolved backend (not 'custom'). remote-agent (enterprise) is dropped. Result is sorted by
 * the shared getAgentPriority (stable, so same-priority entries keep insertion order).
 */
export function mergeTeamAssistants(detected: DetectedAgentLike[], installed: InstalledAssistantLike[]): TeamAssistantEntry[] {
  const seen = new Set<string>();
  const result: TeamAssistantEntry[] = [];

  // Installed assistants first (resolved backend preferred over the 'custom' tag in detected).
  for (const info of installed) {
    const key = getInstalledAssistantKey(info);
    if (seen.has(key)) continue;
    seen.add(key);
    const backend = resolvePresetAgentBackend(info.meta.presetAgentType);
    result.push({
      assistant_id: key,
      name: getInstalledAssistantDisplayName(info),
      backend,
      preset_agent_type: info.meta.presetAgentType ?? null,
      avatar: info.meta.avatar ?? null,
      is_preset: info.isBuiltin || info.isHubInstalled,
      source: 'assistant',
      description: getInstalledAssistantDescription(info),
    });
  }

  // Detected CLI presets / custom / extension agents not already covered.
  for (const d of detected) {
    if (d.backend === 'remote-agent') continue; // enterprise — not a C-end team member
    const key = d.customAgentId ?? d.backend;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      assistant_id: key,
      name: d.name,
      backend: d.backend,
      preset_agent_type: d.presetAgentType ?? null,
      avatar: d.avatar ?? null,
      is_preset: d.isPreset ?? false,
      source: 'agent',
      description: getDetectedAgentDescription(d),
    });
  }

  result.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'agent' ? -1 : 1;
    return getAgentPriority(a.backend) - getAgentPriority(b.backend);
  });
  return result;
}
