import { Button, Dropdown } from '@arco-design/web-react';
import { ArrowUp, FolderOpen, Plus, Shield, UploadOne } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import AgentModeSelector from '@/renderer/components/AgentModeSelector';
import { getAgentModes, supportsModeSwitch, type AgentModeOption } from '@/renderer/utils/agentModes';
import BdpanLogo from '@/renderer/assets/logos/bdpan.png';
import BdpanImportFilePicker from '@/renderer/components/base/BdpanImportFilePicker';
import styles from '../index.module.css';
import type { AcpBackend, AcpBackendConfig, AvailableAgent } from '../types';
import PresetAgentTag from './PresetAgentTag';

type GuidActionRowProps = {
  // File handling
  files: string[];
  onFilesUploaded: (paths: string[]) => void;
  onSelectWorkspace: (dir: string) => void;

  // Model selector node (rendered by parent)
  modelSelectorNode: React.ReactNode;

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
  onClosePresetTag: () => void;

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
  onSelectWorkspace,
  modelSelectorNode,
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
  const [bdpanSelectorVisible, setBdpanSelectorVisible] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const modeBackend = effectiveModeAgent || selectedAgent;
  const modeOptions = getAgentModes(modeBackend);
  const currentModeOption = modeOptions.find((mode) => mode.value === selectedMode);

  const getModeDisplayLabel = (mode: AgentModeOption): string => t(`agentMode.${mode.value}`, { defaultValue: mode.label });

  const permissionLabel = currentModeOption ? `${t('agentMode.permission')} · ${getModeDisplayLabel(currentModeOption)}` : t('agentMode.permission');

  return (
    <>
      <div className='flex items-center justify-between w-full gap-2 mt-3'>
        <div className={`${styles.actionTools} inline-flex items-center gap-2.5 shrink min-w-0`}>
          <Dropdown
            trigger={'click'}
            popupVisible={fileMenuOpen}
            onVisibleChange={setFileMenuOpen}
            droplist={
              <div className='flex flex-col gap-2px p-6px rd-12px border bg-popup' style={{ minWidth: 200, boxShadow: '0 8px 28px rgba(0, 0, 0, 0.12)' }}>
                <div
                  className='flex items-center gap-10px px-10px h-38px rd-8px cursor-pointer text-14px text-foreground transition-colors hover:bg-hover active:bg-active'
                  onClick={() => {
                    setFileMenuOpen(false);
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
                >
                  <UploadOne theme='outline' size='16' fill={'var(--text-secondary)'} style={{ lineHeight: 0 }} />
                  <span>{t('conversation.welcome.downloadLocalFile')}</span>
                </div>
                <div
                  className='flex items-center gap-10px px-10px h-38px rd-8px cursor-pointer text-14px text-foreground transition-colors hover:bg-hover active:bg-active'
                  onClick={() => {
                    setFileMenuOpen(false);
                    setBdpanSelectorVisible(true);
                  }}
                >
                  <img src={BdpanLogo} alt='Bdpan' style={{ width: 16, height: 16 }} />
                  <span>{t('conversation.welcome.downloadBdpanFile')}</span>
                </div>
                <div
                  className='flex items-center gap-10px px-10px h-38px rd-8px cursor-pointer text-14px text-foreground transition-colors hover:bg-hover active:bg-active'
                  onClick={() => {
                    setFileMenuOpen(false);
                    ipcBridge.dialog.showOpen
                      .invoke({ properties: ['openDirectory'] })
                      .then((res) => {
                        if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
                          onSelectWorkspace(res.data.filePaths[0]);
                        }
                      })
                      .catch((error) => {
                        console.error('Failed to open directory dialog:', error);
                      });
                  }}
                >
                  <FolderOpen theme='outline' size='16' fill={'var(--text-secondary)'} style={{ lineHeight: 0 }} />
                  <span>{t('conversation.welcome.specifyWorkspace')}</span>
                </div>
              </div>
            }
          >
            <span className='relative'>
              <Button shape='circle' type='secondary' title={t('conversation.welcome.downloadLocalFile')} icon={<Plus theme='outline' strokeWidth={4} fill={'var(--text-secondary)'} />} />
              {files.length > 0 && <span className='absolute -right-3px -top-3px f-center min-w-14px h-14px rounded-full bg-primary px-3px text-9px text-white font-600 pointer-events-none'>{files.length}</span>}
              {/* {files.length > 0 && (
                <Tooltip className={'!max-w-max'} content={<span className='whitespace-break-spaces'>{getCleanFileNames(files).join('\n')}</span>}>
                  <span className='sr-only'>File({files.length})</span>
                </Tooltip>
              )} */}
            </span>
          </Dropdown>

          {skillTriggerNode}

          {modelSelectorNode}

          {supportsModeSwitch(modeBackend) && (
            <AgentModeSelector backend={modeBackend} compact initialMode={selectedMode} onModeSelect={onModeSelect} compactLabelOverride={permissionLabel} compactLeadingIcon={<Shield theme='outline' size='14' fill='currentColor' />} modeLabelFormatter={getModeDisplayLabel} />
          )}

          {isPresetAgent && selectedAgentInfo && <PresetAgentTag agentInfo={selectedAgentInfo} customAgents={customAgents} localeKey={localeKey} onClose={onClosePresetTag} />}
        </div>
        <Button shape='circle' type='primary' loading={loading} disabled={isButtonDisabled} icon={<ArrowUp theme='filled' fill='white' strokeWidth={4} />} onClick={onSend} />
      </div>

      <BdpanImportFilePicker
        visible={bdpanSelectorVisible}
        onCancel={() => setBdpanSelectorVisible(false)}
        onConfirm={(paths) => {
          setBdpanSelectorVisible(false);
          onFilesUploaded(paths);
        }}
      />
    </>
  );
};

export default GuidActionRow;
