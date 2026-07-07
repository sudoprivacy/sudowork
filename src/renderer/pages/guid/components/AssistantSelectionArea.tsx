import { Plus, Robot } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AcpBackendConfig, AvailableAgent } from '../types';
import { CUSTOM_AVATAR_IMAGE_MAP } from '../constants';

type AssistantSelectionAreaProps = {
  customAgents: AcpBackendConfig[];
  localeKey: string;
  onSelectAssistant: (assistantId: string) => void;
  /** Enterprise mode available agents (cloud agents) for Remote mode */
  availableAgents?: AvailableAgent[];
  /** Current session mode (remote/local) for enterprise mode */
  sessionMode?: 'remote' | 'local';
  /** Whether the app is in enterprise mode */
  isEnterprise?: boolean;
};

function dedupeAssistantsForDisplay(agents: AcpBackendConfig[], localeKey: string): AcpBackendConfig[] {
  const seen = new Set<string>();
  const deduped: AcpBackendConfig[] = [];
  for (const agent of agents) {
    const displayName = agent.nameI18n?.[localeKey] || agent.nameI18n?.['zh-CN'] || agent.nameI18n?.['en-US'] || agent.name;
    const keys = [agent.id, displayName.trim().toLowerCase()].filter(Boolean);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) {
      seen.add(key);
    }
    deduped.push(agent);
  }
  return deduped;
}

/**
 * Renders the agent selection grid (pill list) when no agent is selected.
 * The selected agent view (header, description, prompts) is now handled
 * directly in GuidPage for proper layout ordering.
 */
const AssistantSelectionArea: React.FC<AssistantSelectionAreaProps> = ({ customAgents, localeKey, onSelectAssistant, sessionMode, isEnterprise }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Enterprise Remote mode: render agents from customAgents
  // E端 Remote 模式：智能体来自本地 hub/system/custom/tenant 文件夹，id 为 UUID，存放在 customAgents
  if (isEnterprise && sessionMode === 'remote') {
    const cloudAssistants = dedupeAssistantsForDisplay(
      (customAgents || []).filter((a) => a.enabled !== false),
      localeKey
    );
    if (cloudAssistants.length === 0) return null;

    return (
      <div className='mt-16px w-full'>
        <div className='f-center flex-wrap gap-2'>
          {cloudAssistants.map((assistant) => {
            const avatarValue = assistant.avatar?.trim();
            const mappedAvatar = avatarValue ? CUSTOM_AVATAR_IMAGE_MAP[avatarValue] : undefined;
            const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
            const avatarImage = mappedAvatar || resolvedAvatar;
            const isImageAvatar = Boolean(avatarImage && (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage)));
            return (
              <div
                key={assistant.id}
                className='h-28px group flex items-center gap-8px px-16px rd-100px cursor-pointer transition-all b-1 b-solid bg-fill-0 hover:bg-fill-1 select-none'
                style={{ borderWidth: '1px', borderColor: 'var(--bg-3)' }}
                onClick={() => onSelectAssistant(`custom:${assistant.id}`)}
              >
                <span className='inline-flex h-16px w-16px shrink-0 items-center justify-center leading-none'>
                  {isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain', display: 'block' }} /> : avatarValue ? <span style={{ fontSize: 16, lineHeight: 1 }}>{avatarValue}</span> : <Robot theme='outline' size={16} />}
                </span>
                <span className='text-14px text-2 hover:text-1'>{assistant.nameI18n?.[localeKey] || assistant.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Local mode / C端：需要 customAgents 数据才能渲染
  if (!customAgents || customAgents.length === 0) return null;

  // Separate preset agents (builtin + hub-installed) from user-created custom agents
  const presetAgents = customAgents.filter((a) => a.isPreset);
  const userCreatedAgents = customAgents.filter((a) => !a.isPreset);

  // const allowedPresetIds = ['builtin-ui-ux-pro-max', 'builtin-planning-with-files', 'builtin-beautiful-mermaid', 'builtin-moltbook', 'builtin-copilot', 'builtin-doctor', 'builtin-jiansheku'];
  // const allowedBuiltinPresets = presetAgents.filter((a) => allowedPresetIds.includes(a.id));
  const allowedBuiltinPresets: AcpBackendConfig[] = []; // Hidden: builtin agents temporarily disabled
  const hubInstalledPresets = presetAgents.filter((a) => !a.id.startsWith('builtin-'));

  // Combine: allowed builtin presets + hub-installed presets + user-created custom agents
  const filteredAgents = dedupeAssistantsForDisplay([...allowedBuiltinPresets, ...hubInstalledPresets, ...userCreatedAgents], localeKey);

  // Agent List View
  return (
    <div className='mt-16px w-full'>
      <div className='f-center flex-wrap gap-2'>
        {filteredAgents
          .filter((a) => a.enabled !== false)
          .sort((a, b) => {
            if (a.id === 'cowork') return -1;
            if (b.id === 'cowork') return 1;
            return 0;
          })
          .map((assistant) => {
            const avatarValue = assistant.avatar?.trim();
            const mappedAvatar = avatarValue ? CUSTOM_AVATAR_IMAGE_MAP[avatarValue] : undefined;
            const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
            const avatarImage = mappedAvatar || resolvedAvatar;
            const isImageAvatar = Boolean(avatarImage && (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage)));
            return (
              <div
                key={assistant.id}
                className='h-28px group flex items-center gap-8px px-16px rd-100px cursor-pointer transition-all b-1 b-solid bg-fill-0 hover:bg-fill-1 select-none'
                style={{ borderWidth: '1px', borderColor: 'var(--bg-3)' }}
                onClick={() => onSelectAssistant(`custom:${assistant.id}`)}
              >
                <span className='inline-flex h-16px w-16px shrink-0 items-center justify-center leading-none'>
                  {isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain', display: 'block' }} /> : avatarValue ? <span style={{ fontSize: 16, lineHeight: 1 }}>{avatarValue}</span> : <Robot theme='outline' size={16} />}
                </span>
                <span className='text-14px text-2 hover:text-1'>{assistant.nameI18n?.[localeKey] || assistant.name}</span>
              </div>
            );
          })}
        <div className='group f-center h-28px min-w-28px px-8px gap-4px rd-100px bg-fill-0 cursor-pointer whitespace-nowrap b-1 b-dashed select-none transition-colors duration-300 hover:bg-fill-2' style={{ borderWidth: '1px', borderColor: 'var(--bg-3)' }} onClick={() => navigate('/settings/agent')}>
          <Plus theme='outline' size={14} className='flex-shrink-0 line-height-0 text-[var(--color-text-3)] group-hover:text-[var(--color-text-2)] transition-colors duration-300' />
          <span className='text-14px text-2 group-hover:text-1 transition-colors duration-300'>{t('settings.createAssistant', { defaultValue: '创建智能体' })}</span>
        </div>
      </div>
    </div>
  );
};

export default AssistantSelectionArea;
