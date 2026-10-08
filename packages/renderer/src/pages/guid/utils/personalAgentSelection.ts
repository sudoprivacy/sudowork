import type { AcpBackendConfig } from '../types';
import type { IMyAgent } from '@sudowork/common/personalAgents';
import { isPersonalAgentRef } from '@sudowork/common/personalAgents';

/** Keep distinct identities selectable even when their display names match. */
export function personalAgentConfigs(agents: IMyAgent[], isLocal: boolean): AcpBackendConfig[] {
  const seen = new Set<string>();
  return agents.filter((agent) => {
    if (agent.kind === 'template' || !isPersonalAgentRef(agent.ref) || seen.has(agent.ref)) return false;
    seen.add(agent.ref);
    return true;
  }).map((agent) => ({ id: agent.ref, name: agent.displayName, nameI18n: { 'zh-CN': agent.displayName, 'en-US': agent.displayName }, enabled: true, isPreset: true, presetAgentType: isLocal ? 'scode' : 'remote-agent' }));
}
