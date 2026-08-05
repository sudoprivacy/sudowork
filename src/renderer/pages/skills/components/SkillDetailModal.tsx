/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Spin, Modal, Popconfirm, Progress } from '@arco-design/web-react';
import { IconDownload, IconRefresh } from '@arco-design/web-react/icon';
import { PackagePlus, Trash2, Shield } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { handleSkillIconError } from '@/renderer/utils/skillDisplay';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { skillHub } from '@/common/ipcBridge';
import type { ISkillHubSkill, ISkillHubDetail } from '@/common/ipcBridge';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { fetchSkillDetailHttp } from '../utils';
import type { SkillDetailResponse, SkillLatestVersion, CoreFeature } from '../types';
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
          <div className='px-2 pb-4'>
            {/* Icon + Name header */}
            <div className='flex flex-col items-center mb-5'>
              <div className='size-18 rounded-lg overflow-hidden mb-3'>{skill.icon ? <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' onError={handleSkillIconError} /> : <div className='w-full h-full f-center text-34px'>{skill.emoji || '📦'}</div>}</div>
              <div className='font-semibold text-17px text-foreground text-center'>{skill.display_name}</div>
              {skill.categories && skill.categories.length > 0 && (
                <div className='flex gap-1 mt-1.5 flex-wrap justify-center'>
                  {skill.categories.map((cat, idx) => (
                    <span key={idx} className='px-[7px] py-[1px] bg-secondary text-foreground-secondary text-11px rd-4px'>
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
                {/* 技能介绍 */}
                <div className='bg-muted rounded-lg p-3.5'>
                  <div className='flex items-center gap-1.5 mb-2'>
                    <span className='text-14px'>✦</span>
                    <span className='font-medium text-13px text-foreground'>{t('settings.skill.introduction', '技能介绍')}</span>
                  </div>
                  <div className='text-12px text-foreground-secondary leading-relaxed'>{skill.description}</div>
                </div>

                {/* 怎么使用 */}
                {(coreFeatures.length > 0 || applicableScenarios.length > 0) && (
                  <div className='bg-muted rounded-lg p-3.5'>
                    <div className='flex items-center gap-1.5 mb-2.5'>
                      <span className='text-14px'>📄</span>
                      <span className='font-medium text-13px text-foreground'>{t('settings.skill.howToUse', '怎么使用？')}</span>
                    </div>
                    <div className='space-y-1.5'>
                      {coreFeatures.map((feature, idx) => (
                        <div key={idx} className='flex items-start gap-1.5'>
                          <span className='text-foreground-secondary text-11px mt-[1px] flex-shrink-0'>•</span>
                          <div className='text-12px text-foreground-secondary leading-relaxed'>
                            {feature.title}
                            {feature.desc && <span>{feature.title ? `，${feature.desc}` : feature.desc}</span>}
                          </div>
                        </div>
                      ))}
                      {applicableScenarios.map((scenario, idx) => (
                        <div key={`s-${idx}`} className='flex items-start gap-1.5'>
                          <span className='text-foreground-tertiary text-11px mt-[1px] flex-shrink-0'>•</span>
                          <div className='text-12px text-foreground-secondary leading-relaxed'>{scenario}</div>
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
        <div className={classNames('px-2 pt-3 border-t border-border mt-1', hideActions && 'hidden')}>
          <div className='flex gap-2 items-center'>
            {isInstalled ? (
              <>
                {hasUpdate ? (
                  <Button type='primary' long size='large' className='flex-1' loading={updating} loadingFixedWidth icon={<IconRefresh style={{ fontSize: 15 }} />} onClick={onUpdate}>
                    {t('settings.skill.updateTo', { version: latestVersionInfo?.version || '', defaultValue: '更新至 v{{version}}' })}
                  </Button>
                ) : (
                  <Button type='primary' long size='large' className='flex-1' onClick={onGoUse || onClose}>
                    {t('settings.skill.goUse', '去使用')}
                  </Button>
                )}
                {canUninstall &&
                  (uninstalling ? (
                    <div className='size-9 f-center'>
                      <Spin size={16} />
                    </div>
                  ) : (
                    <Popconfirm title={t('settings.skill.uninstallConfirm', '确认卸载该技能？')} onOk={onUninstall} okText={t('common.uninstall', '卸载')} cancelText={t('common.cancel', '取消')} okButtonProps={{ status: 'danger' }}>
                      <Button size='large' icon={<Trash2 size={16} />} />
                    </Popconfirm>
                  ))}
              </>
            ) : installing ? (
              <div className='flex-1'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : hasVersion ? (
              <>
                <Button type='primary' long size='large' icon={<PackagePlus size={15} />} onClick={onInstall} disabled={downloading}>
                  {t('settings.skill.install', '安装')}
                </Button>
                <Button size='large' icon={<IconDownload style={{ fontSize: 15 }} />} loading={downloading} loadingFixedWidth onClick={onDownload} disabled={installing}>
                  {t('common.download', '下载')}
                </Button>
              </>
            ) : null}
          </div>

          {/* Security badge */}
          <div className='f-center gap-2 mt-3'>
            <Shield size={12} className='text-success flex-shrink-0' />
            <span className='text-10px text-foreground-secondary'>{t('settings.skill.securityVerified', '已通过安全与合规验证，无恶意代码或数据泄露风险。')}</span>
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
