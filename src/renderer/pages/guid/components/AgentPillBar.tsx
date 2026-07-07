import { Robot } from '@icon-park/react';
import React from 'react';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AcpBackendAll } from '@/types/acpTypes';
import styles from '../index.module.css';
import type { AvailableAgent } from '../types';

type AgentPillBarProps = {
  availableAgents: AvailableAgent[];
  selectedAgentKey: string;
  getAgentKey: (agent: { backend: AcpBackendAll; customAgentId?: string }) => string;
  onSelectAgent: (key: string) => void;
  /** Current session mode (remote/local) - only meaningful in enterprise mode */
  sessionMode?: 'remote' | 'local';
  /** Callback when session mode tab is clicked */
  onSessionModeChange?: (mode: 'remote' | 'local') => void;
  /** Whether the app is in enterprise mode */
  isEnterprise?: boolean;
  /** Whether local mode is available (localAuth=true + config complete) */
  localModeAvailable?: boolean;
};

const AgentPillBar: React.FC<AgentPillBarProps> = ({ availableAgents, selectedAgentKey, getAgentKey, onSelectAgent, sessionMode, onSessionModeChange, isEnterprise, localModeAvailable }) => {
  // Define priority order for agent display
  const getAgentPriority = (agent: AvailableAgent): number => {
    const backend = agent.backend;
    switch (backend) {
      case 'remote-agent':
        return -1; // Moss Server (enterprise) - highest priority
      case 'scode':
        return 0; // Sudo Code - highest priority for consumer
      case 'claude':
        return 2;
      case 'gemini':
        return 3;
      case 'custom':
        return 4; // Extensions/custom agents last
      default:
        return 5; // Other agents come after
    }
  };

  // Sort agents according to priority
  const sortedAgents = [...availableAgents].sort((a, b) => {
    // For non-custom agents, use priority-based sorting
    if (a.backend !== 'custom' && b.backend !== 'custom') {
      return getAgentPriority(a) - getAgentPriority(b);
    }

    // For custom agents, keep their relative order but sort them after prioritized agents
    if (a.backend === 'custom' && b.backend === 'custom') {
      return 0; // Maintain relative order for custom agents
    }

    // Non-custom agents come before custom agents
    if (a.backend === 'custom') return 1;
    if (b.backend === 'custom') return -1;

    return 0;
  });

  return (
    <div className='w-full flex justify-center'>
      {/* Enterprise mode: Remote/Local tab */}
      {isEnterprise ? (
        localModeAvailable ? (
          /* Enterprise with Local mode: Remote | Local tab switcher */
          <div className='f-center mb-5 p-1.5 rd-30px bg-[var(--color-guid-agent-bar,var(--aou-2))] w-fit max-w-full gap-1 text-foreground' style={{ transition: 'background-color 0.35s ease' }}>
            {/* Shared Remote icon */}
            <span className='inline-flex h-5 w-5 shrink-0 items-center justify-center leading-none'>
              <img src={getAgentLogo('remote-agent')} alt='Remote' width={20} height={20} className='block object-contain' />
            </span>
            {/* Remote tab */}
            <div
              data-agent-pill='true'
              data-session-mode='remote'
              className={`group relative flex items-center cursor-pointer whitespace-nowrap ${sessionMode === 'remote' ? `opacity-100 px-3 py-2 rd-20px mx-0.5 ${styles.agentItemSelected}` : 'opacity-60 p-1 hover:opacity-100'}`}
              style={sessionMode === 'remote' ? { transition: 'opacity 0.2s ease, background-color 0.2s ease' } : { transition: 'opacity 0.2s ease' }}
              onClick={() => onSessionModeChange?.('remote')}
            >
              <span className='font-semibold text-14px ml-1 text-foreground'>Remote</span>
            </div>
            {/* Divider + Local tab */}
            <>
              <div className='text-16px lh-1 p-0.5 select-none opacity-30'>|</div>
              <div
                data-agent-pill='true'
                data-session-mode='local'
                className={`group relative flex items-center cursor-pointer whitespace-nowrap ${sessionMode === 'local' ? `opacity-100 px-3 py-2 rd-20px mx-0.5 ${styles.agentItemSelected}` : 'opacity-60 p-1 hover:opacity-100'}`}
                style={sessionMode === 'local' ? { transition: 'opacity 0.2s ease, background-color 0.2s ease' } : { transition: 'opacity 0.2s ease' }}
                onClick={() => onSessionModeChange?.('local')}
              >
                <span className='font-semibold text-14px ml-1 text-foreground'>Local</span>
              </div>
            </>
          </div>
        ) : (
          /* Enterprise without Local mode: single pill with consumer style */
          <div className='f-center mb-5 p-1.5 rd-30px bg-[var(--color-guid-agent-bar,var(--aou-2))] w-fit max-w-full text-foreground'>
            <div className={`group relative flex items-center whitespace-nowrap px-3 py-2 rd-20px mx-0.5 ${styles.agentItemSelected}`} style={{ transition: 'opacity 0.2s ease, background-color 0.2s ease' }}>
              <span className='inline-flex h-5 w-5 shrink-0 items-center justify-center leading-none'>
                <img src={getAgentLogo('remote-agent')} alt='Remote Agent' width={20} height={20} className='block object-contain' />
              </span>
              <span className='font-semibold text-14px ml-1 text-foreground'>Remote Agent</span>
            </div>
          </div>
        )
      ) : (
        /* Consumer mode: original pill bar */
        <div className='f-center mb-5 p-1.5 rd-30px bg-[var(--color-guid-agent-bar,var(--aou-2))] w-fit max-w-full overflow-hidden gap-1 flex-nowrap text-foreground' style={{ transition: 'background-color 0.35s ease' }}>
          {sortedAgents
            .filter((agent) => agent.backend !== 'custom')
            .map((agent, index) => {
              const isSelected = selectedAgentKey === getAgentKey(agent);
              const extensionAvatar = resolveExtensionAssetUrl(agent.isExtension ? agent.avatar : undefined);
              const isEmojiAvatar = agent.isPreset && agent.avatar && !agent.avatar.startsWith('http') && !agent.avatar.startsWith('/');
              const logoSrc = extensionAvatar || (agent.isPreset && agent.avatar && !isEmojiAvatar ? agent.avatar : null) || getAgentLogo(agent.backend);

              return (
                <React.Fragment key={getAgentKey(agent)}>
                  {index > 0 && <div className='text-16px lh-1 p-0.5 select-none opacity-30'>|</div>}
                  <div
                    data-agent-pill='true'
                    data-agent-key={getAgentKey(agent)}
                    data-agent-backend={agent.backend}
                    data-agent-selected={isSelected ? 'true' : 'false'}
                    className={`group relative flex items-center cursor-pointer whitespace-nowrap overflow-hidden ${isSelected ? `opacity-100 px-3 py-2 rd-20px mx-0.5 ${styles.agentItemSelected}` : 'opacity-60 p-1 hover:opacity-100'}`}
                    style={isSelected ? undefined : { transition: 'opacity 0.2s ease' }}
                    onClick={() => onSelectAgent(getAgentKey(agent))}
                  >
                    <span className='inline-flex h-5 w-5 shrink-0 items-center justify-center leading-none'>
                      {isEmojiAvatar ? <span className='text-18px leading-none'>{agent.avatar}</span> : logoSrc ? <img src={logoSrc} alt={`${agent.backend} logo`} width={20} height={20} className='block object-contain' /> : <Robot theme='outline' size={20} fill='currentColor' />}
                    </span>
                    <span
                      className={`font-medium text-14px text-foreground ${isSelected ? 'font-semibold ml-1' : 'max-w-0 opacity-0 overflow-hidden group-hover:max-w-25 group-hover:opacity-100 group-hover:ml-2'}`}
                      style={{
                        transition: isSelected ? 'color 0.2s ease, font-weight 0.2s ease' : 'max-width 0.6s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.5s cubic-bezier(0.2, 0.8, 0.3, 1) 0.05s, margin 0.6s cubic-bezier(0.2, 0.8, 0.3, 1)',
                      }}
                    >
                      {agent.name}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
        </div>
      )}
    </div>
  );
};

export default AgentPillBar;
