/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Spin, Modal, Popconfirm, Progress, Tooltip } from '@arco-design/web-react';
import { IconDownload, IconRefresh } from '@arco-design/web-react/icon';
import { Delete, Shield } from '@icon-park/react';
import { PackagePlus } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { handleSkillIconError } from '@/renderer/utils/skillDisplay';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { skillHub } from '@/common/ipcBridge';
import type { ISkillHubSkill, ISkillHubDetail } from '@/common/ipcBridge';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { fetchSkillDetailHttp, type SkillDetailResponse, type SkillLatestVersion } from '../index';
import SkillAuditSummary from './SkillAuditSummary';

function parseJsonArray(jsonStr: string | null): string[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface CoreFeature {
  title: string;
  desc: string;
}

function parseCoreFeatures(jsonStr: string | null): CoreFeature[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function SkillDetailModal({
  skill,
  visible,
  onClose,
  isInstalled,
  isHubInstalled,
  hasVersion,
  latestVersionInfo,
  installing,
  downloading,
  installProgress,
  onInstall,
  onDownload,
  onUninstall,
  uninstalling,
  onGoUse,
  onUpdate,
  updating = false,
  installedVersion,
  skipApiFetch = false,
  hideActions = false,
  auditSkillName,
  onViewAuditDetails,
}: ISkillDetailModalProps) {
  const canUninstall = isInstalled && isHubInstalled;
  const [detail, setDetail] = useState<ISkillHubDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  // Use useAppMode hook for renderer process (enterpriseDebugConfig.isEnterpriseMode only works in main process)
  const { isEnterprise } = useAppMode();

  useEffect(() => {
    console.log('[SkillDetailModal] useEffect triggered', { visible: !!skill, skillId: skill?.id, isEnterprise, skipApiFetch });

    // If data is pre-loaded from local meta, no need to call the API
    if (skipApiFetch) {
      setDetail(null);
      setLoading(false);
      return;
    }
    // In enterprise mode, skip SkillHub API calls
    if (isEnterprise) {
      setDetail(null);
      setLoading(false);
      return;
    }
    if (visible && skill && !detail) {
      setLoading(true);
      const fetchDetail = async () => {
        try {
          let res: SkillDetailResponse;
          if (isElectronDesktop()) {
            res = await skillHub.fetchSkillDetail.invoke({ skillId: skill.id });
          } else {
            res = await fetchSkillDetailHttp(skill.id);
          }
          if (res.success && res.data) {
            setDetail(res.data);
          }
        } catch (err) {
          console.error('Failed to fetch skill detail:', err);
        } finally {
          setLoading(false);
        }
      };
      void fetchDetail();
    }
    if (!visible) {
      setDetail(null);
    }
  }, [detail, visible, skill, skipApiFetch, isEnterprise]);

  if (!skill) return null;

  const coreFeatures = parseCoreFeatures(skill.core_features);
  const applicableScenarios = parseJsonArray(skill.applicable_scenarios);
  const hasUpdate = isInstalled && latestVersionInfo && (!installedVersion || latestVersionInfo.version !== installedVersion);

  return (
    <Modal visible={visible} onCancel={onClose} footer={null} maskClosable style={{ width: 480 }}>
      <div className='flex flex-col max-h-80vh'>
        <AionScrollArea className='flex-1 min-h-0'>
          <div className='px-8px pb-16px'>
            {/* Icon + Name header */}
            <div className='flex flex-col items-center mb-20px'>
              <div className='w-72px h-72px rd-14px overflow-hidden bg-fill-2 mb-12px'>
                {skill.icon ? <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' onError={handleSkillIconError} /> : <div className='w-full h-full f-center text-34px'>{skill.emoji || '📦'}</div>}
              </div>
              <div className='font-semibold text-17px text-foreground text-center'>{skill.display_name}</div>
              {skill.categories && skill.categories.length > 0 && (
                <div className='flex gap-4px mt-6px flex-wrap justify-center'>
                  {skill.categories.map((cat, idx) => (
                    <span key={idx} className='px-7px py-1px bg-fill-2 text-secondary text-11px rd-4px'>
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
                {/* 技能介绍 */}
                <div className='bg-fill-1 rd-10px p-14px'>
                  <div className='flex items-center gap-6px mb-8px'>
                    <span className='text-14px'>✦</span>
                    <span className='font-medium text-13px text-foreground'>{t('settings.skill.introduction', { defaultValue: '技能介绍' })}</span>
                  </div>
                  <div className='text-12px text-secondary leading-relaxed'>{skill.description}</div>
                </div>

                {/* 怎么使用 */}
                {(coreFeatures.length > 0 || applicableScenarios.length > 0) && (
                  <div className='bg-fill-1 rd-10px p-14px'>
                    <div className='flex items-center gap-6px mb-10px'>
                      <span className='text-14px'>📄</span>
                      <span className='font-medium text-13px text-foreground'>{t('settings.skill.howToUse', { defaultValue: '怎么使用？' })}</span>
                    </div>
                    <div className='space-y-6px'>
                      {coreFeatures.map((feature, idx) => (
                        <div key={idx} className='flex items-start gap-6px'>
                          <span className='text-secondary text-11px mt-1px flex-shrink-0'>•</span>
                          <div className='text-12px text-secondary leading-relaxed'>
                            {feature.title}
                            {feature.desc && <span>{feature.title ? `，${feature.desc}` : feature.desc}</span>}
                          </div>
                        </div>
                      ))}
                      {applicableScenarios.map((scenario, idx) => (
                        <div key={`s-${idx}`} className='flex items-start gap-6px'>
                          <span className='text-tertiary text-11px mt-1px flex-shrink-0'>•</span>
                          <div className='text-12px text-secondary leading-relaxed'>{scenario}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Security audit section — shown for installed skills */}
                {isInstalled && auditSkillName && <SkillAuditSummary skillName={auditSkillName} onViewDetails={onViewAuditDetails ? () => onViewAuditDetails(auditSkillName) : undefined} />}
              </div>
            )}
          </div>
        </AionScrollArea>

        {/* Action buttons — hidden when opened from installed tab */}
        <div className={classNames('px-8px pt-12px border-t mt-4px', hideActions && 'hidden')}>
          <div className='flex gap-8px items-center'>
            {isInstalled ? (
              <>
                {hasUpdate ? (
                  <Tooltip content={t('settings.skill.updateTo', { version: latestVersionInfo?.version, defaultValue: `更新至 v${latestVersionInfo?.version || ''}` })}>
                    <Button type='primary' long size='large' className='flex-1' loading={updating} loadingFixedWidth icon={<IconRefresh style={{ fontSize: 15 }} />} onClick={onUpdate}>
                      {t('settings.skill.updateTo', { version: latestVersionInfo?.version, defaultValue: `更新至 v${latestVersionInfo?.version || ''}` })}
                    </Button>
                  </Tooltip>
                ) : (
                  <Button type='primary' long size='large' className='flex-1' onClick={onGoUse || onClose}>
                    {t('settings.skill.goUse', { defaultValue: '去使用' })}
                  </Button>
                )}
                {canUninstall &&
                  (uninstalling ? (
                    <div className='w-36px h-36px flex items-center justify-center'>
                      <Spin size={16} />
                    </div>
                  ) : (
                    <Popconfirm title='确认卸载该技能？' onOk={onUninstall} okText='卸载' cancelText='取消' okButtonProps={{ status: 'danger' }}>
                      <Tooltip content={t('common.delete', { defaultValue: '删除' })}>
                        <div className='w-36px h-36px f-center rd-8px border hover:bg-fill-2 cursor-pointer transition-colors text-secondary'>
                          <Delete size='16' />
                        </div>
                      </Tooltip>
                    </Popconfirm>
                  ))}
              </>
            ) : installing ? (
              <div className='flex-1'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : hasVersion ? (
              <>
                <Tooltip content={t('settings.skill.install', { defaultValue: '安装' })}>
                  <Button type='primary' long size='large' icon={<PackagePlus size={15} />} onClick={onInstall} disabled={downloading}>
                    {t('settings.skill.install', { defaultValue: '安装' })}
                  </Button>
                </Tooltip>
                <Tooltip content={t('common.download', { defaultValue: '下载' })}>
                  <Button size='large' icon={<IconDownload style={{ fontSize: 15 }} />} loading={downloading} loadingFixedWidth onClick={onDownload} disabled={installing}>
                    {t('common.download', { defaultValue: '下载' })}
                  </Button>
                </Tooltip>
              </>
            ) : null}
          </div>

          {/* Security badge */}
          <div className='f-center gap-2 mt-3'>
            <Shield size='12' className='text-success flex-shrink-0' />
            <span className='text-10px text-secondary'>已通过安全与合规验证，无恶意代码或数据泄露风险。</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface ISkillDetailModalProps {
  skill: ISkillHubSkill | null;
  visible: boolean;
  onClose: () => void;
  isInstalled: boolean;
  /** Whether the installed skill was installed from the hub (can be uninstalled) */
  isHubInstalled: boolean;
  hasVersion: boolean;
  latestVersionInfo?: SkillLatestVersion;
  installing: boolean;
  downloading: boolean;
  installProgress: number;
  onInstall: () => void;
  onDownload: () => void;
  onUninstall: () => void;
  uninstalling: boolean;
  /** Callback when "Go Use" button is clicked */
  onGoUse?: () => void;
  /** Callback when "Update" button is clicked */
  onUpdate?: () => void;
  /** Whether an update is currently in progress */
  updating?: boolean;
  /** The currently installed version string (for update comparison) */
  installedVersion?: string;
  /**
   * When true, skip the remote API fetch for detail.
   * Use this when opening from the installed tab where all data is
   * already available from the locally-stored _sudowork_meta.json.
   */
  skipApiFetch?: boolean;
  /** When true, hide the action buttons area entirely (e.g. when opened from installed tab) */
  hideActions?: boolean;
  /** Skill directory name for audit report display */
  auditSkillName?: string;
  /** Callback when "View Audit Details" is clicked */
  onViewAuditDetails?: (skillName: string) => void;
}
