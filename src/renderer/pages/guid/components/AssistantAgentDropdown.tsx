/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dropdown for switching the main agent (backend) of the selected assistant.
 * Shown on the right side of the assistant header in the GUID page.
 */

import { Check, Down, Robot } from '@icon-park/react';
import { Popover } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { normalizePresetAgentType, type AcpBackend } from '@/types/acpTypes';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AvailableAgent } from '../types';

type AgentOption = {
  value: string;
  label: string;
  backendId?: string;
};

/** Built-in agent options with their preset type values and display labels */
const BUILTIN_AGENT_OPTIONS: AgentOption[] = [
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'qwen', label: 'Qwen Code' },
  { value: 'codebuddy', label: 'CodeBuddy' },
  { value: 'scode', label: 'Sudo Code', backendId: 'scode' },
];

type AssistantAgentDropdownProps = {
  availableAgents: AvailableAgent[];
  currentAgentType: string;
  onSelectAgent: (agentType: string) => void;
  disabled?: boolean;
};

const AssistantAgentDropdown: React.FC<AssistantAgentDropdownProps> = ({ availableAgents, currentAgentType, onSelectAgent, disabled: _disabled }) => {
  // Main agent dropdown is currently locked - only Sudo Code is supported
  const disabled = true;
  const [visible, setVisible] = useState(false);

  // Build set of available backends from detected agents
  const availableBackends = useMemo(() => new Set(availableAgents.map((a) => a.backend)), [availableAgents]);

  // Filter options to only show available agents, plus extension agents
  const filteredOptions = useMemo(() => {
    const builtinFiltered = BUILTIN_AGENT_OPTIONS.filter((opt) => availableBackends.has((opt.backendId ?? opt.value) as AcpBackend));

    // Add extension-contributed agents
    const extensionOptions: AgentOption[] = availableAgents
      .filter((a) => a.isExtension && a.backend === 'custom')
      .map((a) => ({
        value: a.customAgentId || a.backend,
        label: a.name,
      }));

    return [...builtinFiltered, ...extensionOptions];
  }, [availableAgents, availableBackends]);

  // Resolve current agent logo
  const effectiveBackend = normalizePresetAgentType(currentAgentType) || currentAgentType;
  const currentLogo = getAgentLogo(effectiveBackend);

  // Try extension avatar if no built-in logo
  const extensionAgent = !currentLogo ? availableAgents.find((a) => a.isExtension && (a.customAgentId === currentAgentType || a.backend === currentAgentType)) : undefined;
  const extensionAvatar = extensionAgent ? resolveExtensionAssetUrl(extensionAgent.avatar) : undefined;
  const displayLogo = currentLogo || extensionAvatar;

  // When disabled, render static display without dropdown functionality
  if (disabled) {
    return (
      <div className='flex items-center gap-4px select-none px-8px py-4px rd-8px' style={{ cursor: 'default', opacity: 0.85 }}>
        {displayLogo ? <img src={displayLogo} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : <Robot theme='outline' size={24} />}
      </div>
    );
  }

  return (
    <Popover
      trigger='click'
      position='br'
      popupVisible={visible}
      onVisibleChange={setVisible}
      content={
        <div className='py-4px min-w-180px'>
          {filteredOptions.map((opt) => {
            const isSelected = opt.value === currentAgentType;
            const logo = getAgentLogo(opt.backendId || opt.value);
            const extAgent = !logo ? availableAgents.find((a) => a.isExtension && a.customAgentId === opt.value) : undefined;
            const extAvatar = extAgent ? resolveExtensionAssetUrl(extAgent.avatar) : undefined;
            const itemLogo = logo || extAvatar;

            return (
              <div
                key={opt.value}
                className='flex items-center gap-8px px-12px py-8px cursor-pointer hover:bg-fill-2 rd-6px mx-4px transition-colors'
                onClick={() => {
                  onSelectAgent(opt.value);
                  setVisible(false);
                }}
              >
                {itemLogo ? <img src={itemLogo} alt='' width={20} height={20} style={{ objectFit: 'contain', flexShrink: 0 }} /> : <Robot theme='outline' size={20} style={{ flexShrink: 0 }} />}
                <span className='flex-1 text-14px' style={{ color: 'var(--color-text-1)' }}>
                  {opt.label}
                </span>
                {isSelected && <Check theme='outline' size={16} style={{ color: 'var(--ui-accent-orange)', flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      }
    >
      <div className='flex items-center gap-4px cursor-pointer select-none px-8px py-4px rd-8px hover:bg-fill-2 transition-colors'>
        {displayLogo ? <img src={displayLogo} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : <Robot theme='outline' size={24} />}
        <Down theme='outline' size={14} style={{ color: 'var(--color-text-2)' }} />
      </div>
    </Popover>
  );
};

export default AssistantAgentDropdown;
