/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { ArrowUp, Plus, Shield } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import AgentModeSelector from '@/renderer/components/AgentModeSelector';
import { getAgentModes, supportsModeSwitch, type AgentModeOption } from '@/renderer/utils/agentModes';
import type { AcpBackend, AcpBackendConfig, AvailableAgent } from '../types';
import PresetAgentTag from './PresetAgentTag';

type GuidActionRowProps = {
  // File handling
  files: string[];
  onFilesUploaded: (paths: string[]) => void;
  onSelectWorkspace: (dir: string) => void;

  // Model selector node (rendered by parent)
  modelSelectorNode?: React.ReactNode;

  // Agent mode
  selectedAgent: AcpBackend | 'custom';
  effectiveModeAgent?: string;
  selectedMode: string;
  onModeSelect: (mode: string) => void;

  // Preset agent tag
  isPresetAgent: boolean;
  selectedAgentInfo: AvailableAgent | undefined;
  customAgents: AcpBackendConfig[];
  localeKey: string;
  /** When undefined the close × is hidden (brand-locked agent). */
  onClosePresetTag?: () => void;

  // Skill selector trigger node (Popover-wrapped button built by parent)
  skillTriggerNode?: React.ReactNode;

  // Send button
  loading: boolean;
  isButtonDisabled: boolean;
  onSend: () => void;
};

const GuidActionRow: React.FC<GuidActionRowProps> = ({
  files,
  onFilesUploaded,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onSelectWorkspace: _onSelectWorkspace,
  // modelSelectorNode,
  selectedAgent,
  effectiveModeAgent,
  selectedMode,
  onModeSelect,
  isPresetAgent,
  selectedAgentInfo,
  customAgents,
  localeKey,
  onClosePresetTag,
  skillTriggerNode,
  loading,
  isButtonDisabled,
  onSend,
}) => {
  const { t } = useTranslation();
  const modeBackend = effectiveModeAgent || selectedAgent;
  const modeOptions = getAgentModes(modeBackend);
  const currentModeOption = modeOptions.find((mode) => mode.value === selectedMode);

  const getModeDisplayLabel = (mode: AgentModeOption): string => t(`agentMode.${mode.value}`, { defaultValue: mode.label });

  const permissionLabel = currentModeOption ? `${t('agentMode.permission')} · ${getModeDisplayLabel(currentModeOption)}` : t('agentMode.permission');

  return (
    <div className='flex items-center justify-between w-full gap-2 mt-3'>
      <div className='inline-flex items-center gap-2.5 shrink min-w-0'>
        <span className='relative'>
          <Button
            shape='circle'
            type='secondary'
            title={t('conversation.welcome.downloadLocalFile')}
            icon={<Plus size={18} className='text-foreground-secondary' />}
            onClick={() => {
              ipcBridge.dialog.showOpen
                .invoke({ properties: ['openFile', 'multiSelections'] })
                .then((res) => {
                  if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
                    onFilesUploaded(res.data.filePaths);
                  }
                })
                .catch((error) => {
                  console.error('Failed to open file dialog:', error);
                });
            }}
          />
          {files.length > 0 && <span className='absolute -right-3px -top-3px f-center min-w-14px h-14px rounded-full bg-primary px-3px text-9px text-primary-foreground font-600 pointer-events-none'>{files.length}</span>}
        </span>

        {skillTriggerNode}

        {/* {modelSelectorNode} */}

        {supportsModeSwitch(modeBackend) && <AgentModeSelector backend={modeBackend} compact initialMode={selectedMode} onModeSelect={onModeSelect} compactLabelOverride={permissionLabel} compactLeadingIcon={<Shield size={14} color='currentColor' />} modeLabelFormatter={getModeDisplayLabel} />}

        {isPresetAgent && selectedAgentInfo && <PresetAgentTag agentInfo={selectedAgentInfo} customAgents={customAgents} localeKey={localeKey} onClose={onClosePresetTag} />}
      </div>
      <Button shape='circle' type='primary' loading={loading} disabled={isButtonDisabled} icon={<ArrowUp size={16} className='text-primary-foreground' />} onClick={onSend} />
    </div>
  );
};

export default GuidActionRow;
