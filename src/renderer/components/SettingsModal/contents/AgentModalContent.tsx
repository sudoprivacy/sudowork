/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, skillHub, assistantHub } from '@/common';
import { eeclaw } from '@/common/ipcBridge';
import type { IInstalledSkillInfo, IAssistantHubSkill, IAssistantHubDetail, ISkillHubSkill } from '@/common/ipcBridge';
import { toBackendConfig, resolveAssistantName } from '@/renderer/shared/agents/assistantAdapter';
import type { AssistantCategory } from '@/process/AssistantManager';
import { resolveLocaleKey, uuid } from '@/common/utils';
import coworkSvg from '@/renderer/assets/cowork.svg';
import EmojiPicker from '@/renderer/components/EmojiPicker';
import MarkdownView from '@/renderer/components/Markdown';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { getSelectableAssistantSkills, isAutoInjectedBuiltinSkill, sanitizeAssistantEnabledSkills } from '@/renderer/pages/settings/assistantSkillSelection';
import { getInstalledSkillDisplay, normalizeSkillVersion } from '@/renderer/utils/skillDisplay';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { DEFAULT_PRESET_AGENT_TYPE, normalizePresetAgentType, type AcpBackendConfig } from '@/types/acpTypes';
import { Avatar, Button, Checkbox, Collapse, Drawer, Input, Message, Modal, Popconfirm, Progress, Select, Spin, Switch, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { Close, Copy, Delete, Edit, Lightning, PreviewOpen, Plus, Robot, Shield, Search, Install, Upload, Share, UploadOne, Check } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/context/AuthContext';
import useSWR, { mutate } from 'swr';
import { useNavigate } from 'react-router-dom';
import { useSettingsViewMode } from '../settingsViewContext';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { emitter } from '@/renderer/utils/emitter';

// ==================== Types ====================

type AssistantListItem = AcpBackendConfig & {
  _source?: string;
  _extensionName?: string;
  _kind?: string;
  _category?: AssistantCategory;
  _isHubInstalled?: boolean;
};

type AssistantStoreTab = 'store' | 'exclusive' | 'installed';

// ==================== SkillCard (for drawer skill selection) ====================

interface SkillCardProps {
  skill: IInstalledSkillInfo;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, checked, onToggle, disabled }) => {
  const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
  const displayVersion = normalizeSkillVersion(skill.version);

  return (
    <div className={`bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <Checkbox checked={checked} onChange={onToggle} disabled={disabled} className={`mt-2px ${disabled ? '' : 'cursor-pointer'}`} />
      <div className='w-48px h-48px flex-shrink-0 rd-8px overflow-hidden bg-fill-2'>
        {icon ? (
          <img src={icon} alt={displayName} className='w-full h-full object-cover' />
        ) : emoji ? (
          <div className='w-full h-full flex items-center justify-center text-22px'>{emoji}</div>
        ) : (
          <div className='w-full h-full flex items-center justify-center bg-primary-light'>
            <Lightning size='22' className='text-primary' />
          </div>
        )}
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px'>
          <span className='font-medium text-13px text-t-primary truncate'>{displayName}</span>
          {!skill.isBuiltin && displayVersion && <span className='px-5px py-0px bg-fill-3 text-t-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
          {skill.isBuiltin && <Shield size='14' className='text-primary flex-shrink-0' />}
        </div>
        {description && <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div>}
      </div>
    </div>
  );
};

// ==================== InstalledAssistantCard ====================

const InstalledAssistantCard: React.FC<{
  assistant: AssistantListItem;
  isExtension: boolean;
  localeKey: string;
  avatarImageMap: Record<string, string>;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpload?: () => void;
  onClick: () => void;
  /** Enterprise mode: publish button element */
  enterprisePublishButton?: React.ReactNode;
  /** Enterprise mode: whether to hide delete button (only custom assistants can be deleted) */
  hideDelete?: boolean;
}> = ({ assistant, isExtension, localeKey, avatarImageMap, onToggleEnabled, onDelete, onDuplicate, onUpload, onClick, enterprisePublishButton, hideDelete }) => {
  const { t } = useTranslation();
  const isCustom = !assistant.isBuiltin && !isExtension && !assistant._isHubInstalled;
  const isReadonly = assistant.isBuiltin || isExtension || assistant._isHubInstalled || hideDelete;
  const isEnabled = isExtension ? true : assistant.enabled !== false;

  const resolvedAvatar = assistant.avatar?.trim();
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));

  const resolveAvatarImage = (avatar: string | undefined): string | undefined => {
    const value = avatar?.trim();
    if (!value) return undefined;
    const mapped = avatarImageMap[value];
    if (mapped) return mapped;
    const resolved = resolveExtensionAssetUrl(value) || value;
    const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
    return isImage ? resolved : undefined;
  };

  const avatarImage = resolveAvatarImage(resolvedAvatar);
  const displayName = assistant.nameI18n?.[localeKey] || assistant.name;
  const description = assistant.descriptionI18n?.[localeKey] || assistant.description || '';

  return (
    <div className={classNames('bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative overflow-hidden transition-colors cursor-pointer hover:bg-fill-2', !isEnabled && 'opacity-65')} onClick={onClick}>
      {/* Avatar */}
      <div className='w-48px flex-shrink-0'>
        <div className='w-48px h-48px rd-8px overflow-hidden bg-fill-2'>
          {avatarImage ? (
            <img src={avatarImage} alt={displayName} className='w-full h-full object-cover' />
          ) : hasEmojiAvatar ? (
            <div className='w-full h-full flex items-center justify-center text-22px'>{resolvedAvatar}</div>
          ) : (
            <div className='w-full h-full flex items-center justify-center bg-primary-light'>
              <Robot theme='filled' size='22' className='text-primary' />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='h-20px flex items-center'>
          <span className='font-medium text-13px text-t-primary truncate' title={displayName.length > 15 ? displayName : undefined}>
            {displayName.length > 15 ? `${displayName.slice(0, 15)}...` : displayName}
          </span>
        </div>
        <div className='mt-3px min-h-30px'>{description ? <div className='text-11px text-t-secondary line-clamp-2 leading-15px'>{description}</div> : null}</div>
        {assistant.enabledSkills && assistant.enabledSkills.length > 0 && (
          <div className='mt-4px flex items-center gap-4px'>
            <Lightning size='12' className='text-primary flex-shrink-0' />
            <span className='text-10px text-t-tertiary'>{t('settings.assistant.relatedSkills', { count: assistant.enabledSkills.length, defaultValue: `${assistant.enabledSkills.length} 个关联技能` })}</span>
          </div>
        )}
        {/* Toggle + Enterprise publish button row - at the bottom */}
        {isCustom && (
          <div className='mt-8px flex items-center justify-between'>
            <div
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <Switch size='small' checked={isEnabled} onChange={(checked) => onToggleEnabled(checked)} className={isEnabled ? '!bg-primary !border-primary' : ''} />
            </div>
            {/* Enterprise publish button - at the rightmost, same row as toggle */}
            {enterprisePublishButton}
          </div>
        )}
      </div>

      {/* Top-right: edit/view + upload (custom only) + duplicate button + shield (builtin) or delete (custom) */}
      <div className='absolute top-10px right-10px flex items-center gap-6px' onClick={(e) => e.stopPropagation()}>
        {/* Edit/View button - custom assistants show edit, readonly assistants show view */}
        <button type='button' className='group h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-t-primary' onClick={onClick}>
          {isReadonly ? <PreviewOpen size='13' /> : <Edit size='13' />}
          <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{isReadonly ? t('settings.assistant.view', { defaultValue: '查看' }) : t('settings.assistant.edit', { defaultValue: '编辑' })}</span>
        </button>
        {/* Upload button - only for custom assistants */}
        {isCustom && onUpload && (
          <button type='button' className='group h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-t-primary' onClick={onUpload}>
            <Upload size='13' />
            <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.assistant.upload', { defaultValue: '上传' })}</span>
          </button>
        )}
        {/* Duplicate button - available for all assistant types */}
        <button type='button' className='group h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-t-primary' onClick={onDuplicate}>
          <Copy size='13' />
          <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.assistant.duplicate', { defaultValue: '复制' })}</span>
        </button>
        {/* Delete button - only for custom assistants that are not readonly */}
        {!isReadonly && (
          <Popconfirm title={t('settings.deleteAssistantConfirmTitle', { defaultValue: '删除该助手会一并删除已关联会话。如需保留，请导出会话进行备份。是否确认删除？' })} onOk={onDelete} okText={t('common.delete', { defaultValue: '删除' })} cancelText={t('common.cancel', { defaultValue: '取消' })} okButtonProps={{ status: 'danger' }}>
            <button type='button' className='group h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-danger'>
              <Delete size='13' />
              <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.assistant.delete', { defaultValue: '删除' })}</span>
            </button>
          </Popconfirm>
        )}
      </div>
    </div>
  );
};

// ==================== HubAssistantCard (for store tab) ====================

const HubAssistantCard: React.FC<{
  assistant: IAssistantHubSkill;
  isInstalled: boolean;
  installing: boolean;
  installProgress: number;
  onInstall: (e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  onClick: () => void;
}> = ({ assistant, isInstalled, installing, installProgress, onInstall, onDuplicate, onClick }) => {
  const { t } = useTranslation();

  const displayName = assistant.display_name || assistant.name;
  const resolvedAvatar = assistant.avatar?.trim();
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));

  // Check if assistant has a valid download URL (null/undefined means no installable package)
  const hasDownloadUrl = Boolean(assistant._sourceUrl);

  return (
    <div className='group bg-fill-1 rd-12px cursor-pointer hover:bg-fill-2 transition-colors border border-line p-12px flex items-start gap-12px relative overflow-hidden' onClick={onClick}>
      {/* Icon */}
      <div className='w-48px flex-shrink-0 flex flex-col items-center'>
        <div className='w-48px h-48px rd-8px overflow-hidden bg-fill-2'>
          {resolvedAvatar ? (
            hasEmojiAvatar ? (
              <div className='w-full h-full flex items-center justify-center text-22px'>{resolvedAvatar}</div>
            ) : (
              <img src={resolvedAvatar} alt={displayName} className='w-full h-full object-cover' />
            )
          ) : assistant.emoji ? (
            <div className='w-full h-full flex items-center justify-center text-22px'>{assistant.emoji}</div>
          ) : (
            <div className='w-full h-full flex items-center justify-center bg-primary-light'>
              <Robot theme='filled' size='22' className='text-primary' />
            </div>
          )}
        </div>
        {isInstalled && <span className='mt-6px px-5px py-0px bg-primary-light text-primary text-10px rd-3px whitespace-nowrap leading-18px'>{t('settings.assistant.installed', { defaultValue: '已安装' })}</span>}
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px pr-100px min-w-0'>
          <span className='flex-1 min-w-0 font-medium text-13px text-t-primary truncate'>{displayName}</span>
        </div>
        <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{assistant.description}</div>
        {assistant.skills && assistant.skills.length > 0 && (
          <div className='mt-4px flex items-center gap-4px'>
            <Lightning size='12' className='text-primary flex-shrink-0' />
            <span className='text-10px text-t-tertiary'>{t('settings.assistant.relatedSkills', { count: assistant.skills.length, defaultValue: `${assistant.skills.length} 个关联技能` })}</span>
          </div>
        )}
      </div>

      {/* Actions - top right */}
      <div className='absolute top-10px right-10px flex items-center gap-6px' onClick={(e) => e.stopPropagation()}>
        {/* Duplicate button - only for installed assistants */}
        {isInstalled && (
          <button type='button' className='h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-t-primary' onClick={onDuplicate}>
            <Copy size='13' />
            <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.assistant.duplicate', { defaultValue: '复制' })}</span>
          </button>
        )}
        {/* Install button or progress - only show if hasDownloadUrl */}
        {installing ? (
          <div className='w-52px'>
            <Progress percent={installProgress} size='mini' />
          </div>
        ) : !isInstalled && hasDownloadUrl ? (
          <button type='button' className='h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-t-primary' onClick={onInstall}>
            <Install size='13' />
            <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.assistant.install', { defaultValue: '安装' })}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};

// ==================== TenantAssistantCard (for exclusive tab in enterprise mode) ====================

const TenantAssistantCard: React.FC<{
  assistant: {
    id: string;
    name: string;
    displayName?: string;
    description?: string;
    version?: string;
    status: string;
    author?: string;
    authorName?: string;
    enabledSkills?: string[];
    approvedAt?: string;
    installed?: boolean;
  };
  isInstalled: boolean;
  installing: boolean;
  installProgress: number;
  onDuplicate: (e: React.MouseEvent) => void;
  onClick: () => void;
}> = ({ assistant, isInstalled, installing, installProgress, onDuplicate, onClick }) => {
  const { t } = useTranslation();

  const displayName = assistant.displayName || assistant.name;

  // Tenant assistants are synced from server and always considered installed
  // Show "已安装" badge and duplicate button (same as hub installed assistants)

  return (
    <div className='group bg-fill-1 rd-12px cursor-pointer hover:bg-fill-2 transition-colors border border-line p-12px flex items-start gap-12px relative overflow-hidden' onClick={onClick}>
      {/* Icon */}
      <div className='w-48px flex-shrink-0 flex flex-col items-center'>
        <div className='w-48px h-48px rd-8px overflow-hidden bg-fill-2'>
          <div className='w-full h-full flex items-center justify-center bg-primary-light'>
            <Robot theme='filled' size='22' className='text-primary' />
          </div>
        </div>
        {/* Tenant assistants are always installed after sync */}
        <span className='mt-6px px-5px py-0px bg-primary-light text-primary text-10px rd-3px whitespace-nowrap leading-18px'>{t('settings.assistant.installed', { defaultValue: '已安装' })}</span>
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px pr-100px min-w-0'>
          <span className='flex-1 min-w-0 font-medium text-13px text-t-primary truncate'>{displayName}</span>
        </div>
        <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{assistant.description || ''}</div>
        {assistant.enabledSkills && assistant.enabledSkills.length > 0 && (
          <div className='mt-4px flex items-center gap-4px'>
            <Lightning size='12' className='text-primary flex-shrink-0' />
            <span className='text-10px text-t-tertiary'>{t('settings.assistant.relatedSkills', { count: assistant.enabledSkills.length, defaultValue: `${assistant.enabledSkills.length} 个关联技能` })}</span>
          </div>
        )}
      </div>

      {/* Actions - top right */}
      <div className='absolute top-10px right-10px flex items-center' onClick={(e) => e.stopPropagation()}>
        {/* Installing progress */}
        {installing ? (
          <div className='w-52px'>
            <Progress percent={installProgress} size='mini' />
          </div>
        ) : (
          /* Duplicate button - tenant assistants are always installed, show duplicate like hub */
          <button type='button' className='h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-t-primary' onClick={onDuplicate}>
            <Copy size='13' />
            <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.assistant.duplicate', { defaultValue: '复制' })}</span>
          </button>
        )}
      </div>
    </div>
  );
};

// ==================== AssistantDetailModal (for store assistants) ====================

const AssistantDetailModal: React.FC<{
  assistant: IAssistantHubSkill | null;
  visible: boolean;
  onClose: () => void;
  isInstalled: boolean;
  installing: boolean;
  installProgress: number;
  onInstall: (selectedSkillIds: string[]) => void;
  onGoUse?: () => void;
  installedSkills: IInstalledSkillInfo[];
}> = ({ assistant, visible, onClose, isInstalled, installing, installProgress, onInstall, onGoUse, installedSkills }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<IAssistantHubDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [relatedSkillDetails, setRelatedSkillDetails] = useState<ISkillHubSkill[]>([]);
  const [relatedSkillTags, setRelatedSkillTags] = useState<Map<string, string>>(new Map());
  const [loadingSkills, setLoadingSkills] = useState(false);

  // Use useAppMode hook for renderer process (enterpriseDebugConfig.isEnterpriseMode only works in main process)
  const { isEnterprise } = useAppMode();

  // Check if assistant has a valid download URL
  const hasDownloadUrl = Boolean(assistant?._sourceUrl);

  // Build a map of local installed skills by ID for quick lookup (memoized to prevent infinite loops)
  const localSkillByIdMap = useMemo(() => {
    const map = new Map<string, IInstalledSkillInfo>();
    for (const skill of installedSkills) {
      if (skill.meta?.id) {
        map.set(skill.meta.id, skill);
      }
    }
    return map;
  }, [installedSkills]);

  const localSkillByNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const skill of installedSkills) {
      set.add(skill.name);
    }
    return set;
  }, [installedSkills]);

  // Count installed skills for display
  const installedSkillCount = relatedSkillDetails.filter((s) => localSkillByNameSet.has(s.name)).length;

  // Fetch assistant detail and related skill details
  useEffect(() => {
    if (!visible || !assistant) {
      setDetail(null);
      setRelatedSkillDetails([]);
      return;
    }

    setLoading(true);
    setLoadingSkills(true);

    const fetchData = async () => {
      try {
        if (isElectronDesktop()) {
          // In enterprise mode, skip SkillHub API calls - only use local data
          if (!isEnterprise) {
            // Fetch assistant detail from Hub (personal mode only)
            const res = await assistantHub.fetchAssistantDetail.invoke({ assistantId: assistant.id });
            if (res.success && res.data) {
              setDetail(res.data);
            }
          }

          // Fetch related skill details by IDs
          const skillIds = assistant.skills || [];
          if (skillIds.length > 0) {
            // First, find skills from local installed skills (including builtin skills)
            const localFoundSkills: ISkillHubSkill[] = [];
            const localFoundSkillTags: Map<string, string> = new Map(); // Track skill tags separately
            const notFoundSkillIds: string[] = [];

            for (const skillId of skillIds) {
              const localSkill = localSkillByIdMap.get(skillId);
              if (localSkill && localSkill.meta) {
                // Convert local skill info to ISkillHubSkill format
                localFoundSkills.push({
                  id: localSkill.meta.id || skillId,
                  name: localSkill.meta.name || localSkill.name,
                  display_name: localSkill.meta.display_name || localSkill.name,
                  description: localSkill.meta.description || '',
                  icon: localSkill.meta.icon || '',
                  emoji: localSkill.meta.emoji || null,
                  category: localSkill.meta.category || '',
                  categories: localSkill.meta.categories || [],
                  star_count: 0,
                  homepage: localSkill.meta.homepage || null,
                  author_id: localSkill.meta.author_id || '',
                  applicable_scenarios: localSkill.meta.applicable_scenarios || null,
                  core_features: localSkill.meta.core_features || null,
                  created_at: localSkill.meta.installed_at || '',
                  updated_at: localSkill.meta.installed_at || '',
                });
                // Track skill source type for builtin detection
                const skillTag = localSkill.meta.source_type || (localSkill.isBuiltin ? 'builtin' : 'hub');
                localFoundSkillTags.set(skillId, skillTag);
              } else {
                // Not found locally, need to fetch from Hub API
                notFoundSkillIds.push(skillId);
              }
            }

            // Fetch remaining skills from Hub API (personal mode only)
            let hubSkills: ISkillHubSkill[] = [];
            if (notFoundSkillIds.length > 0 && !isEnterprise) {
              const skillsRes = await assistantHub.fetchSkillDetailsByIds.invoke({ skillIds: notFoundSkillIds });
              if (skillsRes.success && skillsRes.data) {
                hubSkills = skillsRes.data;
                // Hub skills are from hub
                for (const skillId of notFoundSkillIds) {
                  localFoundSkillTags.set(skillId, 'hub');
                }
              }
            }

            // Combine local and hub skills, preserving original order
            const allSkills: ISkillHubSkill[] = [];
            for (const skillId of skillIds) {
              const localSkill = localFoundSkills.find((s) => s.id === skillId);
              if (localSkill) {
                allSkills.push(localSkill);
              } else {
                const hubSkill = hubSkills.find((s) => s.id === skillId);
                if (hubSkill) {
                  allSkills.push(hubSkill);
                }
              }
            }

            setRelatedSkillDetails(allSkills);
            setRelatedSkillTags(localFoundSkillTags);
          }
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setLoading(false);
        setLoadingSkills(false);
      }
    };
    void fetchData();
  }, [visible, assistant, localSkillByIdMap, isEnterprise]);

  if (!assistant) return null;

  const displayName = assistant.display_name || assistant.name;
  const resolvedAvatar = assistant.avatar?.trim();
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));

  return (
    <Modal visible={visible} onCancel={onClose} footer={null} closable={false} maskClosable style={{ width: 480 }} className='assistant-detail-modal' wrapClassName='assistant-detail-modal-wrap'>
      <div className='flex flex-col max-h-80vh'>
        {/* Close button */}
        <div className='flex justify-end mb-4px'>
          <div className='w-28px h-28px flex items-center justify-center rd-full bg-fill-2 hover:bg-fill-3 cursor-pointer transition-colors text-t-secondary' onClick={onClose}>
            <Close size='14' />
          </div>
        </div>

        <AionScrollArea className='flex-1 min-h-0'>
          <div className='px-8px pb-16px'>
            {/* Icon + Name header */}
            <div className='flex flex-col items-center mb-20px'>
              <div className='w-72px h-72px rd-14px overflow-hidden bg-fill-2 mb-12px'>
                {resolvedAvatar ? (
                  hasEmojiAvatar ? (
                    <div className='w-full h-full flex items-center justify-center text-34px'>{resolvedAvatar}</div>
                  ) : (
                    <img src={resolvedAvatar} alt={displayName} className='w-full h-full object-cover' />
                  )
                ) : assistant.emoji ? (
                  <div className='w-full h-full flex items-center justify-center text-34px'>{assistant.emoji}</div>
                ) : (
                  <div className='w-full h-full flex items-center justify-center bg-primary-light'>
                    <Robot theme='filled' size='34' className='text-primary' />
                  </div>
                )}
              </div>
              <div className='font-semibold text-17px text-t-primary text-center'>{displayName}</div>
              {assistant.categories && assistant.categories.length > 0 && (
                <div className='flex gap-4px mt-6px flex-wrap justify-center'>
                  {assistant.categories.map((cat, idx) => (
                    <span key={idx} className='px-7px py-1px bg-fill-2 text-t-secondary text-11px rd-4px'>
                      {cat}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {loading ? (
              <div className='flex justify-center py-32px'>
                <Spin />
              </div>
            ) : (
              <div className='space-y-16px'>
                {/* Assistant intro */}
                <div className='bg-fill-1 rd-10px p-14px'>
                  <div className='flex items-center gap-6px mb-8px'>
                    <span className='text-14px'>✦</span>
                    <span className='font-medium text-13px text-t-primary'>{t('settings.assistant.introduction', { defaultValue: '助手介绍' })}</span>
                  </div>
                  <div className='text-12px text-t-secondary leading-relaxed'>{assistant.description}</div>
                </div>

                {/* Associated skills */}
                {relatedSkillDetails.length > 0 && !isInstalled && (
                  <div className='bg-fill-1 rd-10px p-14px'>
                    <div className='flex items-center gap-6px mb-10px'>
                      <Lightning size='14' className='text-primary' />
                      <span className='font-medium text-13px text-t-primary'>{t('settings.assistant.relatedSkills', { defaultValue: '关联技能' })}</span>
                      <span className='text-12px text-t-tertiary'>({relatedSkillDetails.length})</span>
                      {installedSkillCount > 0 && <span className='text-12px text-t-tertiary'>· {t('settings.assistant.skillsInstalled', { installed: installedSkillCount, defaultValue: `${installedSkillCount} 已安装` })}</span>}
                    </div>
                    {loadingSkills ? (
                      <div className='text-center text-t-secondary text-12px py-16px'>{t('common.loading', { defaultValue: '加载中...' })}</div>
                    ) : (
                      <div className='space-y-8px'>
                        {relatedSkillDetails.map((skill) => {
                          const isSkillInstalled = localSkillByNameSet.has(skill.name);
                          const skillTag = relatedSkillTags.get(skill.id);
                          const isBuiltinSkill = skillTag === 'builtin' || skillTag === 'system';
                          const skillDisplayName = skill.display_name || skill.name;
                          // Resolve icon URL based on skill source type
                          // - Builtin skills: icon is aion-asset:// or file:// URL, use resolveExtensionAssetUrl
                          // - Hub skills: icon may be relative path, need to prepend COS URL
                          let skillIconUrl: string | undefined;
                          if (isBuiltinSkill) {
                            skillIconUrl = resolveExtensionAssetUrl(skill.icon) || skill.icon;
                          } else {
                            // Hub skills: if icon is relative path, prepend COS URL
                            skillIconUrl = skill.icon && !skill.icon.startsWith('http') && !skill.icon.startsWith('data:') && !skill.icon.startsWith('/') && !skill.icon.startsWith('aion-asset://') && !skill.icon.startsWith('file://') ? `https://sudoclaw-1309794936.cos.ap-beijing.myqcloud.com/${skill.icon}` : skill.icon;
                          }
                          return (
                            <div key={skill.id} className='flex items-center gap-10px p-8px bg-fill-2 rd-8px'>
                              <div className='w-32px h-32px flex-shrink-0 rd-6px overflow-hidden bg-fill-3'>
                                {skillIconUrl ? (
                                  <img src={skillIconUrl} alt={skillDisplayName} className='w-full h-full object-cover' />
                                ) : skill.emoji ? (
                                  <div className='w-full h-full flex items-center justify-center text-16px'>{skill.emoji}</div>
                                ) : (
                                  <div className='w-full h-full flex items-center justify-center bg-primary-light'>
                                    <Lightning size='14' className='text-primary' />
                                  </div>
                                )}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='flex items-center gap-4px'>
                                  <span className='font-medium text-13px text-t-primary truncate'>{skillDisplayName}</span>
                                  {isBuiltinSkill && <Shield size='12' className='text-primary flex-shrink-0' />}
                                </div>
                                <div className='text-11px text-t-tertiary truncate'>{skill.description}</div>
                              </div>
                              <span className={`px-4px py-0px text-10px rd-3px whitespace-nowrap ${isSkillInstalled ? 'bg-primary-light text-primary' : 'bg-fill-3 text-t-secondary'}`}>{isSkillInstalled ? t('settings.skill.installed', { defaultValue: '已安装' }) : t('settings.skill.notInstalled', { defaultValue: '未安装' })}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className='mt-12px text-11px text-t-tertiary'>{t('settings.assistant.skillsInstallHint', { defaultValue: '安装助手时会自动安装关联的技能' })}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </AionScrollArea>

        {/* Action buttons */}
        <div className='px-8px pt-12px border-t border-line mt-4px'>
          <div className='flex gap-8px items-center'>
            {isInstalled ? (
              <Button type='primary' long size='large' className='flex-1' onClick={onGoUse || onClose}>
                {t('settings.skill.goUse', { defaultValue: '去使用' })}
              </Button>
            ) : !hasDownloadUrl ? (
              <div className='flex-1 text-center text-t-secondary text-13px py-12px'>{t('settings.assistant.noDownloadUrl', { defaultValue: '该助手暂不支持安装，请联系管理员' })}</div>
            ) : installing ? (
              <div className='flex-1'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : (
              <Button type='primary' long size='large' onClick={() => onInstall(relatedSkillDetails.map((s) => s.id))}>
                <span className='flex items-center gap-6px justify-center'>
                  <Install size='15' />
                  {t('settings.assistant.install', { defaultValue: '安装助手' })}
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ==================== Types ====================

const AgentModalContent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const [agentMessage, agentMessageContext] = Message.useMessage({ maxCount: 10 });
  const localeKey = resolveLocaleKey(i18n.language);

  // Tab state
  const [activeTab, setActiveTab] = useState<AssistantStoreTab>('store');

  // Assistant list state
  const [assistants, setAssistants] = useState<AssistantListItem[]>([]);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);

  // Drawer state
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editAgent, setEditAgent] = useState<string>(DEFAULT_PRESET_AGENT_TYPE);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [promptViewMode, setPromptViewMode] = useState<'edit' | 'preview'>('preview');
  const [drawerWidth, setDrawerWidth] = useState(500);

  // Skills state
  const [installedSkills, setInstalledSkills] = useState<IInstalledSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set(['gemini']));
  const textareaWrapperRef = useRef<HTMLDivElement>(null);

  // Hub state (for store/exclusive tabs)
  const { user } = useAuth();
  const enterpriseCode = user?.enterprise_code?.trim();
  const navigate = useNavigate();
  const [hubAssistantList, setHubAssistantList] = useState<IAssistantHubSkill[]>([]);
  const [hubCategories, setHubCategories] = useState<string[]>([]);
  const [selectedHubCategory, setSelectedHubCategory] = useState('all');
  const [hubSearchQuery, setHubSearchQuery] = useState('');
  const [hubLoading, setHubLoading] = useState(true);
  const [hubLoadingMore, setHubLoadingMore] = useState(false);
  const [hubHasMore, setHubHasMore] = useState(false);
  const [hubNextCursor, setHubNextCursor] = useState<string | null>(null);
  const [hubDetailAssistant, setHubDetailAssistant] = useState<IAssistantHubSkill | null>(null);
  const [hubDetailVisible, setHubDetailVisible] = useState(false);
  const [hubInstalledAssistantNames, setHubInstalledAssistantNames] = useState<Set<string>>(new Set());
  const [installingAssistantId, setInstallingAssistantId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [hubInstalledSkillsReady, setHubInstalledSkillsReady] = useState(false);
  // Duplicate assistant state
  const [duplicateConfirmVisible, setDuplicateConfirmVisible] = useState(false);
  const [duplicateAssistant, setDuplicateAssistant] = useState<IAssistantHubSkill | null>(null);
  const [duplicateInstalledAssistant, setDuplicateInstalledAssistant] = useState<AssistantListItem | null>(null);
  // Duplicate tenant assistant state (for enterprise mode)
  const [duplicateTenantAssistant, setDuplicateTenantAssistant] = useState<{
    id: string;
    name: string;
    displayName?: string;
    description?: string;
    enabledSkills?: string[];
  } | null>(null);
  // Upload assistant state
  const [uploadConfirmVisible, setUploadConfirmVisible] = useState(false);
  const [uploadAssistant, setUploadAssistant] = useState<AssistantListItem | null>(null);
  const [uploading, setUploading] = useState(false);

  // Enterprise mode detection - use useAppMode hook for renderer process
  const { isEnterprise } = useAppMode();

  // Upload/Publish state for enterprise mode
  const [uploadingAssistantName, setUploadingAssistantName] = useState<string | null>(null);
  const [publishingAssistantName, setPublishingAssistantName] = useState<string | null>(null);

  // Track if sync has been triggered for current tab session (avoid loop)
  const syncTriggeredRef = useRef(false);

  // Tenant assistants state for exclusive tab in enterprise mode
  const [tenantAssistants, setTenantAssistants] = useState<
    Array<{
      id: string;
      name: string;
      displayName?: string;
      description?: string;
      version?: string;
      status: 'pending' | 'approved' | 'rejected';
      author?: string;
      authorName?: string;
      enabledSkills?: string[];
      approvedAt?: string;
      installed?: boolean;
    }>
  >([]);
  const [tenantAssistantsLoading, setTenantAssistantsLoading] = useState(false);
  const [installingTenantAssistantId, setInstallingTenantAssistantId] = useState<string | null>(null);

  // Sync status state
  const [syncStatus, setSyncStatus] = useState<{
    syncing: boolean;
    skills: { installed: string[]; skipped: string[]; failed: Array<{ id: string; name: string; error: string }> };
    assistants: { installed: string[]; skipped: string[]; failed: Array<{ id: string; name: string; error: string }> };
  }>({ syncing: false, skills: { installed: [], skipped: [], failed: [] }, assistants: { installed: [], skipped: [], failed: [] } });

  const avatarImageMap = React.useMemo<Record<string, string>>(
    () => ({
      'cowork.svg': coworkSvg,
      '🛠️': coworkSvg,
    }),
    []
  );

  // Extension data
  const { data: extensionAcpAdapters } = useSWR('extensions.acpAdapters', () => ipcBridge.extensions.getAcpAdapters.invoke().catch(() => [] as Record<string, unknown>[]));
  const { data: extensionAssistants } = useSWR('extensions.assistants', () => ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[]));

  const normalizedExtensionAssistants = React.useMemo<AssistantListItem[]>(() => {
    if (!Array.isArray(extensionAssistants) || extensionAssistants.length === 0) return [];
    return extensionAssistants
      .map((ext) => {
        const id = typeof ext.id === 'string' ? ext.id : '';
        const name = typeof ext.name === 'string' ? ext.name : '';
        if (!id || !name) return null;
        return {
          id,
          name,
          nameI18n: ext.nameI18n as Record<string, string> | undefined,
          description: typeof ext.description === 'string' ? ext.description : undefined,
          descriptionI18n: ext.descriptionI18n as Record<string, string> | undefined,
          avatar: typeof ext.avatar === 'string' ? ext.avatar : undefined,
          presetAgentType: typeof ext.presetAgentType === 'string' ? ext.presetAgentType : undefined,
          context: typeof ext.context === 'string' ? ext.context : undefined,
          contextI18n: ext.contextI18n as Record<string, string> | undefined,
          models: Array.isArray(ext.models) ? (ext.models as string[]) : undefined,
          enabledSkills: Array.isArray(ext.enabledSkills) ? (ext.enabledSkills as string[]) : undefined,
          prompts: Array.isArray(ext.prompts) ? (ext.prompts as string[]) : undefined,
          promptsI18n: ext.promptsI18n as Record<string, string[]> | undefined,
          isPreset: true,
          isBuiltin: false,
          enabled: true,
          _source: 'extension',
          _extensionName: typeof ext._extensionName === 'string' ? ext._extensionName : undefined,
          _kind: typeof ext._kind === 'string' ? ext._kind : undefined,
        } as AssistantListItem;
      })
      .filter((item): item is AssistantListItem => item !== null);
  }, [extensionAssistants]);

  const isExtensionAssistant = useCallback((assistant: AssistantListItem | null | undefined) => {
    if (!assistant) return false;
    return assistant._source === 'extension' || assistant.id.startsWith('ext-');
  }, []);

  // Auto focus textarea when drawer opens
  useEffect(() => {
    if (editVisible && promptViewMode === 'edit') {
      const timer = setTimeout(() => {
        const textarea = textareaWrapperRef.current?.querySelector('textarea');
        textarea?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [editVisible, promptViewMode]);

  useEffect(() => {
    const updateDrawerWidth = () => {
      if (typeof window === 'undefined') return;
      const nextWidth = Math.min(500, Math.max(320, Math.floor(window.innerWidth - 32)));
      setDrawerWidth(nextWidth);
    };
    updateDrawerWidth();
    window.addEventListener('resize', updateDrawerWidth);
    return () => window.removeEventListener('resize', updateDrawerWidth);
  }, []);

  // Load available agent backends
  useEffect(() => {
    void (async () => {
      try {
        const resp = await ipcBridge.acpConversation.getAvailableAgents.invoke();
        if (resp.success && resp.data) {
          setAvailableBackends(new Set(resp.data.map((a) => a.backend)));
        }
      } catch {
        // fallback to default
      }
    })();
  }, []);

  // Load installed skills
  const loadInstalledSkills = useCallback(async (): Promise<IInstalledSkillInfo[]> => {
    if (!isElectronDesktop()) {
      setInstalledSkills([]);
      setHubInstalledSkillsReady(true);
      return [];
    }
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        const selectableSkills = getSelectableAssistantSkills(res.data);
        setInstalledSkills(selectableSkills);
        setHubInstalledSkillsReady(true);
        return selectableSkills;
      }
    } catch (error) {
      console.error('Failed to load installed skills:', error);
    }
    setInstalledSkills([]);
    setHubInstalledSkillsReady(true);
    return [];
  }, []);

  const customSelectableSkills = installedSkills.filter((skill) => !skill.isBuiltin);
  const builtinSelectableSkills = installedSkills.filter((skill) => skill.isBuiltin && !isAutoInjectedBuiltinSkill(skill));

  // Hub refs for infinite scroll (mirrors SkillModalContent pattern)
  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectedHubCategoryRef = useRef(selectedHubCategory);
  selectedHubCategoryRef.current = selectedHubCategory;
  const hubSearchQueryRef = useRef(hubSearchQuery);
  hubSearchQueryRef.current = hubSearchQuery;

  // Resolve tenant ID for exclusive tab
  const resolveAssistantTenantId = useCallback(
    (tab: AssistantStoreTab): string | undefined => {
      const normalized = enterpriseCode;
      if (tab !== 'exclusive' || !normalized) return undefined;
      return normalized;
    },
    [enterpriseCode]
  );

  const currentAssistantTenantId = resolveAssistantTenantId(activeTab);

  // Fetch installed assistants for comparison with Hub
  const fetchInstalledAssistantNames = useCallback(async () => {
    if (!isElectronDesktop()) return;
    try {
      const res = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
      if (res.success && res.data) {
        const names = new Set(res.data.map((a) => a.name));
        setHubInstalledAssistantNames(names);
      }
    } catch (err) {
      console.error('Failed to fetch installed assistants:', err);
    }
  }, []);

  // Fetch Hub assistants list
  const fetchHubAssistants = useCallback(
    async (cursor?: string, append = false) => {
      try {
        if (append) setHubLoadingMore(true);
        else setHubLoading(true);

        const category = selectedHubCategoryRef.current === 'all' ? '' : selectedHubCategoryRef.current;
        const query = hubSearchQueryRef.current.trim();
        // Enterprise mode: use sourceType to specify directory (hub or tenant)
        // Personal mode: use tenantId for tenant assistants
        const sourceType = isEnterprise && activeTab === 'exclusive' ? 'tenant' : undefined;
        const tenantId = isEnterprise ? undefined : currentAssistantTenantId;

        if (isElectronDesktop()) {
          const res = await assistantHub.fetchAssistants.invoke({ cursor, limit: 40, query, category, tenantId, sourceType });
          if (res.success && res.data) {
            const newAssistants = res.data.assistants || [];
            if (append) {
              setHubAssistantList((prev) => {
                const existingIds = new Set(prev.map((a) => a.id));
                const unique = newAssistants.filter((a) => !existingIds.has(a.id));
                return [...prev, ...unique];
              });
            } else {
              setHubAssistantList(newAssistants);
            }

            const raw = res.data as unknown as Record<string, unknown>;
            let nextCursorValue: string | null = null;
            if (typeof res.data.next_cursor === 'string' && res.data.next_cursor.length > 0) {
              nextCursorValue = res.data.next_cursor;
            } else if (typeof raw.nextCursor === 'string' && (raw.nextCursor as string).length > 0) {
              nextCursorValue = raw.nextCursor as string;
            }

            const hasMoreValue = res.data.has_more === true || raw.hasMore === true;
            setHubNextCursor(nextCursorValue);
            setHubHasMore(hasMoreValue);
          }
        }
      } catch (err) {
        console.error('Failed to fetch Hub assistants:', err);
        Message.error(t('settings.assistant.fetchFailed', { defaultValue: '获取助手失败' }));
      } finally {
        setHubLoading(false);
        setHubLoadingMore(false);
      }
    },
    [activeTab, currentAssistantTenantId, t]
  );

  // Load more Hub assistants (infinite scroll)
  const loadMoreHubAssistants = useCallback(() => {
    if (!hubLoadingMore && hubHasMore && hubNextCursor) {
      void fetchHubAssistants(hubNextCursor, true);
    }
  }, [hubLoadingMore, hubHasMore, hubNextCursor, fetchHubAssistants]);

  const loadMoreRef = useRef(loadMoreHubAssistants);
  loadMoreRef.current = loadMoreHubAssistants;

  // Fetch Hub categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        if (isElectronDesktop()) {
          const res = await assistantHub.fetchCategories.invoke();
          if (res.success && res.data) {
            setHubCategories(res.data);
          }
        }
      } catch (err) {
        console.error('Failed to fetch assistant categories:', err);
      }
    };
    void fetchCategories();
  }, []);

  // Reload Hub assistants when category changes
  useEffect(() => {
    if (activeTab === 'installed') return;
    setHubAssistantList([]);
    setHubNextCursor(null);
    setHubHasMore(false);
    void fetchHubAssistants();
    void fetchInstalledAssistantNames();
    void loadInstalledSkills();
  }, [activeTab, selectedHubCategory, fetchHubAssistants, fetchInstalledAssistantNames, loadInstalledSkills]);

  // Debounced search reload for Hub
  useEffect(() => {
    if (activeTab === 'installed') return;
    const timer = setTimeout(() => {
      setHubAssistantList([]);
      setHubNextCursor(null);
      setHubHasMore(false);
      void fetchHubAssistants();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, hubSearchQuery, fetchHubAssistants]);

  // Listen for sync completed event (enterprise mode)
  useEffect(() => {
    if (!isEnterprise || !isElectronDesktop()) return;

    const handleSyncCompleted = (data: { skills: { hub: { installed: string[]; skipped: string[]; failed: Array<{ id: string; name: string; error: string }> }; tenant: { installed: string[]; skipped: string[]; failed: Array<{ id: string; name: string; error: string }> } }; assistants: { hub: { installed: string[]; skipped: string[]; failed: Array<{ id: string; name: string; error: string }> }; tenant: { installed: string[]; skipped: string[]; failed: Array<{ id: string; name: string; error: string }> } } }) => {
      // Merge hub and tenant results for display
      const mergedSkills = {
        installed: [...data.skills.hub.installed, ...data.skills.tenant.installed],
        skipped: [...data.skills.hub.skipped, ...data.skills.tenant.skipped],
        failed: [...data.skills.hub.failed, ...data.skills.tenant.failed],
      };
      const mergedAssistants = {
        installed: [...data.assistants.hub.installed, ...data.assistants.tenant.installed],
        skipped: [...data.assistants.hub.skipped, ...data.assistants.tenant.skipped],
        failed: [...data.assistants.hub.failed, ...data.assistants.tenant.failed],
      };
      setSyncStatus({ syncing: false, skills: mergedSkills, assistants: mergedAssistants });
      // Refresh installed list after sync
      void fetchInstalledAssistantNames();
    };

    const unsubscribe = eeclaw.syncCompleted.on(handleSyncCompleted);
    return () => unsubscribe();
  }, [isEnterprise, fetchInstalledAssistantNames]);

  // Trigger sync when switching to store tab in enterprise mode
  // Only trigger once per tab session, not on every syncStatus change
  useEffect(() => {
    if (!isEnterprise || activeTab !== 'store' || !isElectronDesktop()) {
      // Reset ref when leaving store tab
      syncTriggeredRef.current = false;
      return;
    }

    // Skip if already triggered for this tab session
    if (syncTriggeredRef.current) return;

    // Mark as triggered and start sync
    syncTriggeredRef.current = true;
    setSyncStatus({ syncing: true, skills: { installed: [], skipped: [], failed: [] }, assistants: { installed: [], skipped: [], failed: [] } });

    eeclaw.syncFromRemote
      .invoke()
      .then((res) => {
        if (!res.success) {
          // Sync failed, reset status (syncCompleted event won't be emitted)
          console.error('Sync failed:', res.msg);
          setSyncStatus({ syncing: false, skills: { installed: [], skipped: [], failed: [] }, assistants: { installed: [], skipped: [], failed: [] } });
        }
        // If success, syncCompleted event will be emitted and handled separately
      })
      .catch((err) => {
        console.error('Failed to trigger sync:', err);
        setSyncStatus({ syncing: false, skills: { installed: [], skipped: [], failed: [] }, assistants: { installed: [], skipped: [], failed: [] } });
      });
  }, [isEnterprise, activeTab]);

  // Fetch tenant assistants when switching to exclusive tab in enterprise mode
  useEffect(() => {
    if (!isEnterprise || activeTab !== 'exclusive' || !isElectronDesktop()) return;

    const fetchTenantAssistants = async () => {
      setTenantAssistantsLoading(true);
      try {
        const res = await eeclaw.getTenantAssistants.invoke();
        if (res.success && res.data) {
          setTenantAssistants(res.data);
        }
      } catch (err) {
        console.error('Failed to fetch tenant assistants:', err);
      } finally {
        setTenantAssistantsLoading(false);
      }
    };

    void fetchTenantAssistants();
  }, [isEnterprise, activeTab]);

  // IntersectionObserver for infinite scroll
  const findScrollParent = useCallback((el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const { overflowY } = window.getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const root = findScrollParent(sentinel);
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current();
      },
      { root, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [findScrollParent, hubHasMore]);

  // Handle scroll for fallback infinite scroll
  const handleHubScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const { scrollTop, scrollHeight, clientHeight } = target;
      if (scrollHeight - scrollTop - clientHeight < 100) loadMoreHubAssistants();
    },
    [loadMoreHubAssistants]
  );

  const refreshAgentDetection = useCallback(async () => {
    try {
      if (isEnterprise) {
        // Enterprise mode: refresh local assistants from hub/tenant/custom/system directories
        await mutate('assistantHub.installed');
      } else {
        await ipcBridge.acpConversation.refreshCustomAgents.invoke();
        await mutate('acp.agents.available');
        await mutate('assistantHub.installed');
        emitter.emit('assistants.changed');
      }
    } catch {
      // ignore
    }
  }, [isEnterprise]);

  const loadAssistantContext = useCallback(
    async (assistantId: string): Promise<string> => {
      try {
        const content = await ipcBridge.fs.readAssistantRule.invoke({ assistantId, locale: localeKey });
        return content || '';
      } catch (error) {
        console.error(`Failed to load rule for ${assistantId}:`, error);
        return '';
      }
    },
    [localeKey]
  );

  const sortAssistants = useCallback((agents: AssistantListItem[]) => {
    const builtinOrder = ['builtin-copilot', 'builtin-sudoclaw-doctor'];
    return agents.sort((a, b) => {
      const indexA = builtinOrder.indexOf(a.id);
      const indexB = builtinOrder.indexOf(b.id);
      if (indexA !== -1 || indexB !== -1) {
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      }
      return 0;
    });
  }, []);

  const loadAssistants = useCallback(async () => {
    try {
      // Fetch raw IAssistantInfo[] and convert to AssistantListItem with _category preserved
      const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
      const localAgents: AssistantListItem[] = (result?.data ?? []).map((info) => ({
        ...toBackendConfig(info),
        _category: info.category,
        _isHubInstalled: info.isHubInstalled,
      }));

      const mergedAgents = [...localAgents];
      for (const extAssistant of normalizedExtensionAssistants) {
        if (!mergedAgents.some((agent) => agent.id === extAssistant.id)) {
          mergedAgents.push(extAssistant);
        }
      }

      const allowedBuiltinIds = new Set(['builtin-copilot', 'builtin-sudoclaw-doctor']);
      const filteredAgents = mergedAgents.filter((agent) => {
        // Builtin assistants: only show explicitly allowed ones
        if (agent.isBuiltin) return allowedBuiltinIds.has(agent.id);
        // All non-builtin assistants (custom, hub, extension) pass through
        return true;
      });

      const sortedAssistants = sortAssistants(filteredAgents);
      setAssistants(sortedAssistants);
      setActiveAssistantId((prev) => {
        if (prev && sortedAssistants.some((assistant) => assistant.id === prev)) return prev;
        return sortedAssistants[0]?.id || null;
      });
    } catch (error) {
      console.error('Failed to load assistant presets:', error);
    }
  }, [normalizedExtensionAssistants, sortAssistants]);

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  // Install Hub assistant (defined after loadAssistants since it depends on it)
  const handleInstallHubAssistant = useCallback(
    async (assistantId: string, selectedSkillIds: string[] = []) => {
      if (!isElectronDesktop()) {
        Message.warning(t('settings.assistant.desktopOnly', { defaultValue: '助手安装仅在桌面端可用' }));
        return;
      }

      const assistant = hubAssistantList.find((a) => a.id === assistantId);
      if (!assistant) return;

      // Check for valid download URL (some assistants like builtin ones don't have downloadable packages)
      const sourceUrl = assistant._sourceUrl;
      if (!sourceUrl) {
        Message.error(t('settings.assistant.noDownloadUrl', { defaultValue: '该助手暂不支持安装，请联系管理员' }));
        return;
      }

      setInstallingAssistantId(assistantId);
      setInstallProgress(0);

      try {
        // Use default version since API doesn't provide version info
        const version = '1.0.0';
        const res = await assistantHub.downloadAndInstallAssistant.invoke({
          assistantName: assistant.name,
          displayName: assistant.display_name || assistant.name,
          sourceUrl: sourceUrl,
          version: version,
          checksum: '',
          assistantMeta: assistant,
          selectedSkillIds,
        });

        if (res.success && res.data) {
          const installedSkillCount = res.data.installedSkills?.length || 0;
          const failedSkillCount = res.data.failedSkills?.length || 0;
          const displayName = assistant.display_name || assistant.name;

          if (failedSkillCount > 0) {
            Message.warning(
              t('settings.assistant.installPartial', {
                name: displayName,
                skillCount: installedSkillCount,
                failedCount: failedSkillCount,
                defaultValue: `${displayName} 安装成功，${installedSkillCount} 个技能安装成功，${failedSkillCount} 个技能安装失败`,
              })
            );
          } else {
            Message.success(
              t('settings.assistant.installSuccess', {
                name: displayName,
                skillCount: installedSkillCount,
                defaultValue: `成功安装 ${displayName}${installedSkillCount > 0 ? ` 及 ${installedSkillCount} 个关联技能` : ''}`,
              })
            );
          }
          await fetchInstalledAssistantNames();
          await loadAssistants();
          // Refresh agent detection so GuidPage's useGuidAgentSelection picks up the new assistant
          await refreshAgentDetection();
          // Keep modal open so user can directly click "Go Use" button
        } else {
          Message.error(t('settings.assistant.installFailed', { msg: res.msg || 'Unknown error', defaultValue: `安装失败: ${res.msg || '未知错误'}` }));
        }
      } catch (err) {
        console.error('Failed to install assistant:', err);
        Message.error(t('settings.assistant.installFailed', { msg: String(err), defaultValue: `安装失败: ${String(err)}` }));
      } finally {
        setInstallingAssistantId(null);
        setInstallProgress(0);
      }
    },
    [hubAssistantList, fetchInstalledAssistantNames, loadAssistants, refreshAgentDetection, t]
  );

  // Go use installed assistant (navigate to guid page with assistant pre-selected)
  const handleGoUseHubAssistant = useCallback(async () => {
    if (!hubDetailAssistant) return;
    setHubDetailVisible(false);

    // Use display_name for URL parameter to match customAgents.name in useGuidAgentSelection
    // hubDetailAssistant.name is the identifier (UUID), display_name is the user-facing name
    const assistantName = hubDetailAssistant.display_name || hubDetailAssistant.name;
    await refreshAgentDetection();
    void navigate(`/guid?assistant=${encodeURIComponent(assistantName)}`);
  }, [hubDetailAssistant, navigate, refreshAgentDetection]);

  // Open duplicate confirm modal for hub assistant
  const handleOpenDuplicateModal = useCallback((assistant: IAssistantHubSkill) => {
    setDuplicateAssistant(assistant);
    setDuplicateInstalledAssistant(null);
    setDuplicateTenantAssistant(null);
    setDuplicateConfirmVisible(true);
  }, []);

  // Open duplicate confirm modal for installed assistant
  const handleOpenDuplicateModalFromInstalled = useCallback((assistant: AssistantListItem) => {
    setDuplicateAssistant(null);
    setDuplicateInstalledAssistant(assistant);
    setDuplicateTenantAssistant(null);
    setDuplicateConfirmVisible(true);
  }, []);

  // Open duplicate confirm modal for tenant assistant (enterprise mode)
  const handleOpenDuplicateModalFromTenant = useCallback((assistant: { id: string; name: string; displayName?: string; description?: string; enabledSkills?: string[] }) => {
    setDuplicateAssistant(null);
    setDuplicateInstalledAssistant(null);
    setDuplicateTenantAssistant(assistant);
    setDuplicateConfirmVisible(true);
  }, []);

  // Open upload confirm modal for custom assistant
  const handleUploadAssistant = useCallback(
    (assistant: AssistantListItem) => {
      // Check tenantId - required for upload
      if (!enterpriseCode) {
        agentMessage.warning(t('settings.assistant.uploadNoTenantId', { defaultValue: '用户无租户ID，无法上传助手' }));
        return;
      }
      setUploadAssistant(assistant);
      setUploadConfirmVisible(true);
    },
    [enterpriseCode, t]
  );

  // Upload assistant to Hub
  const handleUploadConfirm = useCallback(async () => {
    if (!uploadAssistant) return;
    if (!isElectronDesktop()) {
      agentMessage.warning(t('settings.assistant.desktopOnly', { defaultValue: '助手上传仅在桌面端可用' }));
      return;
    }

    // Check tenantId again before upload
    if (!enterpriseCode) {
      agentMessage.warning(t('settings.assistant.uploadNoTenantId', { defaultValue: '用户无租户ID，无法上传助手' }));
      setUploadConfirmVisible(false);
      setUploadAssistant(null);
      return;
    }

    setUploading(true);
    try {
      const displayName = uploadAssistant.nameI18n?.[localeKey] || uploadAssistant.name;
      const description = uploadAssistant.descriptionI18n?.[localeKey] || uploadAssistant.description;

      // Upload to Hub with tenantId
      const result = await ipcBridge.assistantHub.uploadAssistantToHub.invoke({
        name: uploadAssistant.id,
        displayName,
        profession: displayName, // Use display name as profession
        description,
        categories: uploadAssistant._category ? [uploadAssistant._category] : undefined,
        skills: uploadAssistant.enabledSkills,
        tenantId: enterpriseCode,
      });

      if (result.success) {
        agentMessage.success(t('settings.assistant.uploadSuccess', { name: displayName, defaultValue: `助手 "${displayName}" 已上传成功` }));
        setUploadConfirmVisible(false);
        setUploadAssistant(null);
      } else {
        agentMessage.error(t('settings.assistant.uploadFailed', { msg: result.msg || 'Unknown error', defaultValue: `上传失败: ${result.msg || 'Unknown error'}` }));
      }
    } catch (err) {
      console.error('Failed to upload assistant:', err);
      agentMessage.error(t('settings.assistant.uploadFailed', { msg: String(err), defaultValue: `上传失败: ${String(err)}` }));
    } finally {
      setUploading(false);
    }
  }, [uploadAssistant, localeKey, enterpriseCode, t]);

  // ---- Enterprise mode: Upload custom assistant to Moss Server ----
  const handleUploadCustomAssistant = useCallback(
    async (assistant: AssistantListItem): Promise<{ success: boolean; msg?: string }> => {
      console.log('[handleUploadCustomAssistant] Starting upload for assistant:', assistant.id);
      if (!isElectronDesktop()) {
        console.log('[handleUploadCustomAssistant] Not desktop, returning');
        return { success: false, msg: 'Not desktop' };
      }

      // Use assistant name (display name) as assistantName, not UUID
      const assistantName = assistant.nameI18n?.[localeKey] || assistant.name;
      const displayName = assistantName;
      const description = assistant.descriptionI18n?.[localeKey] || assistant.description || '';
      const assistantId = assistant.id; // UUID for server reference

      setUploadingAssistantName(assistantName);
      try {
        console.log('[handleUploadCustomAssistant] Calling eeclaw.uploadCustomAssistant.invoke with:', { assistantName, assistantId, displayName, description });
        const res = await eeclaw.uploadCustomAssistant.invoke({
          assistantName,
          assistantId,
          displayName,
          description,
          enabledSkills: assistant.enabledSkills,
        });
        console.log('[handleUploadCustomAssistant] Upload response:', res);
        if (res.success && res.data) {
          agentMessage.success(
            t('settings.assistant.uploadSuccess', {
              name: displayName,
              defaultValue: `助手 "${displayName}" 已上传到服务器`,
            })
          );
          // Refresh installed list
          void loadAssistants();
          return { success: true };
        } else {
          return { success: false, msg: res.msg || 'Unknown error' };
        }
      } catch (err) {
        console.error('Failed to upload custom assistant:', err);
        return { success: false, msg: String(err) };
      } finally {
        setUploadingAssistantName(null);
      }
    },
    [localeKey, loadAssistants, t]
  );

  // ---- Enterprise mode: Publish assistant as tenant-exclusive ----
  const handlePublishTenantAssistant = useCallback(
    async (assistantId: string, assistantName: string) => {
      if (!isElectronDesktop()) return;

      setPublishingAssistantName(assistantName);
      try {
        const res = await eeclaw.publishTenantAssistant.invoke({ assistantId });
        if (res.success && res.data) {
          agentMessage.success(
            t('settings.assistant.publishSuccess', {
              name: assistantName,
              defaultValue: `助手 "${assistantName}" 已提交发布申请，等待管理员审批`,
            })
          );
          void loadAssistants();
        } else {
          agentMessage.error(
            t('settings.assistant.publishFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: `发布失败: ${res.msg || '未知错误'}`,
            })
          );
        }
      } catch (err) {
        console.error('Failed to publish tenant assistant:', err);
        agentMessage.error(
          t('settings.assistant.publishFailed', {
            msg: String(err),
            defaultValue: `发布失败: ${String(err)}`,
          })
        );
      } finally {
        setPublishingAssistantName(null);
      }
    },
    [loadAssistants, t]
  );

  // ---- Duplicate assistant to custom list ----
  const handleDuplicateConfirm = useCallback(async () => {
    if (!duplicateAssistant && !duplicateInstalledAssistant && !duplicateTenantAssistant) return;
    if (!isElectronDesktop()) {
      agentMessage.warning(t('settings.assistant.desktopOnly', { defaultValue: '助手复制仅在桌面端可用' }));
      return;
    }

    try {
      // Handle hub assistant duplication
      if (duplicateAssistant) {
        const baseName = duplicateAssistant.display_name || duplicateAssistant.name;
        const customName = t('settings.assistant.duplicatedName', { name: baseName, defaultValue: `自定义-${baseName}` });
        const customId = uuid(36); // Generate UUID for assistant ID

        // Read the assistant rule content if already installed
        let ruleContent: string | undefined = undefined;
        if (hubInstalledAssistantNames.has(duplicateAssistant.name)) {
          try {
            const content = await ipcBridge.fs.readAssistantRule.invoke({
              assistantId: duplicateAssistant.name,
              locale: localeKey,
            });
            if (content && content.trim()) {
              ruleContent = content;
            }
          } catch {
            // No rule content available
          }
        }

        // Create new custom assistant
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: customId,
            nameI18n: { 'zh-CN': customName },
            descriptionI18n: duplicateAssistant.description ? { 'zh-CN': duplicateAssistant.description } : undefined,
            avatar: duplicateAssistant.avatar || duplicateAssistant.emoji,
            presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: duplicateAssistant.skills || [],
            defaultInitPrompt: duplicateAssistant.defaultInitPrompt,
          },
          ruleContent: ruleContent,
        });

        // Enterprise mode: upload to Moss Server
        if (isEnterprise) {
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === customId || a.name === customId);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              await handleUploadCustomAssistant(newAssistant);
            }
          }
        }

        agentMessage.success(t('settings.assistant.duplicateSuccess', { name: customName, defaultValue: `已复制到自定义列表: ${customName}` }));
      }

      // Handle installed assistant duplication
      if (duplicateInstalledAssistant) {
        const baseName = duplicateInstalledAssistant.nameI18n?.[localeKey] || duplicateInstalledAssistant.name;
        const customName = t('settings.assistant.duplicatedName', { name: baseName, defaultValue: `自定义-${baseName}` });
        const customId = uuid(36); // Generate UUID for assistant ID

        // Read the assistant rule content
        let ruleContent: string | undefined = undefined;
        try {
          const content = await ipcBridge.fs.readAssistantRule.invoke({
            assistantId: duplicateInstalledAssistant.id,
            locale: localeKey,
          });
          if (content && content.trim()) {
            ruleContent = content;
          }
        } catch {
          // No rule content available
        }

        // Create new custom assistant
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: customId,
            nameI18n: { 'zh-CN': customName },
            descriptionI18n: duplicateInstalledAssistant.descriptionI18n || (duplicateInstalledAssistant.description ? { 'zh-CN': duplicateInstalledAssistant.description } : undefined),
            avatar: duplicateInstalledAssistant.avatar,
            presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: duplicateInstalledAssistant.enabledSkills || [],
            defaultInitPrompt: duplicateInstalledAssistant.defaultInitPrompt,
          },
          ruleContent: ruleContent,
        });

        // Enterprise mode: upload to Moss Server
        if (isEnterprise) {
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === customId || a.name === customId);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              await handleUploadCustomAssistant(newAssistant);
            }
          }
        }

        agentMessage.success(t('settings.assistant.duplicateSuccess', { name: customName, defaultValue: `已复制到自定义列表: ${customName}` }));
      }

      // Handle tenant assistant duplication (enterprise mode)
      if (duplicateTenantAssistant) {
        const baseName = duplicateTenantAssistant.displayName || duplicateTenantAssistant.name;
        const customName = t('settings.assistant.duplicatedName', { name: baseName, defaultValue: `自定义-${baseName}` });
        const customId = uuid(36); // Generate UUID for assistant ID

        // Read the assistant rule content (tenant assistants are synced to local tenant/ directory)
        let ruleContent: string | undefined = undefined;
        try {
          const content = await ipcBridge.fs.readAssistantRule.invoke({
            assistantId: duplicateTenantAssistant.name,
            locale: localeKey,
          });
          if (content && content.trim()) {
            ruleContent = content;
          }
        } catch {
          // No rule content available
        }

        // Create new custom assistant
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: customId,
            nameI18n: { 'zh-CN': customName },
            descriptionI18n: duplicateTenantAssistant.description ? { 'zh-CN': duplicateTenantAssistant.description } : undefined,
            presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: duplicateTenantAssistant.enabledSkills || [],
          },
          ruleContent: ruleContent,
        });

        // Enterprise mode: upload to Moss Server
        if (isEnterprise) {
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === customId || a.name === customId);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              await handleUploadCustomAssistant(newAssistant);
            }
          }
        }

        agentMessage.success(t('settings.assistant.duplicateSuccess', { name: customName, defaultValue: `已复制到自定义列表: ${customName}` }));
      }

      await loadAssistants();
      setDuplicateConfirmVisible(false);
      setDuplicateAssistant(null);
      setDuplicateInstalledAssistant(null);
      setDuplicateTenantAssistant(null);
    } catch (err) {
      console.error('Failed to duplicate assistant:', err);
      agentMessage.error(t('settings.assistant.duplicateFailed', { defaultValue: '复制失败' }));
    }
  }, [duplicateAssistant, duplicateInstalledAssistant, duplicateTenantAssistant, hubInstalledAssistantNames, localeKey, loadAssistants, t, isEnterprise, handleUploadCustomAssistant]);

  // ---- Enterprise mode: Install tenant assistant ----
  const handleInstallTenantAssistant = useCallback(
    async (assistantId: string, assistantName: string) => {
      if (!isElectronDesktop()) return;

      setInstallingTenantAssistantId(assistantId);
      try {
        const res = await eeclaw.installTenantAssistant.invoke({ assistantId });
        if (res.success && res.data) {
          agentMessage.success(
            t('settings.assistant.installTenantSuccess', {
              name: assistantName,
              defaultValue: `专属助手 "${assistantName}" 已安装`,
            })
          );
          // Update tenant assistants list to mark as installed
          setTenantAssistants((prev) => prev.map((a) => (a.id === assistantId ? { ...a, installed: true } : a)));
          void loadAssistants();
        } else {
          agentMessage.error(
            t('settings.assistant.installTenantFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: `安装失败: ${res.msg || '未知错误'}`,
            })
          );
        }
      } catch (err) {
        console.error('Failed to install tenant assistant:', err);
        agentMessage.error(
          t('settings.assistant.installTenantFailed', {
            msg: String(err),
            defaultValue: `安装失败: ${String(err)}`,
          })
        );
      } finally {
        setInstallingTenantAssistantId(null);
      }
    },
    [loadAssistants, t]
  );

  const activeAssistant = assistants.find((assistant) => assistant.id === activeAssistantId) || null;
  // Only custom assistants can be edited; hub-installed, builtin, and extension assistants are readonly
  const isReadonlyAssistant = Boolean(activeAssistant && (isExtensionAssistant(activeAssistant) || activeAssistant._isHubInstalled || activeAssistant.isBuiltin));

  // ===== 分类逻辑：以目录分类（_category）为主，其他字段仅作兼容兜底 =====
  // Tenant assistants: 目录分类为 tenant
  const localTenantAssistants = assistants.filter((a) => a._category === 'tenant');
  // Filter tenant assistants by search query
  const filteredTenantAssistants = hubSearchQuery.trim()
    ? localTenantAssistants.filter((a) => {
        const displayName = a.nameI18n?.[localeKey] || a.name;
        const description = a.descriptionI18n?.[localeKey] || a.description || '';
        const query = hubSearchQuery.trim().toLowerCase();
        return displayName.toLowerCase().includes(query) || description.toLowerCase().includes(query);
      })
    : localTenantAssistants;
  // Hub assistants: 目录分类为 hub（_isHubInstalled 仅作兼容兜底）
  const hubAssistants = assistants.filter((a) => a._category === 'hub' || (!a._category && !a.isBuiltin && a._isHubInstalled));
  // Builtin assistants: 目录分类为 system 或 isBuiltin 为 true
  const builtinAssistants = assistants.filter((a) => a._category === 'system' || a.isBuiltin || isExtensionAssistant(a));
  // Custom assistants: 目录分类为 custom（其他字段仅作兼容兜底）
  const customAssistants = assistants.filter((a) => a._category === 'custom' || (!a._category && !a.isBuiltin && !a._isHubInstalled && !isExtensionAssistant(a)));

  // Avatar helpers
  const isEmoji = useCallback((str: string) => {
    if (!str) return false;
    const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
    return emojiRegex.test(str);
  }, []);

  const resolveAvatarImageSrc = useCallback(
    (avatar: string | undefined): string | undefined => {
      const value = avatar?.trim();
      if (!value) return undefined;
      const mapped = avatarImageMap[value];
      if (mapped) return mapped;
      const resolved = resolveExtensionAssetUrl(value) || value;
      const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
      return isImage ? resolved : undefined;
    },
    [avatarImageMap]
  );

  // ==================== CRUD Handlers ====================

  const handleEdit = async (assistant: AssistantListItem) => {
    setIsCreating(false);
    setActiveAssistantId(assistant.id);
    setEditName(assistant.nameI18n?.[localeKey] || assistant.name || '');
    setEditDescription(assistant.descriptionI18n?.[localeKey] || assistant.description || '');
    setEditAvatar(assistant.avatar || '');
    setEditAgent(normalizePresetAgentType(assistant.presetAgentType) || DEFAULT_PRESET_AGENT_TYPE);
    setEditVisible(true);

    if (isExtensionAssistant(assistant)) {
      setPromptViewMode('preview');
      setEditContext(assistant.context || '');
      setInstalledSkills([]);
      setSelectedSkills(Array.isArray(assistant.enabledSkills) ? assistant.enabledSkills : []);
      return;
    }

    try {
      const context = await loadAssistantContext(assistant.id);
      setEditContext(context);
      const availableSkills = await loadInstalledSkills();
      setSelectedSkills(sanitizeAssistantEnabledSkills(assistant.enabledSkills, availableSkills));
    } catch (error) {
      console.error('Failed to load assistant content:', error);
      setEditContext('');
      setInstalledSkills([]);
      setSelectedSkills([]);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setActiveAssistantId(null);
    setEditName('');
    setEditDescription('');
    setEditContext('');
    setEditAvatar('🤖');
    setEditAgent(DEFAULT_PRESET_AGENT_TYPE);
    setSelectedSkills([]);
    setPromptViewMode('edit');
    setEditVisible(true);
    await loadInstalledSkills();
  };

  const handleSave = async () => {
    try {
      // Block saving for readonly assistants (hub, builtin, extension)
      if (!isCreating && isReadonlyAssistant) {
        agentMessage.warning(t('settings.assistantReadonly', { defaultValue: 'Hub 安装的助手和内置助手不可修改，可复制到自定义列表后编辑' }));
        return;
      }

      if (isCreating) {
        if (!editName.trim()) {
          agentMessage.error(t('settings.assistantNameRequired', { defaultValue: 'Assistant name is required' }));
          return;
        }
        const newId = uuid(36); // Generate UUID for assistant ID
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: newId,
            nameI18n: { 'zh-CN': editName },
            descriptionI18n: editDescription ? { 'zh-CN': editDescription } : undefined,
            avatar: editAvatar,
            presetAgentType: normalizePresetAgentType(editAgent) || DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: sanitizeAssistantEnabledSkills(selectedSkills, installedSkills),
          },
          ruleContent: editContext.trim() || undefined,
        });
        setActiveAssistantId(newId);
        await loadAssistants();

        // Enterprise mode: sync upload to Moss Server after create
        console.log('[AgentModalContent] isEnterprise:', isEnterprise);
        if (isEnterprise) {
          console.log('[AgentModalContent] Enterprise mode: starting sync upload to Moss Server');
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === newId || a.name === newId);
            console.log('[AgentModalContent] newAssistantInfo:', newAssistantInfo);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              console.log('[AgentModalContent] Calling handleUploadCustomAssistant');
              const uploadRes = await handleUploadCustomAssistant(newAssistant);
              console.log('[AgentModalContent] uploadRes:', uploadRes);
              if (uploadRes.success) {
                agentMessage.success(t('common.createSuccess', { defaultValue: 'Created successfully' }));
              } else {
                agentMessage.error(t('settings.assistant.uploadFailed', { msg: uploadRes.msg, defaultValue: `上传失败: ${uploadRes.msg}` }));
              }
            } else {
              agentMessage.success(t('common.createSuccess', { defaultValue: 'Created successfully' }));
            }
          } else {
            agentMessage.success(t('common.createSuccess', { defaultValue: 'Created successfully' }));
          }
        } else {
          agentMessage.success(t('common.createSuccess', { defaultValue: 'Created successfully' }));
        }
      } else {
        if (!activeAssistant) return;
        const lookupName = resolveAssistantName(activeAssistant.id);

        // For custom assistants, save all fields (presetAgentType stays locked to Sudo Code)
        await ipcBridge.assistantHub.updateAssistantMeta.invoke({
          name: lookupName,
          updates: {
            nameI18n: { 'zh-CN': editName },
            descriptionI18n: editDescription ? { 'zh-CN': editDescription } : undefined,
            avatar: editAvatar,
            presetAgentType: normalizePresetAgentType(editAgent) || DEFAULT_PRESET_AGENT_TYPE,
            enabledSkills: sanitizeAssistantEnabledSkills(selectedSkills, installedSkills),
          },
        });

        if (editContext.trim()) {
          await ipcBridge.fs.writeAssistantRule.invoke({
            assistantId: activeAssistant.id,
            locale: localeKey,
            content: editContext,
          });
        }

        await loadAssistants();
        agentMessage.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
      }

      setEditVisible(false);
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to save assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const handleDeleteClick = () => {
    if (!activeAssistant) return;
    if (activeAssistant.isBuiltin) {
      agentMessage.warning(t('settings.cannotDeleteBuiltin', { defaultValue: 'Cannot delete builtin assistants' }));
      return;
    }
    if (isExtensionAssistant(activeAssistant)) {
      agentMessage.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
      return;
    }
    setDeleteConfirmVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!activeAssistant) return;
    try {
      const lookupName = resolveAssistantName(activeAssistant.id);
      // Pass category for precise assistant location
      const assistantCategory = activeAssistant._category as 'custom' | 'hub' | 'system' | 'tenant' | undefined;
      await ipcBridge.assistantHub.uninstallAssistant.invoke({ name: lookupName, category: assistantCategory });
      await loadAssistants();
      setDeleteConfirmVisible(false);
      setEditVisible(false);
      agentMessage.success(t('common.success', { defaultValue: 'Success' }));
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const handleDeleteFromCard = async (assistant: AssistantListItem) => {
    try {
      const lookupName = resolveAssistantName(assistant.id);
      // Pass category for precise assistant location
      const assistantCategory = assistant._category as 'custom' | 'hub' | 'system' | 'tenant' | undefined;
      await ipcBridge.assistantHub.uninstallAssistant.invoke({ name: lookupName, category: assistantCategory });
      await loadAssistants();
      agentMessage.success(t('common.success', { defaultValue: 'Success' }));
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  const handleToggleEnabled = async (assistant: AssistantListItem, enabled: boolean) => {
    if (isExtensionAssistant(assistant)) {
      agentMessage.warning(t('settings.extensionAssistantReadonly', { defaultValue: 'Extension assistants are read-only. You can duplicate it and edit the copy.' }));
      return;
    }
    try {
      const lookupName = resolveAssistantName(assistant.id);
      // Pass category for precise assistant location
      const assistantCategory = assistant._category as 'custom' | 'hub' | 'system' | 'tenant' | undefined;
      if (enabled) {
        await ipcBridge.assistantHub.enableAssistant.invoke({ name: lookupName, category: assistantCategory });
      } else {
        await ipcBridge.assistantHub.disableAssistant.invoke({ name: lookupName, category: assistantCategory });
      }
      await loadAssistants();
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to toggle assistant:', error);
      agentMessage.error(t('common.failed', { defaultValue: 'Failed' }));
    }
  };

  // ==================== Render helpers ====================

  const editAvatarImage = resolveAvatarImageSrc(editAvatar);

  const renderAssistantGrid = (list: AssistantListItem[], hideDelete = false) => (
    <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {list.map((assistant) => (
        <InstalledAssistantCard key={assistant.id} assistant={assistant} isExtension={isExtensionAssistant(assistant)} localeKey={localeKey} avatarImageMap={avatarImageMap} onToggleEnabled={(enabled) => void handleToggleEnabled(assistant, enabled)} onDelete={() => void handleDeleteFromCard(assistant)} onDuplicate={() => handleOpenDuplicateModalFromInstalled(assistant)} onUpload={!assistant.isBuiltin && !assistant._isHubInstalled && !isExtensionAssistant(assistant) ? () => handleUploadAssistant(assistant) : undefined} onClick={() => void handleEdit(assistant)} hideDelete={hideDelete} />
      ))}
    </div>
  );

  // Render custom assistants with enterprise action buttons (publish only, auto-upload on create)
  const renderCustomAssistantGridWithEnterpriseActions = (list: AssistantListItem[]) => (
    <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {list.map((assistant) => {
        const assistantId = assistant.id;
        const isPublishing = publishingAssistantName === assistantId;
        const publishStatus = (assistant as any).publish_status;

        // Enterprise publish button element - placed below delete button
        const enterprisePublishButton =
          isEnterprise && !publishStatus ? (
            <Tooltip content={t('settings.assistant.publishAsTenant', { defaultValue: '发布为专属助手' })}>
              <button
                className='w-20px h-20px rd-4px flex items-center justify-center bg-fill-2 hover:bg-primary hover:text-white transition-colors cursor-pointer border-none'
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePublishTenantAssistant(assistantId, assistant.name);
                }}
                disabled={isPublishing}
              >
                {isPublishing ? <Spin size={12} /> : <Share size={12} />}
              </button>
            </Tooltip>
          ) : isEnterprise && publishStatus === 'pending' ? (
            <Tooltip content={t('settings.assistant.publishPending', { defaultValue: '发布审批中' })}>
              <span className='w-20px h-20px rd-4px flex items-center justify-center bg-warning text-white text-10px'>⏳</span>
            </Tooltip>
          ) : isEnterprise && publishStatus === 'approved' ? (
            <Tooltip content={t('settings.assistant.publishApproved', { defaultValue: '已发布为专属助手' })}>
              <span className='w-20px h-20px rd-4px flex items-center justify-center bg-success text-white text-10px'>✓</span>
            </Tooltip>
          ) : undefined;

        return <InstalledAssistantCard key={assistantId} assistant={assistant} isExtension={isExtensionAssistant(assistant)} localeKey={localeKey} avatarImageMap={avatarImageMap} onToggleEnabled={(enabled) => void handleToggleEnabled(assistant, enabled)} onDelete={() => void handleDeleteFromCard(assistant)} onDuplicate={() => handleOpenDuplicateModalFromInstalled(assistant)} onClick={() => void handleEdit(assistant)} enterprisePublishButton={enterprisePublishButton} />;
      })}
    </div>
  );

  // ==================== Main render ====================

  return (
    <div className='flex flex-col h-full w-full'>
      {agentMessageContext}

      {/* Header: tabs + search + create button */}
      <div className='flex items-center gap-12px mb-12px'>
        {/* Tab switcher */}
        <div className='flex items-center bg-fill-2 rd-8px p-2px gap-1px flex-shrink-0'>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'store' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('store')}>
            {t('settings.assistant.storeTab', { defaultValue: '助手库' })}
          </button>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'exclusive' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('exclusive')}>
            {t('settings.assistant.exclusiveTab', { defaultValue: '专属助手' })}
          </button>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'installed' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('installed')}>
            {t('settings.assistant.installedTab', { defaultValue: '我的助手' })}
            {assistants.length > 0 && <span className='ml-5px px-5px py-0px bg-primary text-white text-10px rd-full leading-16px'>{assistants.length}</span>}
          </button>
        </div>

        {/* Sync status indicator for enterprise mode - compact inline style */}
        {isEnterprise && activeTab === 'store' && syncStatus.syncing && (
          <div className='flex items-center gap-6px px-10px py-4px bg-primary-light-1 rd-6px flex-shrink-0'>
            <Spin size={12} />
            <span className='text-11px text-primary'>{t('settings.assistant.syncing', { defaultValue: '同步中...' })}</span>
          </div>
        )}
        {isEnterprise && activeTab === 'store' && !syncStatus.syncing && (syncStatus.assistants.installed.length > 0 || syncStatus.assistants.skipped.length > 0 || syncStatus.assistants.failed.length > 0) && (
          <div className='flex items-center gap-6px px-10px py-4px bg-success-light rd-6px flex-shrink-0'>
            <Check size={12} className='text-success' />
            <span className='text-11px text-success'>{t('settings.assistant.syncCompleted', { defaultValue: '已同步' })}</span>
          </div>
        )}

        {/* Search - for store/exclusive tabs */}
        <div className={classNames('flex-1 min-w-0 transition-opacity duration-150', activeTab === 'installed' ? 'opacity-0 pointer-events-none' : '')}>
          <Input placeholder={t('settings.assistant.searchPlaceholder', { defaultValue: '搜索...' })} value={hubSearchQuery} onChange={setHubSearchQuery} prefix={<Search size='14' className='text-t-tertiary' />} size='small' className='assistant-hub-input' />
        </div>

        {/* Create button — only on installed tab */}
        {activeTab === 'installed' && (
          <button type='button' className='group h-34px px-4 py-0 border border-solid rd-999px flex items-center gap-8px flex-shrink-0 cursor-pointer transition-all outline-none bg-[color-mix(in_srgb,var(--color-fill-2)_84%,transparent)] border-[color-mix(in_srgb,var(--color-border-2)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary-light-1)_58%,transparent)] hover:border-[color-mix(in_srgb,var(--color-primary)_36%,transparent)]' onClick={() => void handleCreate()}>
            <span className='w-22px h-22px rd-full flex items-center justify-center bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-primary)] transition-transform group-hover:scale-105'>
              <Plus size='13' />
            </span>
            <span className='flex items-baseline gap-5px leading-none'>
              <span className='text-12px font-medium text-t-primary'>{t('settings.createAssistant', { defaultValue: '创建' })}</span>
              <span className='text-11px text-t-secondary'>{t('settings.customAssistants', { defaultValue: '自定义助手' })}</span>
            </span>
          </button>
        )}
      </div>

      {/* ===== STORE TAB ===== */}
      {(activeTab === 'store' || activeTab === 'exclusive') && (
        <>
          {/* Category filter */}
          <div className='flex gap-6px mb-14px overflow-x-auto pb-2px flex-shrink-0 scrollbar-hide'>
            {[{ key: 'all', label: t('settings.assistant.allCategories', { defaultValue: '全部分类' }) }, ...hubCategories.map((c) => ({ key: c, label: c }))].map(({ key, label }) => (
              <span key={key} className={classNames('px-12px py-4px rd-16px text-12px cursor-pointer transition-colors whitespace-nowrap flex-shrink-0', selectedHubCategory === key ? 'bg-primary text-white' : 'bg-fill-2 text-t-secondary hover:bg-fill-3 hover:text-t-primary')} onClick={() => setSelectedHubCategory(key)}>
                {label}
              </span>
            ))}
          </div>

          {/* Assistant grid */}
          <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode} onScroll={handleHubScroll}>
            {/* Enterprise mode: show tenant assistants from local tenant/ directory */}
            {activeTab === 'exclusive' && isEnterprise ? (
              hubLoading ? (
                <div className='flex justify-center items-center py-48px'>
                  <Spin size={28} />
                </div>
              ) : hubAssistantList.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-48px text-t-secondary gap-8px'>
                  <Shield size='32' className='text-t-tertiary' />
                  <span className='text-13px'>{t('settings.assistant.noTenantAssistants', { defaultValue: '暂无专属助手' })}</span>
                </div>
              ) : (
                <div className='grid gap-8px pb-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {hubAssistantList.map((assistant) => {
                    return (
                      <HubAssistantCard
                        key={assistant.id}
                        assistant={assistant}
                        isInstalled={true}
                        installing={false}
                        installProgress={installProgress}
                        onInstall={(e) => {
                          e.stopPropagation();
                          setHubDetailAssistant(assistant);
                          setHubDetailVisible(true);
                        }}
                        onDuplicate={(e) => {
                          e.stopPropagation();
                          handleOpenDuplicateModal(assistant);
                        }}
                        onClick={() => {
                          setHubDetailAssistant(assistant);
                          setHubDetailVisible(true);
                        }}
                      />
                    );
                  })}
                </div>
              )
            ) : activeTab === 'exclusive' && !enterpriseCode ? (
              <div className='flex flex-col items-center justify-center py-48px text-t-secondary gap-8px'>
                <Shield size='32' className='text-t-tertiary' />
                <span className='text-13px'>{t('settings.assistant.noEnterpriseCode', { defaultValue: '当前账号没有企业编码，无法加载专属助手。' })}</span>
              </div>
            ) : hubLoading || !hubInstalledSkillsReady ? (
              <div className='flex justify-center items-center py-48px'>
                <Spin size={28} />
              </div>
            ) : hubAssistantList.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-48px text-t-secondary gap-8px'>
                <Robot theme='outline' size={32} className='text-t-tertiary' />
                <span className='text-13px'>{t('settings.assistant.noResults', { defaultValue: '暂无助手' })}</span>
              </div>
            ) : (
              <div className='grid gap-8px pb-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                {hubAssistantList.map((assistant) => {
                  const isInstalled = hubInstalledAssistantNames.has(assistant.name);
                  const isInstalling = installingAssistantId === assistant.id;
                  return (
                    <HubAssistantCard
                      key={assistant.id}
                      assistant={assistant}
                      isInstalled={isInstalled}
                      installing={isInstalling}
                      installProgress={installProgress}
                      onInstall={(e) => {
                        e.stopPropagation();
                        // Open detail modal for install options
                        setHubDetailAssistant(assistant);
                        setHubDetailVisible(true);
                      }}
                      onDuplicate={(e) => {
                        e.stopPropagation();
                        handleOpenDuplicateModal(assistant);
                      }}
                      onClick={() => {
                        setHubDetailAssistant(assistant);
                        setHubDetailVisible(true);
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Loading skeleton cards */}
            {hubLoadingMore && (
              <div className='grid gap-8px pb-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={`skel-${i}`} className='bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px animate-pulse'>
                    <div className='w-48px h-48px flex-shrink-0 rd-8px bg-fill-3' />
                    <div className='flex-1 min-w-0 flex flex-col gap-6px pt-2px'>
                      <div className='h-14px w-3/5 rd-4px bg-fill-3' />
                      <div className='h-10px w-full rd-4px bg-fill-3' />
                      <div className='h-10px w-4/5 rd-4px bg-fill-3' />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Sentinel for IntersectionObserver */}
            {hubHasMore && <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />}
          </AionScrollArea>
        </>
      )}

      {/* ===== INSTALLED TAB ===== */}
      {activeTab === 'installed' && (
        <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
          {assistants.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-48px gap-8px'>
              <Robot theme='outline' size={32} className='text-t-tertiary' />
              <div className='text-13px text-t-secondary'>{t('settings.assistantsEmpty', { defaultValue: '暂无助手' })}</div>
              <div className='text-12px text-t-tertiary'>{t('settings.assistantsEmptyHint', { defaultValue: '点击下方"创建助手"按钮添加你的助手' })}</div>
              <Button size='small' type='outline' className='mt-4px' onClick={() => handleCreate()}>
                {t('settings.createAssistant', { defaultValue: '创建助手' })}
              </Button>
            </div>
          ) : (
            <div className='pb-16px space-y-20px'>
              {/* Custom assistants section */}
              <section>
                <div className='flex items-center justify-between gap-8px mb-10px'>
                  <div className='text-13px font-medium text-t-primary'>{t('settings.customAssistants', { defaultValue: '自定义助手' })}</div>
                  <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{customAssistants.length}</span>
                </div>
                {customAssistants.length > 0 ? isEnterprise ? renderCustomAssistantGridWithEnterpriseActions(customAssistants) : renderAssistantGrid(customAssistants) : <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noCustomAssistants', { defaultValue: '暂无自定义助手' })}</div>}
              </section>

              {/* Tenant assistants section - enterprise mode only */}
              {isEnterprise && (
                <section>
                  <div className='flex items-center justify-between gap-8px mb-10px'>
                    <div className='text-13px font-medium text-t-primary'>{t('settings.tenantAssistants', { defaultValue: '专属助手' })}</div>
                    <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{filteredTenantAssistants.length}</span>
                  </div>
                  {filteredTenantAssistants.length > 0 ? renderAssistantGrid(filteredTenantAssistants, true) : <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noTenantAssistants', { defaultValue: '暂无专属助手' })}</div>}
                </section>
              )}

              {/* Hub/store assistants section */}
              <section>
                <div className='flex items-center justify-between gap-8px mb-10px'>
                  <div className='text-13px font-medium text-t-primary'>{t('settings.hubAssistants', { defaultValue: '商店助手' })}</div>
                  <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{hubAssistants.length}</span>
                </div>
                {hubAssistants.length > 0 ? renderAssistantGrid(hubAssistants, isEnterprise) : <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noHubAssistants', { defaultValue: '暂无商店助手' })}</div>}
              </section>

              {/* Builtin assistants section - Hidden: temporarily disabled */}
              {/* <section>
                <div className='flex items-center justify-between gap-8px mb-10px'>
                  <div className='text-13px font-medium text-t-primary'>{t('settings.builtinAssistants', { defaultValue: '内置助手' })}</div>
                  <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{builtinAssistants.length}</span>
                </div>
                {builtinAssistants.length > 0 ? renderAssistantGrid(builtinAssistants) : <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noBuiltinAssistants', { defaultValue: '暂无内置助手' })}</div>}
              </section> */}
            </div>
          )}
        </AionScrollArea>
      )}

      {/* ==================== Edit Drawer ==================== */}
      <Drawer
        title={
          <>
            <span>{isCreating ? t('settings.createAssistant', { defaultValue: 'Create Assistant' }) : t('settings.editAssistant', { defaultValue: 'Assistant Details' })}</span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setEditVisible(false);
              }}
              className='absolute right-4 top-2 cursor-pointer text-t-secondary hover:text-t-primary transition-colors p-1'
              style={{ zIndex: 10, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Close size={18} />
            </div>
          </>
        }
        closable={false}
        visible={editVisible}
        placement='right'
        width={drawerWidth}
        zIndex={1200}
        autoFocus={false}
        onCancel={() => {
          setEditVisible(false);
        }}
        headerStyle={{ background: 'var(--color-bg-1)' }}
        bodyStyle={{ background: 'var(--color-bg-1)' }}
        footer={
          <div className='flex items-center gap-8px'>
            <Button type='primary' onClick={handleSave} disabled={!isCreating && isReadonlyAssistant} className='w-[100px] rounded-[100px]'>
              {isCreating ? t('common.create', { defaultValue: 'Create' }) : t('common.save', { defaultValue: 'Save' })}
            </Button>
            <Button
              onClick={() => {
                setEditVisible(false);
              }}
              className='w-[100px] rounded-[100px] bg-fill-2'
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        }
      >
        <div className='flex flex-col h-full overflow-hidden'>
          <div className='flex flex-col flex-1 gap-16px bg-fill-2 rounded-16px p-20px overflow-y-auto'>
            {/* Name & Avatar */}
            <div className='flex-shrink-0'>
              <Typography.Text bold>
                <span className='text-red-500'>*</span> {t('settings.assistantNameAvatar', { defaultValue: 'Name & Avatar' })}
              </Typography.Text>
              <div className='mt-10px flex items-center gap-12px'>
                {activeAssistant?.isBuiltin || isReadonlyAssistant ? (
                  <Avatar shape='square' size={40} className='bg-bg-1 rounded-4px'>
                    {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Robot theme='outline' size={20} />}
                  </Avatar>
                ) : (
                  <EmojiPicker value={editAvatar} onChange={(emoji) => setEditAvatar(emoji)} placement='br'>
                    <div className='cursor-pointer'>
                      <Avatar shape='square' size={40} className='bg-bg-1 rounded-4px hover:bg-fill-2 transition-colors'>
                        {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Robot theme='outline' size={20} />}
                      </Avatar>
                    </div>
                  </EmojiPicker>
                )}
                <Input value={editName} onChange={(value) => setEditName(value)} disabled={activeAssistant?.isBuiltin || isReadonlyAssistant} placeholder={t('settings.agentNamePlaceholder', { defaultValue: 'Enter a name for this agent' })} className='flex-1 rounded-4px bg-bg-1' />
              </div>
            </div>

            {/* Description */}
            <div className='flex-shrink-0'>
              <Typography.Text bold>{t('settings.assistantDescription', { defaultValue: 'Assistant Description' })}</Typography.Text>
              <Input className='mt-10px rounded-4px bg-bg-1' value={editDescription} onChange={(value) => setEditDescription(value)} disabled={activeAssistant?.isBuiltin || isReadonlyAssistant} placeholder={t('settings.assistantDescriptionPlaceholder', { defaultValue: 'What can this assistant help with?' })} />
            </div>

            {/* Main Agent - locked to Sudo Code */}
            <div className='flex-shrink-0'>
              <Typography.Text bold>{t('settings.assistantMainAgent', { defaultValue: 'Main Agent' })}</Typography.Text>
              <Select className='mt-10px w-full rounded-4px' value={DEFAULT_PRESET_AGENT_TYPE} disabled>
                <Select.Option key='scode' value='scode'>
                  Sudo Code
                </Select.Option>
              </Select>
            </div>

            {/* Rules */}
            <div className='flex-shrink-0'>
              <Typography.Text bold className='flex-shrink-0'>
                {t('settings.assistantRules', { defaultValue: 'Rules' })}
              </Typography.Text>
              <div className='mt-10px border border-border-2 overflow-hidden rounded-4px' style={{ height: '300px' }}>
                {!activeAssistant?.isBuiltin && !isReadonlyAssistant && (
                  <div className='flex items-center h-36px bg-fill-2 border-b border-border-2 flex-shrink-0'>
                    <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'edit' ? 'text-primary border-b-2 border-primary bg-bg-1' : 'text-t-secondary hover:text-t-primary'}`} onClick={() => setPromptViewMode('edit')}>
                      {t('settings.promptEdit', { defaultValue: 'Edit' })}
                    </div>
                    <div className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'preview' ? 'text-primary border-b-2 border-primary bg-bg-1' : 'text-t-secondary hover:text-t-primary'}`} onClick={() => setPromptViewMode('preview')}>
                      {t('settings.promptPreview', { defaultValue: 'Preview' })}
                    </div>
                  </div>
                )}
                <div className='bg-fill-2' style={{ height: activeAssistant?.isBuiltin || isReadonlyAssistant ? '100%' : 'calc(100% - 36px)', overflow: 'auto' }}>
                  {promptViewMode === 'edit' && !activeAssistant?.isBuiltin && !isReadonlyAssistant ? (
                    <div ref={textareaWrapperRef} className='h-full'>
                      <Input.TextArea value={editContext} onChange={(value) => setEditContext(value)} placeholder={t('settings.assistantRulesPlaceholder', { defaultValue: 'Enter rules in Markdown format...' })} autoSize={false} className='border-none rounded-none bg-transparent h-full resize-none' />
                    </div>
                  ) : (
                    <div className='p-16px'>{editContext ? <MarkdownView hiddenCodeCopyButton>{editContext}</MarkdownView> : <div className='text-t-secondary text-center py-32px'>{t('settings.promptPreviewEmpty', { defaultValue: 'No content to preview' })}</div>}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Skills selection */}
            <div className='flex-shrink-0 mt-16px'>
              <div className='flex items-center justify-between mb-12px'>
                <Typography.Text bold>{t('settings.assistantSkills', { defaultValue: 'Skills' })}</Typography.Text>
              </div>
              <Collapse defaultActiveKey={['custom-skills']}>
                <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.customSkills', { defaultValue: 'Custom Skills' })}</span>} name='custom-skills' className='mb-8px' extra={<span className='text-12px text-t-secondary'>{customSelectableSkills.length}</span>}>
                  <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {customSelectableSkills.map((skill) => (
                      <SkillCard
                        key={skill.name}
                        skill={skill}
                        checked={selectedSkills.includes(skill.meta?.id || skill.name)}
                        onToggle={() => {
                          const skillId = skill.meta?.id || skill.name;
                          if (isReadonlyAssistant) return;
                          if (selectedSkills.includes(skillId)) {
                            setSelectedSkills(selectedSkills.filter((s) => s !== skillId));
                          } else {
                            setSelectedSkills([...selectedSkills, skillId]);
                          }
                        }}
                        disabled={isReadonlyAssistant}
                      />
                    ))}
                    {customSelectableSkills.length === 0 && <div className='text-center text-t-secondary text-12px py-16px col-span-full'>{t('settings.noCustomSkills', { defaultValue: 'No custom skills available' })}</div>}
                  </div>
                </Collapse.Item>
                <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.builtinSkills', { defaultValue: 'Builtin Skills' })}</span>} name='builtin-skills' extra={<span className='text-12px text-t-secondary'>{builtinSelectableSkills.length}</span>}>
                  <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {builtinSelectableSkills.map((skill) => (
                      <SkillCard
                        key={skill.name}
                        skill={skill}
                        checked={selectedSkills.includes(skill.meta?.id || skill.name)}
                        onToggle={() => {
                          const skillId = skill.meta?.id || skill.name;
                          if (isReadonlyAssistant) return;
                          if (selectedSkills.includes(skillId)) {
                            setSelectedSkills(selectedSkills.filter((s) => s !== skillId));
                          } else {
                            setSelectedSkills([...selectedSkills, skillId]);
                          }
                        }}
                        disabled={isReadonlyAssistant}
                      />
                    ))}
                    {builtinSelectableSkills.length === 0 && <div className='text-center text-t-secondary text-12px py-16px col-span-full'>{t('settings.noBuiltinSkills', { defaultValue: 'No builtin skills available' })}</div>}
                  </div>
                </Collapse.Item>
              </Collapse>
            </div>
          </div>
        </div>
      </Drawer>

      {/* Delete Confirmation Modal */}
      <Modal title={t('settings.deleteAssistantTitle', { defaultValue: '删除助手' })} visible={deleteConfirmVisible} onCancel={() => setDeleteConfirmVisible(false)} onOk={handleDeleteConfirm} okButtonProps={{ status: 'danger' }} okText={t('common.delete', { defaultValue: '删除' })} cancelText={t('common.cancel', { defaultValue: '取消' })} className='w-[90vw] md:w-[400px]' wrapStyle={{ zIndex: 10000 }} maskStyle={{ zIndex: 9999 }}>
        <p>{t('settings.deleteAssistantConfirm', { defaultValue: '删除该助手会一并删除已关联会话。如需保留，请导出会话进行备份。是否确认删除？' })}</p>
        {activeAssistant && (
          <div className='mt-12px p-12px bg-fill-2 rounded-lg flex items-center gap-12px'>
            <Avatar.Group size={32}>
              <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
                {(() => {
                  const resolvedAvatar = activeAssistant.avatar?.trim();
                  const avatarImg = resolveAvatarImageSrc(resolvedAvatar);
                  const hasEmoji = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
                  if (avatarImg) return <img src={avatarImg} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                  if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                  return <Robot theme='outline' size={16} />;
                })()}
              </Avatar>
            </Avatar.Group>
            <div>
              <div className='font-medium'>{activeAssistant.nameI18n?.[localeKey] || activeAssistant.name}</div>
              <div className='text-12px text-t-secondary'>{activeAssistant.descriptionI18n?.[localeKey] || activeAssistant.description}</div>
            </div>
          </div>
        )}
      </Modal>

      {/* Duplicate Confirmation Modal */}
      <Modal
        title={t('settings.duplicateAssistantTitle', { defaultValue: '复制助手' })}
        visible={duplicateConfirmVisible}
        onCancel={() => {
          setDuplicateConfirmVisible(false);
          setDuplicateAssistant(null);
          setDuplicateInstalledAssistant(null);
        }}
        onOk={handleDuplicateConfirm}
        okText={t('common.confirm', { defaultValue: '确认' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
        className='w-[90vw] md:w-[400px]'
        wrapStyle={{ zIndex: 10000 }}
        maskStyle={{ zIndex: 9999 }}
      >
        <p>{t('settings.duplicateAssistantConfirm', { defaultValue: '确认复制该助手到自定义列表？复制后可在"我的助手"中进行编辑。' })}</p>
        {/* Hub assistant preview */}
        {duplicateAssistant && (
          <div className='mt-12px p-12px bg-fill-2 rounded-lg flex items-center gap-12px'>
            <Avatar.Group size={32}>
              <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
                {(() => {
                  const resolvedAvatar = duplicateAssistant.avatar?.trim();
                  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
                  const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));
                  if (resolvedAvatar && !hasEmojiAvatar) return <img src={resolvedAvatar} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                  if (hasEmojiAvatar) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                  return <Robot theme='outline' size={16} />;
                })()}
              </Avatar>
            </Avatar.Group>
            <div>
              <div className='font-medium'>{duplicateAssistant.display_name || duplicateAssistant.name}</div>
              <div className='text-12px text-t-secondary line-clamp-2'>{duplicateAssistant.description}</div>
            </div>
          </div>
        )}
        {/* Installed assistant preview */}
        {duplicateInstalledAssistant && (
          <div className='mt-12px p-12px bg-fill-2 rounded-lg flex items-center gap-12px'>
            <Avatar.Group size={32}>
              <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
                {(() => {
                  const resolvedAvatar = duplicateInstalledAssistant.avatar?.trim();
                  const avatarImg = resolveAvatarImageSrc(resolvedAvatar);
                  const hasEmoji = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
                  if (avatarImg) return <img src={avatarImg} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                  if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                  return <Robot theme='outline' size={16} />;
                })()}
              </Avatar>
            </Avatar.Group>
            <div>
              <div className='font-medium'>{duplicateInstalledAssistant.nameI18n?.[localeKey] || duplicateInstalledAssistant.name}</div>
              <div className='text-12px text-t-secondary line-clamp-2'>{duplicateInstalledAssistant.descriptionI18n?.[localeKey] || duplicateInstalledAssistant.description}</div>
            </div>
          </div>
        )}
        {/* Name hint */}
        {(duplicateAssistant || duplicateInstalledAssistant) && (
          <div className='mt-12px p-12px bg-primary-light rounded-lg'>
            <div className='text-12px text-primary'>
              {t('settings.duplicateAssistantNameHint', {
                name: duplicateAssistant ? duplicateAssistant.display_name || duplicateAssistant.name : duplicateInstalledAssistant?.nameI18n?.[localeKey] || duplicateInstalledAssistant?.name,
                defaultValue: `复制后的助手名称: 自定义-${duplicateAssistant ? duplicateAssistant.display_name || duplicateAssistant.name : duplicateInstalledAssistant?.nameI18n?.[localeKey] || duplicateInstalledAssistant?.name}`,
              })}
            </div>
          </div>
        )}
      </Modal>

      {/* Upload Confirmation Modal */}
      <Modal
        title={t('settings.uploadAssistantTitle', { defaultValue: '上传助手' })}
        visible={uploadConfirmVisible}
        onCancel={() => {
          setUploadConfirmVisible(false);
          setUploadAssistant(null);
        }}
        onOk={handleUploadConfirm}
        okText={t('common.confirm', { defaultValue: '确认' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
        confirmLoading={uploading}
        className='w-[90vw] md:w-[400px]'
        wrapStyle={{ zIndex: 10000 }}
        maskStyle={{ zIndex: 9999 }}
      >
        <p>{t('settings.uploadAssistantConfirm', { defaultValue: '确认上传该助手到助手商店？上传后同一租户下的其他用户可以下载使用。' })}</p>
        {/* Assistant preview */}
        {uploadAssistant && (
          <div className='mt-12px p-12px bg-fill-2 rounded-lg flex items-center gap-12px'>
            <Avatar.Group size={32}>
              <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
                {(() => {
                  const resolvedAvatar = uploadAssistant.avatar?.trim();
                  const avatarImg = resolveAvatarImageSrc(resolvedAvatar);
                  const hasEmoji = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
                  if (avatarImg) return <img src={avatarImg} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                  if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                  return <Robot theme='outline' size={16} />;
                })()}
              </Avatar>
            </Avatar.Group>
            <div>
              <div className='font-medium'>{uploadAssistant.nameI18n?.[localeKey] || uploadAssistant.name}</div>
              <div className='text-12px text-t-secondary line-clamp-2'>{uploadAssistant.descriptionI18n?.[localeKey] || uploadAssistant.description}</div>
            </div>
          </div>
        )}
      </Modal>

      {/* Hub Assistant Detail Modal */}
      <AssistantDetailModal
        assistant={hubDetailAssistant}
        visible={hubDetailVisible}
        onClose={() => {
          setHubDetailVisible(false);
          setHubDetailAssistant(null);
        }}
        isInstalled={hubDetailAssistant ? hubInstalledAssistantNames.has(hubDetailAssistant.name) : false}
        installing={installingAssistantId === hubDetailAssistant?.id}
        installProgress={installProgress}
        onInstall={(selectedSkillIds) => {
          if (hubDetailAssistant) {
            void handleInstallHubAssistant(hubDetailAssistant.id, selectedSkillIds);
          }
        }}
        onGoUse={handleGoUseHubAssistant}
        installedSkills={installedSkills}
      />
    </div>
  );
};

export default AgentModalContent;
