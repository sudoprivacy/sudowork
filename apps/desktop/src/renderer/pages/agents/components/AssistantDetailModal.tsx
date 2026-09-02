/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Progress, Spin } from '@arco-design/web-react';
import { IconDownload } from '@arco-design/web-react/icon';
import { Bot, Shield, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { assistantHub } from '@/common';
import type { IInstalledSkillInfo, IAssistantHubSkill, ISkillHubSkill } from '@/common/ipcBridge';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { handleSkillIconError } from '@/renderer/utils/skillDisplay';
import { COS_HUB_BASE } from '@/shared/cos';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import type { AssistantLatestVersion } from '../types';
import { isAssistantVersionNewer } from '../utils';

const AssistantDetailModal: React.FC<AssistantDetailModalProps> = ({ assistant, visible, onClose, isInstalled, installing, installProgress, onInstall, latestVersionInfo, installedVersion, onUpdate, updating = false, onGoUse, installedSkills }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [relatedSkillDetails, setRelatedSkillDetails] = useState<ISkillHubSkill[]>([]);
  const [relatedSkillTags, setRelatedSkillTags] = useState<Map<string, string>>(new Map());
  const [loadingSkills, setLoadingSkills] = useState(false);

  // Use useAppMode hook for renderer process (enterpriseDebugConfig.isEnterpriseMode only works in main process)
  const { isEnterprise } = useAppMode();

  // Check if assistant has a valid download URL
  const hasDownloadUrl = Boolean(latestVersionInfo?.sourceUrl || assistant?._sourceUrl);

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
      setRelatedSkillDetails([]);
      return;
    }

    setLoading(true);
    setLoadingSkills(true);

    const fetchData = async () => {
      try {
        if (isElectronDesktop()) {
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
  const latestVersionValue = latestVersionInfo?.version || assistant.version;
  const hasUpdate = Boolean(isInstalled && isAssistantVersionNewer(latestVersionValue, installedVersion));
  const associatedSkillIds = !isEnterprise && assistant.skills?.length > 0 ? assistant.skills : relatedSkillDetails.map((s) => s.id);

  return (
    <Modal visible={visible} onCancel={onClose} footer={null} style={{ width: 480 }}>
      <div className='flex flex-col max-h-80vh'>
        <AionScrollArea className='flex-1 min-h-0'>
          <div className='px-2 pb-4'>
            {/* Icon + Name header */}
            <div className='flex flex-col items-center mb-5'>
              <div className='size-18 rd-14px overflow-hidden mb-3'>
                {resolvedAvatar ? (
                  hasEmojiAvatar ? (
                    <div className='w-full h-full f-center text-34px'>{resolvedAvatar}</div>
                  ) : (
                    <img src={resolvedAvatar} alt={displayName} className='w-full h-full object-cover' />
                  )
                ) : assistant.emoji ? (
                  <div className='w-full h-full f-center text-34px'>{assistant.emoji}</div>
                ) : (
                  <div className='w-full h-full f-center'>
                    <Bot size={34} className='text-primary' />
                  </div>
                )}
              </div>
              <div className='font-semibold text-17px text-foreground text-center'>{displayName}</div>
              {assistant.categories && assistant.categories.length > 0 && (
                <div className='flex gap-1 mt-1.5 flex-wrap justify-center'>
                  {assistant.categories.map((cat, idx) => (
                    <span key={idx} className='px-7px py-1px bg-control text-secondary text-11px rd-1'>
                      {cat}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {loading ? (
              <div className='flex justify-center py-8'>
                <Spin />
              </div>
            ) : (
              <div className='space-y-4'>
                {/* Assistant intro */}
                <div className='bg-faint rd-10px p-3.5'>
                  <div className='flex items-center gap-1.5 mb-2'>
                    <span className='text-14px'>✦</span>
                    <span className='font-medium text-13px text-foreground'>{t('settings.assistant.introduction', '助手介绍')}</span>
                  </div>
                  <div className='text-12px text-secondary leading-relaxed'>{assistant.description}</div>
                </div>

                {/* Associated skills */}
                {relatedSkillDetails.length > 0 && !isInstalled && (
                  <div className='bg-faint rd-10px p-3.5'>
                    <div className='flex items-center gap-1.5 mb-2.5'>
                      <Zap size={14} className='text-primary' />
                      <span className='font-medium text-13px text-foreground'>{t('settings.assistant.relatedSkills', '关联技能')}</span>
                      <span className='text-12px text-secondary'>({relatedSkillDetails.length})</span>
                      {installedSkillCount > 0 && <span className='text-12px text-secondary'>· {t('settings.assistant.skillsInstalled', { installed: installedSkillCount, defaultValue: `${installedSkillCount} 已安装` })}</span>}
                    </div>
                    {loadingSkills ? (
                      <div className='text-center text-secondary text-12px py-16px'>{t('common.loading', '加载中...')}</div>
                    ) : (
                      <div className='space-y-2'>
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
                            skillIconUrl = skill.icon && !skill.icon.startsWith('http') && !skill.icon.startsWith('data:') && !skill.icon.startsWith('/') && !skill.icon.startsWith('aion-asset://') && !skill.icon.startsWith('file://') ? `${COS_HUB_BASE}/${skill.icon}` : skill.icon;
                          }
                          return (
                            <div key={skill.id} className='flex items-center gap-2.5 p-2 bg-base rd-8px'>
                              <div className='size-8 flex-shrink-0 rd-6px overflow-hidden'>
                                {skillIconUrl ? (
                                  <img src={skillIconUrl} alt={skillDisplayName} className='w-full h-full object-cover' onError={handleSkillIconError} />
                                ) : skill.emoji ? (
                                  <div className='w-full h-full f-center text-16px'>{skill.emoji}</div>
                                ) : (
                                  <div className='w-full h-full f-center'>
                                    <Zap size={14} className='text-primary' />
                                  </div>
                                )}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='flex items-center gap-4px'>
                                  <span className='font-medium text-13px text-foreground truncate'>{skillDisplayName}</span>
                                  {isBuiltinSkill && <Shield size={12} className='text-primary flex-shrink-0' />}
                                </div>
                                <div className='text-11px text-secondary truncate'>{skill.description}</div>
                              </div>
                              <span className={`px-1 py-0 text-10px rd-1 whitespace-nowrap ${isSkillInstalled ? 'text-primary' : 'bg-muted text-secondary'}`}>{isSkillInstalled ? t('settings.skill.installed', '已安装') : t('settings.skill.notInstalled', '未安装')}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className='mt-3 text-11px text-secondary'>{t('settings.assistant.skillsInstallHint', '安装助手时会自动安装关联的技能')}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </AionScrollArea>

        {/* Action buttons */}
        <div className='px-2 pt-3 border-t border-light mt-1'>
          <div className='flex gap-2 items-center'>
            {isInstalled && hasUpdate ? (
              <Button type='primary' long size='large' className='flex-1' loading={updating} loadingFixedWidth icon={<IconDownload />} onClick={() => onUpdate?.(associatedSkillIds)}>
                {t('settings.assistant.updateTo', { version: latestVersionValue, defaultValue: `更新至 v${latestVersionValue}` })}
              </Button>
            ) : isInstalled ? (
              <Button type='primary' long size='large' className='flex-1' onClick={onGoUse || onClose}>
                {t('settings.skill.goUse', '去使用')}
              </Button>
            ) : !hasDownloadUrl ? (
              <div className='flex-1 text-center text-secondary text-13px py-12px'>{t('settings.assistant.noDownloadUrl', '该助手暂不支持安装，请联系管理员')}</div>
            ) : installing ? (
              <div className='flex-1'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : (
              <Button type='primary' long size='large' icon={<IconDownload />} onClick={() => onInstall(associatedSkillIds)}>
                {t('settings.assistant.install', '安装助手')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

type AssistantDetailModalProps = {
  assistant: IAssistantHubSkill | null;
  visible: boolean;
  onClose: () => void;
  isInstalled: boolean;
  installing: boolean;
  installProgress: number;
  onInstall: (_selectedSkillIds: string[]) => void;
  latestVersionInfo?: AssistantLatestVersion;
  installedVersion?: string;
  onUpdate?: (_selectedSkillIds: string[]) => void;
  updating?: boolean;
  onGoUse?: () => void;
  installedSkills: IInstalledSkillInfo[];
};

export default AssistantDetailModal;
