/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { ipcBridge } from '@/common';
import { resolveSkillIcon, getInstalledSkillDisplay, normalizeSkillVersion } from '@/renderer/utils/skillDisplay';
import { useSettingsViewMode } from '../settingsViewContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spin, Message, Input, Progress, Modal, Popconfirm, Switch } from '@arco-design/web-react';
import { Download, Search, Delete, Close, Shield, Lightning, UploadOne, Install } from '@icon-park/react';
import classNames from 'classnames';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { skillHub } from '@/common/ipcBridge';
import type { ISkillHubSkill, ISkillHubDetail, ISkillHubListResponse, IInstalledSkillInfo, ISkillHubMeta } from '@/common/ipcBridge';
import { useAuth } from '@/renderer/context/AuthContext';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SkillAuditSummary, SkillAuditDetailModal, SkillAuditReportModal } from './SkillAuditReport';

// ==================== Helpers ====================

/** Build a synthetic ISkillHubSkill from locally-stored hub metadata */
function installedInfoToSkill(skillInfo: IInstalledSkillInfo): ISkillHubSkill {
  const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skillInfo);
  const meta = skillInfo.meta as ISkillHubMeta;

  return {
    id: meta.id,
    name: meta.name,
    display_name: displayName,
    description: description || '',
    icon: icon || resolveSkillIcon(meta.icon),
    emoji: emoji || meta.emoji,
    category: meta.category,
    categories: meta.categories,
    applicable_scenarios: meta.applicable_scenarios,
    core_features: meta.core_features,
    homepage: meta.homepage,
    author_id: meta.author_id,
    star_count: 0,
    created_at: meta.installed_at,
    updated_at: meta.installed_at,
  };
}

// ==================== Types ====================

interface IBridgeResponse<D = unknown> {
  success: boolean;
  data?: D;
  msg?: string;
}

interface SkillLatestVersion {
  version: string;
  sourceUrl: string;
  checksum: string;
}

type SkillDetailResponse = { success: boolean; data?: ISkillHubDetail; msg?: string };

// ==================== API Functions (web fallback) ====================

async function fetchSkillDetailHttp(skillId: string): Promise<SkillDetailResponse> {
  const response = await fetch(`/api/skill-hub/skills/${skillId}`);
  return response.json();
}

export type SkillStoreTab = 'store' | 'exclusive' | 'installed';

export function resolveSkillTenantId(tab: SkillStoreTab, enterpriseCode?: string): string | undefined {
  const normalized = enterpriseCode?.trim();
  if (tab !== 'exclusive' || !normalized) {
    return undefined;
  }
  return normalized;
}

async function fetchSkillsHttp(params: { cursor?: string; limit?: number; query?: string; category?: string; tenantId?: string }) {
  const searchParams = new URLSearchParams();
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.query) searchParams.set('query', params.query);
  if (params.category) searchParams.set('categories', params.category);
  if (params.tenantId) searchParams.set('tenant_id', params.tenantId);
  const response = await fetch(`/api/skill-hub/skills/cursor?${searchParams}`);
  return response.json();
}

async function fetchCategoriesHttp() {
  const response = await fetch('/api/categories');
  return response.json();
}

// ==================== Parse JSON Fields ====================

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

export function getInstalledSkillBadgeCount(installedList: IInstalledSkillInfo[]): number {
  return installedList.length;
}

// ==================== SkillCard Component ====================

const SkillCard: React.FC<{
  skill: ISkillHubSkill;
  isInstalled: boolean;
  hasVersion: boolean;
  installing: boolean;
  installProgress: number;
  onInstall: (e: React.MouseEvent) => void;
  onClick: () => void;
  hasUpdate?: boolean;
  onUpdate?: (e: React.MouseEvent) => void;
  updating?: boolean;
}> = ({ skill, isInstalled, hasVersion, installing, installProgress, onInstall, onClick, hasUpdate, onUpdate, updating }) => {
  const { t } = useTranslation();

  return (
    <div className='group bg-fill-1 rd-12px cursor-pointer hover:bg-fill-2 transition-colors border border-line p-12px flex items-start gap-12px relative overflow-hidden' onClick={onClick}>
      {/* Icon */}
      <div className='w-48px flex-shrink-0 flex flex-col items-center'>
        <div className='w-48px h-48px rd-8px overflow-hidden bg-fill-2'>{skill.icon ? <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' /> : <div className='w-full h-full flex items-center justify-center text-22px'>{skill.emoji || '📦'}</div>}</div>
        {isInstalled && <span className={classNames('mt-6px px-5px py-0px text-10px rd-3px whitespace-nowrap leading-18px', hasUpdate ? 'bg-warning-light text-warning' : 'bg-primary-light text-primary')}>{hasUpdate ? t('settings.skill.updateAvailable', { defaultValue: '可更新' }) : t('settings.skill.installed', { defaultValue: '已安装' })}</span>}
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px pr-58px min-w-0'>
          <span className='flex-1 min-w-0 font-medium text-13px text-t-primary truncate'>{skill.display_name}</span>
        </div>
        <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{skill.description}</div>
      </div>

      {/* Action - top right */}
      <div className='absolute top-10px right-10px flex items-center' onClick={(e) => e.stopPropagation()}>
        {installing || updating ? (
          <div className='w-52px'>
            <Progress percent={installProgress} size='mini' />
          </div>
        ) : isInstalled && hasUpdate ? (
          <button type='button' className='h-24px px-8px rd-full border-none bg-warning-light text-warning text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:opacity-80' onClick={onUpdate}>
            <Install size='13' />
            <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.skill.update', { defaultValue: '更新' })}</span>
          </button>
        ) : !isInstalled && hasVersion ? (
          <button type='button' className='h-24px px-8px rd-full border-none bg-fill-2 text-t-secondary text-11px font-medium flex items-center justify-center gap-4px cursor-pointer transition-colors hover:bg-fill-3 hover:text-t-primary' onClick={onInstall}>
            <Install size='13' />
            <span className='max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-180 group-hover:max-w-40px group-hover:opacity-100'>{t('settings.skill.install', { defaultValue: '安装' })}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};

// ==================== InstalledSkillCard Component ====================

const InstalledSkillCard: React.FC<{
  skill: IInstalledSkillInfo;
  onUninstall: () => void;
  uninstalling: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  togglingEnabled: boolean;
  onClick?: () => void;
  hasUpdate?: boolean;
  onUpdate?: () => void;
  updating?: boolean;
}> = ({ skill, onUninstall, uninstalling, onToggleEnabled, togglingEnabled, onClick, hasUpdate, onUpdate, updating }) => {
  const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
  const displayVersion = normalizeSkillVersion(skill.version);
  const canUninstall = !skill.isBuiltin;
  const canToggleEnabled = !!skill.meta && !skill.isBuiltin;
  const hasDetail = !!skill.meta;
  const isEnabled = skill.enabled;
  const { t } = useTranslation();

  return (
    <div className={classNames('bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative overflow-hidden transition-colors', !isEnabled && 'opacity-65', hasDetail ? 'cursor-pointer hover:bg-fill-2' : 'hover:bg-fill-2')} onClick={hasDetail ? onClick : undefined}>
      {/* Icon + toggle */}
      <div className='w-48px flex-shrink-0 flex flex-col items-center'>
        <div className='w-48px h-48px rd-8px overflow-hidden bg-fill-2'>
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
        {canToggleEnabled && (
          <div
            className='mt-6px w-full flex justify-center'
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Switch size='small' checked={isEnabled} loading={togglingEnabled} onChange={(checked) => onToggleEnabled?.(checked)} className={isEnabled ? '!bg-primary !border-primary' : ''} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0 pr-28px'>
        <div className='h-20px flex items-center'>
          <span className='font-medium text-13px text-t-primary truncate'>{displayName}</span>
        </div>
        <div className='h-18px mt-2px flex items-center gap-4px'>
          {!skill.isBuiltin && displayVersion && <span className='px-5px py-0px bg-fill-3 text-t-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
          {hasUpdate && (
            <span
              className='px-5px py-0px bg-warning-light text-warning text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px cursor-pointer hover:opacity-80 transition-opacity'
              onClick={(e) => {
                e.stopPropagation();
                onUpdate?.();
              }}
            >
              {updating ? <Spin size={10} /> : t('settings.skill.updateAvailable', { defaultValue: '可更新' })}
            </span>
          )}
        </div>
        <div className='mt-3px min-h-30px'>{description ? <div className='text-11px text-t-secondary line-clamp-2 leading-15px'>{description}</div> : <div className='text-11px text-t-tertiary italic line-clamp-2 leading-15px'>{skill.name}</div>}</div>
      </div>

      {/* Uninstall / builtin indicator — stop propagation so card click doesn't fire */}
      <div className='absolute top-10px right-10px' onClick={(e) => e.stopPropagation()}>
        {skill.isBuiltin ? (
          <div className='w-22px h-22px flex items-center justify-center text-primary' title='内置技能'>
            <Shield size='15' />
          </div>
        ) : !canUninstall ? (
          <div className='w-22px h-22px flex items-center justify-center text-t-tertiary opacity-30' title='内置技能无法卸载'>
            <Shield size='14' />
          </div>
        ) : uninstalling ? (
          <Spin size={14} />
        ) : (
          <Popconfirm title='确认卸载该技能？' onOk={onUninstall} okText='卸载' cancelText='取消' okButtonProps={{ status: 'danger' }}>
            <div className='w-22px h-22px flex items-center justify-center text-t-tertiary hover:text-danger cursor-pointer transition-colors'>
              <Delete size='15' />
            </div>
          </Popconfirm>
        )}
      </div>
    </div>
  );
};

// ==================== SkillDetailModal Component ====================

const SkillDetailModal: React.FC<{
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
}> = ({ skill, visible, onClose, isInstalled, isHubInstalled, hasVersion, latestVersionInfo, installing, downloading, installProgress, onInstall, onDownload, onUninstall, uninstalling, onGoUse, onUpdate, updating = false, installedVersion, skipApiFetch = false, hideActions = false, auditSkillName, onViewAuditDetails }) => {
  const canUninstall = isInstalled && isHubInstalled;
  const [detail, setDetail] = useState<ISkillHubDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    // If data is pre-loaded from local meta, no need to call the API
    if (skipApiFetch) {
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
  }, [visible, skill, skipApiFetch]);

  if (!skill) return null;

  const coreFeatures = parseCoreFeatures(skill.core_features);
  const applicableScenarios = parseJsonArray(skill.applicable_scenarios);
  const hasUpdate = isInstalled && latestVersionInfo && (!installedVersion || latestVersionInfo.version !== installedVersion);

  return (
    <Modal visible={visible} onCancel={onClose} footer={null} closable={false} maskClosable style={{ width: 480 }} className='skill-detail-modal' wrapClassName='skill-detail-modal-wrap'>
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
              <div className='w-72px h-72px rd-14px overflow-hidden bg-fill-2 mb-12px'>{skill.icon ? <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' /> : <div className='w-full h-full flex items-center justify-center text-34px'>{skill.emoji || '📦'}</div>}</div>
              <div className='font-semibold text-17px text-t-primary text-center'>{skill.display_name}</div>
              {skill.categories && skill.categories.length > 0 && (
                <div className='flex gap-4px mt-6px flex-wrap justify-center'>
                  {skill.categories.map((cat, idx) => (
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
                {/* 技能介绍 */}
                <div className='bg-fill-1 rd-10px p-14px'>
                  <div className='flex items-center gap-6px mb-8px'>
                    <span className='text-14px'>✦</span>
                    <span className='font-medium text-13px text-t-primary'>{t('settings.skill.introduction', { defaultValue: '技能介绍' })}</span>
                  </div>
                  <div className='text-12px text-t-secondary leading-relaxed'>{skill.description}</div>
                </div>

                {/* 怎么使用 */}
                {(coreFeatures.length > 0 || applicableScenarios.length > 0) && (
                  <div className='bg-fill-1 rd-10px p-14px'>
                    <div className='flex items-center gap-6px mb-10px'>
                      <span className='text-14px'>📄</span>
                      <span className='font-medium text-13px text-t-primary'>{t('settings.skill.howToUse', { defaultValue: '怎么使用？' })}</span>
                    </div>
                    <div className='space-y-6px'>
                      {coreFeatures.map((feature, idx) => (
                        <div key={idx} className='flex items-start gap-6px'>
                          <span className='text-t-tertiary text-11px mt-1px flex-shrink-0'>•</span>
                          <div className='text-12px text-t-secondary leading-relaxed'>
                            {feature.title}
                            {feature.desc && <span className='text-t-tertiary'>{feature.title ? `，${feature.desc}` : feature.desc}</span>}
                          </div>
                        </div>
                      ))}
                      {applicableScenarios.map((scenario, idx) => (
                        <div key={`s-${idx}`} className='flex items-start gap-6px'>
                          <span className='text-t-tertiary text-11px mt-1px flex-shrink-0'>•</span>
                          <div className='text-12px text-t-secondary leading-relaxed'>{scenario}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Security audit section — shown for installed skills */}
                {isInstalled && auditSkillName && (
                  <SkillAuditSummary
                    skillName={auditSkillName}
                    onViewDetails={onViewAuditDetails ? () => onViewAuditDetails(auditSkillName) : undefined}
                  />
                )}
              </div>
            )}
          </div>
        </AionScrollArea>

        {/* Action buttons — hidden when opened from installed tab */}
        <div className={classNames('px-8px pt-12px border-t border-line mt-4px', hideActions && 'hidden')}>
          <div className='flex gap-8px items-center'>
            {isInstalled ? (
              <>
                {hasUpdate ? (
                  <Button type='primary' long size='large' className='flex-1' loading={updating} onClick={onUpdate}>
                    <span className='flex items-center gap-6px justify-center'>
                      <Install size='15' />
                      {t('settings.skill.updateTo', { version: latestVersionInfo?.version, defaultValue: `更新至 v${latestVersionInfo?.version || ''}` })}
                    </span>
                  </Button>
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
                      <div className='w-36px h-36px flex items-center justify-center rd-8px border border-line hover:bg-fill-2 cursor-pointer transition-colors text-t-secondary'>
                        <Delete size='16' />
                      </div>
                    </Popconfirm>
                  ))}
              </>
            ) : installing ? (
              <div className='flex-1'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : hasVersion ? (
              <>
                <Button type='primary' long size='large' onClick={onInstall} disabled={downloading}>
                  <span className='flex items-center gap-6px justify-center'>
                    <Install size='15' />
                    {t('settings.skill.install', { defaultValue: '安装技能' })}
                  </span>
                </Button>
                <Button size='large' onClick={onDownload} loading={downloading} disabled={installing}>
                  <span className='flex items-center gap-6px justify-center'>
                    <Download size='15' />
                    {t('common.download', { defaultValue: '下载' })}
                  </span>
                </Button>
              </>
            ) : null}
          </div>

          {/* Security badge */}
          <div className='flex items-center gap-5px mt-10px justify-center'>
            <Shield size='12' className='text-success flex-shrink-0' />
            <span className='text-10px text-t-tertiary'>已通过安全与合规验证，无恶意代码或数据泄露风险。</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ==================== Main Component ====================

const SkillModalContent: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const navigate = useNavigate();

  // Tab state
  const [activeTab, setActiveTab] = useState<SkillStoreTab>('store');

  // Store tab state
  const [skills, setSkills] = useState<ISkillHubSkill[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Detail modal state
  const [detailSkill, setDetailSkill] = useState<ISkillHubSkill | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  // Install state
  const [installedSkills, setInstalledSkills] = useState<Map<string, string>>(new Map());
  const [latestVersions, setLatestVersions] = useState<Map<string, SkillLatestVersion>>(new Map());
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [downloadingSkillId, setDownloadingSkillId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<string | null>(null);
  const [togglingSkillName, setTogglingSkillName] = useState<string | null>(null);
  const [updatingSkillId, setUpdatingSkillId] = useState<string | null>(null);

  // Installed tab state
  const [installedList, setInstalledList] = useState<IInstalledSkillInfo[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);

  // Installed skill detail modal state (separate from store detail modal)
  const [installedDetailInfo, setInstalledDetailInfo] = useState<IInstalledSkillInfo | null>(null);
  const [installedDetailVisible, setInstalledDetailVisible] = useState(false);

  // Audit detail modal state
  const [auditDetailSkillName, setAuditDetailSkillName] = useState<string | null>(null);
  const [auditDetailVisible, setAuditDetailVisible] = useState(false);

  // Standalone audit report modal state (shown after importing a custom skill)
  const [auditReportSkillName, setAuditReportSkillName] = useState<string | null>(null);
  const [auditReportVisible, setAuditReportVisible] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  // Sentinel element for IntersectionObserver-based infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Refs for always-current values — avoids stale closures in stable callbacks
  const selectedCategoryRef = useRef(selectedCategory);
  selectedCategoryRef.current = selectedCategory;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const latestVersionsRef = useRef(latestVersions);
  latestVersionsRef.current = latestVersions;

  // Track whether the installed-skill comparison map has been loaded at least once
  const [installedSkillsReady, setInstalledSkillsReady] = useState(false);
  const enterpriseCode = user?.enterprise_code?.trim();
  const currentTenantId = resolveSkillTenantId(activeTab, enterpriseCode);

  // ---- Fetch installed skills ----
  const fetchInstalledSkills = useCallback(async () => {
    if (!isElectronDesktop()) return;
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        const map = new Map<string, string>();
        // Only hub-installed skills should participate in the store comparison
        for (const s of res.data) {
          if (s.meta?.source_type === 'hub' || (!s.meta?.source_type && s.isHubInstalled)) {
            map.set(s.name, s.version);
          }
        }
        setInstalledSkills(map);
      }
    } catch (err) {
      console.error('Failed to fetch installed skills:', err);
    } finally {
      setInstalledSkillsReady(true);
    }
  }, []);

  // ---- Fetch installed list (for installed tab) ----
  const fetchInstalledList = useCallback(async () => {
    if (!isElectronDesktop()) return;
    setInstalledLoading(true);
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        setInstalledList(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch installed list:', err);
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  const handleImportLocalSkill = useCallback(async () => {
    if (!isElectronDesktop()) return;

    try {
      const dialogResult = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      });

      if (!dialogResult.success || dialogResult.data?.canceled || !dialogResult.data?.filePaths?.[0]) {
        return;
      }

      const res = await skillHub.importLocalSkill.invoke({ sourcePath: dialogResult.data.filePaths[0] });
      if (res.success && res.data) {
        const importedSkillName = res.data.skillName;
        Message.success(
          t('settings.skill.importSuccess', {
            name: importedSkillName,
            defaultValue: `已导入技能：${importedSkillName}`,
          })
        );
        await fetchInstalledSkills();
        // Refresh installed list
        const listRes = await skillHub.getInstalledSkills.invoke();
        if (listRes.success && listRes.data) {
          setInstalledList(listRes.data);
        }
        // Open standalone audit report modal (just the audit summary, not the full detail page)
        setAuditReportSkillName(importedSkillName);
        setAuditReportVisible(true);
      } else {
        Message.error(
          t('settings.skill.importFailed', {
            msg: res.msg || 'Unknown error',
            defaultValue: `导入失败: ${res.msg || '未知错误'}`,
          })
        );
      }
    } catch (err) {
      console.error('Failed to import local skill:', err);
      Message.error(
        t('settings.skill.importFailed', {
          msg: String(err),
          defaultValue: `导入失败: ${String(err)}`,
        })
      );
    }
  }, [fetchInstalledSkills, t]);

  // ---- Fetch latest versions ----
  const fetchLatestVersions = useCallback(async (skillList: ISkillHubSkill[], existingMap?: Map<string, SkillLatestVersion>) => {
    const versionMap = existingMap ? new Map(existingMap) : new Map<string, SkillLatestVersion>();
    const toFetch = skillList.filter((s) => !versionMap.has(s.id));
    if (toFetch.length === 0) {
      setLatestVersions(versionMap);
      return;
    }

    const batchSize = 5;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (skill) => {
          try {
            let res: SkillDetailResponse;
            if (isElectronDesktop()) {
              res = await skillHub.fetchSkillDetail.invoke({ skillId: skill.id });
            } else {
              res = await fetchSkillDetailHttp(skill.id);
            }
            if (res.success && res.data?.versions?.[0]) {
              const latest = res.data.versions[0];
              return {
                skillId: skill.id,
                versionInfo: {
                  version: latest.version,
                  sourceUrl: latest.source_url,
                  checksum: latest.checksum,
                } as SkillLatestVersion,
              };
            }
          } catch {
            // ignore
          }
          return null;
        })
      );
      for (const r of results) {
        if (r) versionMap.set(r.skillId, r.versionInfo);
      }
    }
    setLatestVersions(versionMap);
  }, []);

  // ---- Fetch skills list ----
  // Reads selectedCategory / searchQuery / latestVersions from refs so this callback is stable.
  // Only recreated when fetchLatestVersions or t change (both are stable).
  const fetchSkills = useCallback(
    async (cursor?: string, append = false) => {
      try {
        if (append) setLoadingMore(true);
        else setLoading(true);

        // Always read the CURRENT values from refs — no stale-closure risk
        const category = selectedCategoryRef.current === 'all' ? '' : selectedCategoryRef.current;
        const query = searchQueryRef.current.trim();
        const tenantId = currentTenantId;

        if (activeTab === 'exclusive' && !tenantId) {
          setSkills([]);
          setNextCursor(null);
          setHasMore(false);
          return;
        }

        let skillsRes: IBridgeResponse<ISkillHubListResponse>;
        if (isElectronDesktop()) {
          skillsRes = await skillHub.fetchSkills.invoke({ cursor, limit: 40, query, category, tenantId });
        } else {
          skillsRes = await fetchSkillsHttp({ cursor, limit: 40, query, category, tenantId });
        }

        if (skillsRes.success && skillsRes.data) {
          const newSkills = skillsRes.data.skills || [];
          if (append) {
            setSkills((prev) => {
              const existingIds = new Set(prev.map((s) => s.id));
              const unique = newSkills.filter((s) => !existingIds.has(s.id));
              return [...prev, ...unique];
            });
          } else {
            setSkills(newSkills);
          }

          const raw = skillsRes.data as unknown as Record<string, unknown>;
          let nextCursorValue: string | null = null;
          if (typeof skillsRes.data.next_cursor === 'string' && skillsRes.data.next_cursor.length > 0) {
            nextCursorValue = skillsRes.data.next_cursor;
          } else if (typeof raw.nextCursor === 'string' && (raw.nextCursor as string).length > 0) {
            nextCursorValue = raw.nextCursor as string;
          }

          const hasMoreValue = skillsRes.data.has_more === true || raw.hasMore === true;
          setNextCursor(nextCursorValue);
          setHasMore(hasMoreValue);
          // Use ref so latestVersions not needed in deps
          void fetchLatestVersions(newSkills, append ? latestVersionsRef.current : undefined);
        }
      } catch (err) {
        console.error('Failed to fetch skills:', err);
        Message.error(t('settings.skill.fetchFailed', { defaultValue: '获取技能失败' }));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    // Minimal stable deps — selectedCategory/searchQuery/latestVersions read from refs
    [activeTab, currentTenantId, fetchLatestVersions, t]
  );

  // ---- Load more ----
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && nextCursor) {
      void fetchSkills(nextCursor, true);
    }
  }, [loadingMore, hasMore, nextCursor, fetchSkills]);

  // Keep a ref so IntersectionObserver callback (created once) always calls the latest loadMore
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // ---- Scroll handler (fallback for when inner AionScrollArea is the scroll container) ----
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const { scrollTop, scrollHeight, clientHeight } = target;
      if (scrollHeight - scrollTop - clientHeight < 100) loadMore();
    },
    [loadMore]
  );

  // ---- Helper: find the nearest scrollable ancestor ----
  const findScrollParent = useCallback((el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const { overflowY } = window.getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  }, []);

  // ---- IntersectionObserver: fires when the sentinel at the bottom of the list enters view ----
  // Only set up when a real scrollable ancestor exists. If none is found (e.g. page mode
  // with overflow-visible), skip — the scroll handler fallback still works.
  // Re-runs when hasMore changes because the sentinel mounts/unmounts conditionally.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const root = findScrollParent(sentinel);
    // Without a scrollable root the observer would use the viewport, causing
    // the sentinel to be perpetually "visible" and triggering infinite loads.
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current();
      },
      { root, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [findScrollParent, hasMore]);

  // Reload when category changes — fetchSkills is now stable so no infinite loop
  useEffect(() => {
    if (activeTab === 'installed') return;
    setSkills([]);
    setNextCursor(null);
    setHasMore(false);
    void fetchSkills();
    void fetchInstalledSkills();
  }, [activeTab, selectedCategory, fetchSkills, fetchInstalledSkills]);

  // Debounced search reload
  useEffect(() => {
    if (activeTab === 'installed') return;
    const timer = setTimeout(() => {
      setSkills([]);
      setNextCursor(null);
      setHasMore(false);
      void fetchSkills();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, searchQuery, fetchSkills]);

  // Fetch categories on mount
  useEffect(() => {
    const fetchCategoriesData = async () => {
      try {
        let res: { success: boolean; data?: string[] };
        if (isElectronDesktop()) {
          res = await skillHub.fetchCategories.invoke();
        } else {
          res = await fetchCategoriesHttp();
        }
        if (res.success && res.data) setCategories(res.data);
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      }
    };
    void fetchCategoriesData();
  }, []);

  // Refresh installed skills once when the page opens
  useEffect(() => {
    void fetchInstalledList();
  }, [fetchInstalledList]);

  // Load installed list when switching to installed tab
  useEffect(() => {
    if (activeTab === 'installed') {
      void fetchInstalledList();
    }
  }, [activeTab, fetchInstalledList]);

  // Fetch latest hub versions for installed hub skills so we can detect updates
  useEffect(() => {
    if (installedList.length === 0) return;
    const hubInstalled = installedList.filter((s) => s.isHubInstalled && s.meta?.id);
    if (hubInstalled.length === 0) return;

    // Build minimal synthetic skill objects so we can reuse fetchLatestVersions
    const syntheticSkills = hubInstalled.map(
      (s) =>
        ({
          id: s.meta!.id,
          name: s.name,
        }) as ISkillHubSkill
    );
    void fetchLatestVersions(syntheticSkills, latestVersionsRef.current);
  }, [installedList, fetchLatestVersions]);

  // ---- Install handler ----
  const handleInstall = useCallback(
    async (skillId: string) => {
      if (!isElectronDesktop()) {
        Message.warning(t('settings.skill.desktopOnly', { defaultValue: '技能安装仅在桌面端可用' }));
        return;
      }
      const skill = skills.find((s) => s.id === skillId);
      const versionInfo = latestVersions.get(skillId);
      if (!skill || !versionInfo) return;

      setInstallingSkillId(skillId);
      setInstallProgress(0);
      try {
        const res = await skillHub.downloadAndInstallSkill.invoke({
          skillName: skill.name,
          displayName: skill.display_name,
          sourceUrl: versionInfo.sourceUrl,
          version: versionInfo.version,
          checksum: versionInfo.checksum,
          // Pass full skill object so metadata can be persisted to _sudowork_meta.json
          skillMeta: skill,
        });
        if (res.success && res.data) {
          Message.success(
            t('settings.skill.installSuccess', {
              name: skill.display_name,
              version: versionInfo.version,
              defaultValue: `成功安装 ${skill.display_name} ${versionInfo.version}`,
            })
          );
          await fetchInstalledSkills();
          await fetchInstalledList();
        } else {
          Message.error(
            t('settings.skill.installFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: `安装失败: ${res.msg || '未知错误'}`,
            })
          );
        }
      } catch (err) {
        console.error('Failed to install skill:', err);
        Message.error(`安装失败: ${err}`);
      } finally {
        setInstallingSkillId(null);
        setInstallProgress(0);
      }
    },
    [skills, latestVersions, fetchInstalledSkills, fetchInstalledList, t]
  );

  const handleDownloadZip = useCallback(
    async (skillId: string) => {
      const skill = skills.find((s) => s.id === skillId);
      const versionInfo = latestVersions.get(skillId);
      if (!skill || !versionInfo) return;

      if (!isElectronDesktop()) {
        window.open(versionInfo.sourceUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      setDownloadingSkillId(skillId);
      try {
        const res = await skillHub.downloadSkillZip.invoke({
          skillName: skill.name,
          version: versionInfo.version,
          sourceUrl: versionInfo.sourceUrl,
          checksum: versionInfo.checksum,
        });
        if (res.success && res.data) {
          Message.success(
            t('settings.skill.downloadSuccess', {
              name: skill.display_name,
              defaultValue: `已下载 ${skill.display_name} 到本地`,
            })
          );
        } else {
          Message.error(
            t('settings.skill.downloadFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: `下载失败: ${res.msg || '未知错误'}`,
            })
          );
        }
      } catch (err) {
        console.error('Failed to download skill zip:', err);
        Message.error(
          t('settings.skill.downloadFailed', {
            msg: String(err),
            defaultValue: `下载失败: ${String(err)}`,
          })
        );
      } finally {
        setDownloadingSkillId(null);
      }
    },
    [skills, latestVersions, t]
  );

  // ---- Uninstall handler ----
  const handleUninstall = useCallback(
    async (skillName: string) => {
      if (!isElectronDesktop()) return;
      setUninstallingSkillName(skillName);
      try {
        const res = await skillHub.uninstallSkill.invoke({ skillName });
        if (res.success) {
          Message.success(`已卸载技能：${skillName}`);
          await fetchInstalledSkills();
          await fetchInstalledList();
          // Close detail modal if showing this skill
          if (detailSkill?.name === skillName) {
            setDetailVisible(false);
          }
        } else {
          Message.error(`卸载失败: ${res.msg || '未知错误'}`);
        }
      } catch (err) {
        console.error('Failed to uninstall skill:', err);
        Message.error(`卸载失败: ${err}`);
      } finally {
        setUninstallingSkillName(null);
      }
    },
    [fetchInstalledSkills, fetchInstalledList, detailSkill]
  );

  // ---- Update handler (reuses install flow to replace installed skill with newer version) ----
  const handleUpdate = useCallback(
    async (skillId: string, skillName?: string, skillMeta?: ISkillHubMeta) => {
      if (!isElectronDesktop()) return;

      const versionInfo = latestVersions.get(skillId);
      if (!versionInfo) return;

      // Resolve skill name and meta from either the store list or the installed list
      const storeSkill = skills.find((s) => s.id === skillId);
      const installedSkill = installedList.find((s) => s.meta?.id === skillId);
      const resolvedName = skillName || storeSkill?.name || installedSkill?.name;
      const resolvedDisplayName = storeSkill?.display_name || installedSkill?.meta?.display_name || resolvedName || '';

      if (!resolvedName) return;

      setUpdatingSkillId(skillId);
      setInstallProgress(0);
      try {
        const res = await skillHub.downloadAndInstallSkill.invoke({
          skillName: resolvedName,
          displayName: resolvedDisplayName,
          sourceUrl: versionInfo.sourceUrl,
          version: versionInfo.version,
          checksum: versionInfo.checksum,
          skillMeta: storeSkill || (skillMeta as unknown as ISkillHubSkill),
        });
        if (res.success && res.data) {
          Message.success(
            t('settings.skill.updateSuccess', {
              name: resolvedDisplayName,
              version: versionInfo.version,
              defaultValue: `已更新 ${resolvedDisplayName} 至 v${versionInfo.version}`,
            })
          );
          await fetchInstalledSkills();
          await fetchInstalledList();
        } else {
          Message.error(
            t('settings.skill.updateFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: `更新失败: ${res.msg || '未知错误'}`,
            })
          );
        }
      } catch (err) {
        console.error('Failed to update skill:', err);
        Message.error(
          t('settings.skill.updateFailed', {
            msg: String(err),
            defaultValue: `更新失败: ${String(err)}`,
          })
        );
      } finally {
        setUpdatingSkillId(null);
        setInstallProgress(0);
      }
    },
    [skills, installedList, latestVersions, fetchInstalledSkills, fetchInstalledList, t]
  );

  const handleToggleSkillEnabled = useCallback(
    async (skillName: string, enabled: boolean) => {
      if (!isElectronDesktop()) return;
      setTogglingSkillName(skillName);
      try {
        const res = await skillHub.setSkillEnabled.invoke({ skillName, enabled });
        if (res.success) {
          Message.success(enabled ? t('settings.skill.enableSuccess', { name: skillName, defaultValue: `已启用技能：${skillName}` }) : t('settings.skill.disableSuccess', { name: skillName, defaultValue: `已禁用技能：${skillName}` }));
          await fetchInstalledList();
        } else {
          Message.error(
            t('settings.skill.toggleEnabledFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: `技能状态更新失败: ${res.msg || '未知错误'}`,
            })
          );
        }
      } catch (err) {
        console.error('Failed to toggle skill enabled state:', err);
        Message.error(
          t('settings.skill.toggleEnabledFailed', {
            msg: String(err),
            defaultValue: `技能状态更新失败: ${String(err)}`,
          })
        );
      } finally {
        setTogglingSkillName(null);
      }
    },
    [fetchInstalledList, t]
  );

  // ---- Open detail modal ----
  const openDetail = useCallback((skill: ISkillHubSkill) => {
    setDetailSkill(skill);
    setDetailVisible(true);
  }, []);

  // ---- Handle "Go Use" button click ----
  const handleGoUse = useCallback(() => {
    if (!detailSkill) return;
    // Close the modal first
    setDetailVisible(false);
    // Navigate to guid page with skill parameter
    void navigate(`/guid?skill=${encodeURIComponent(detailSkill.name)}`);
  }, [detailSkill, navigate]);

  // ==================== Render ====================

  const detailIsInstalled = detailSkill ? installedSkills.has(detailSkill.name) : false;
  // Hub-installed = in installedList and has isHubInstalled flag
  const detailIsHubInstalled = detailSkill ? (installedList.find((s) => s.name === detailSkill.name)?.isHubInstalled ?? false) : false;
  const detailLatestVersion = detailSkill ? latestVersions.get(detailSkill.id) : undefined;
  const detailHasVersion = !!detailLatestVersion;
  const customInstalledSkills = installedList.filter((skill) => !skill.isBuiltin && skill.meta?.source_type === 'upload');
  const hubInstalledSkills = installedList.filter((skill) => !skill.isBuiltin && (!skill.meta?.source_type || skill.meta?.source_type === 'hub'));
  const builtinInstalledSkills = installedList.filter((skill) => skill.isBuiltin);

  const renderInstalledSkillGrid = (skillList: IInstalledSkillInfo[]) => (
    <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {skillList.map((skill) => {
        const skillHubId = skill.meta?.id;
        const latestVer = skillHubId ? latestVersions.get(skillHubId) : undefined;
        const installedVer = normalizeSkillVersion(skill.version);
        const skillHasUpdate = skill.isHubInstalled && !!latestVer && (!installedVer || latestVer.version !== installedVer);
        return (
          <InstalledSkillCard
            key={skill.name}
            skill={skill}
            onUninstall={() => void handleUninstall(skill.name)}
            uninstalling={uninstallingSkillName === skill.name}
            onToggleEnabled={(enabled) => void handleToggleSkillEnabled(skill.name, enabled)}
            togglingEnabled={togglingSkillName === skill.name}
            hasUpdate={skillHasUpdate}
            onUpdate={() => skillHubId && void handleUpdate(skillHubId, skill.name, skill.meta)}
            updating={updatingSkillId === skillHubId}
            onClick={
              skill.meta
                ? () => {
                    setInstalledDetailInfo(skill);
                    setInstalledDetailVisible(true);
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );

  return (
    <div ref={containerRef} className='flex flex-col h-full w-full'>
      {/* Header: tabs + search + create button */}
      <div className='flex items-center gap-12px mb-12px'>
        {/* Tab switcher */}
        <div className='flex items-center bg-fill-2 rd-8px p-2px gap-1px flex-shrink-0'>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'store' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('store')}>
            {t('settings.skill.storeTab', { defaultValue: '技能库' })}
          </button>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'exclusive' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('exclusive')}>
            {t('settings.skill.exclusiveTab', { defaultValue: '专属技能' })}
          </button>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'installed' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('installed')}>
            {t('settings.skill.installedTab', { defaultValue: '我的技能' })}
            {getInstalledSkillBadgeCount(installedList) > 0 && <span className='ml-5px px-5px py-0px bg-primary text-white text-10px rd-full leading-16px'>{getInstalledSkillBadgeCount(installedList)}</span>}
          </button>
        </div>

        {/* Search - always rendered to preserve layout, hidden on installed tab */}
        <div className={classNames('flex-1 min-w-0 transition-opacity duration-150', activeTab === 'installed' ? 'opacity-0 pointer-events-none' : '')}>
          <Input placeholder={t('settings.skill.searchPlaceholder', { defaultValue: '搜索技能库...' })} value={searchQuery} onChange={setSearchQuery} prefix={<Search size='14' className='text-t-tertiary' />} size='small' className='skill-hub-input' />
        </div>
        {activeTab === 'installed' && isElectronDesktop() && (
          <button type='button' className='group h-34px px-4 py-0 border border-solid rd-999px flex items-center gap-8px flex-shrink-0 cursor-pointer transition-all outline-none bg-[color-mix(in_srgb,var(--color-fill-2)_84%,transparent)] border-[color-mix(in_srgb,var(--color-border-2)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary-light-1)_58%,transparent)] hover:border-[color-mix(in_srgb,var(--color-primary)_36%,transparent)]' onClick={() => void handleImportLocalSkill()}>
            <span className='w-22px h-22px rd-full flex items-center justify-center bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-primary)] transition-transform group-hover:scale-105'>
              <UploadOne size='13' />
            </span>
            <span className='flex items-baseline gap-5px leading-none'>
              <span className='text-12px font-medium text-t-primary'>{t('common.upload', { defaultValue: '上传' })}</span>
              <span className='text-11px text-t-secondary'>{t('settings.customSkills', { defaultValue: 'Custom Skills' })}</span>
            </span>
          </button>
        )}
      </div>

      {/* ===== STORE TAB ===== */}
      {(activeTab === 'store' || activeTab === 'exclusive') && (
        <>
          {/* Category filter */}
          <div className='flex gap-6px mb-14px overflow-x-auto pb-2px flex-shrink-0 scrollbar-hide'>
            {[{ key: 'all', label: t('settings.skill.allCategories', { defaultValue: '精选' }) }, ...categories.map((c) => ({ key: c, label: c }))].map(({ key, label }) => (
              <span key={key} className={classNames('px-12px py-4px rd-16px text-12px cursor-pointer transition-colors whitespace-nowrap flex-shrink-0', selectedCategory === key ? 'bg-primary text-white' : 'bg-fill-2 text-t-secondary hover:bg-fill-3 hover:text-t-primary')} onClick={() => setSelectedCategory(key)}>
                {label}
              </span>
            ))}
          </div>

          {/* Skill grid */}
          <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode} onScroll={handleScroll}>
            {activeTab === 'exclusive' && !enterpriseCode ? (
              <div className='flex flex-col items-center justify-center py-48px text-t-secondary gap-8px'>
                <Shield size='32' className='text-t-tertiary' />
                <span className='text-13px'>{t('settings.skill.noEnterpriseCode', { defaultValue: '当前账号没有企业编码，无法加载专属技能。' })}</span>
              </div>
            ) : loading || !installedSkillsReady ? (
              <div className='flex justify-center items-center py-48px'>
                <Spin size={28} />
              </div>
            ) : skills.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-48px text-t-secondary gap-8px'>
                <Lightning size='32' className='text-t-tertiary' />
                <span className='text-13px'>{t('settings.skill.noResults', { defaultValue: '暂无技能' })}</span>
              </div>
            ) : (
              <div className='grid grid-cols-2 gap-8px pb-16px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {skills.map((skill) => {
                  const isInstalled = installedSkills.has(skill.name);
                  const hasVersion = latestVersions.has(skill.id);
                  const isInstalling = installingSkillId === skill.id;
                  const isUpdating = updatingSkillId === skill.id;
                  const installedVer = normalizeSkillVersion(installedSkills.get(skill.name));
                  const latestVer = latestVersions.get(skill.id);
                  const skillHasUpdate = isInstalled && !!latestVer && (!installedVer || latestVer.version !== installedVer);
                  return (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      isInstalled={isInstalled}
                      hasVersion={hasVersion}
                      installing={isInstalling}
                      installProgress={installProgress}
                      onInstall={(e) => {
                        e.stopPropagation();
                        void handleInstall(skill.id);
                      }}
                      onClick={() => openDetail(skill)}
                      hasUpdate={skillHasUpdate}
                      onUpdate={(e) => {
                        e.stopPropagation();
                        void handleUpdate(skill.id);
                      }}
                      updating={isUpdating}
                    />
                  );
                })}
              </div>
            )}

            {/* Loading skeleton cards — match grid layout for a seamless feel */}
            {loadingMore && (
              <div className='grid gap-8px pb-16px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
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
            {/* Sentinel for IntersectionObserver — triggers loadMore when scrolled into view */}
            {hasMore && <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />}
          </AionScrollArea>
        </>
      )}

      {/* ===== INSTALLED TAB ===== */}
      {activeTab === 'installed' && (
        <>
          {/* Installed grid */}
          <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
            {installedLoading ? (
              <div className='flex justify-center items-center py-48px'>
                <Spin size={28} />
              </div>
            ) : installedList.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-48px gap-8px'>
                <Lightning size='32' className='text-t-tertiary' />
                <div className='text-13px text-t-secondary'>{t('settings.skill.noInstalledSkills', { defaultValue: '暂无已安装的技能' })}</div>
                <div className='text-12px text-t-tertiary'>{t('settings.skill.noInstalledSkillsHint', { defaultValue: '前往技能库安装你需要的技能' })}</div>
                <Button size='small' type='outline' className='mt-4px' onClick={() => setActiveTab('store')}>
                  {t('settings.skill.browseStore', { defaultValue: '浏览技能库' })}
                </Button>
              </div>
            ) : (
              <div className='pb-16px space-y-20px'>
                <section>
                  <div className='flex items-center justify-between gap-8px mb-10px'>
                    <div className='text-13px font-medium text-t-primary'>{t('settings.customSkills')}</div>
                    <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{customInstalledSkills.length}</span>
                  </div>
                  {customInstalledSkills.length > 0 ? renderInstalledSkillGrid(customInstalledSkills) : <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noCustomSkills')}</div>}
                </section>

                <section>
                  <div className='flex items-center justify-between gap-8px mb-10px'>
                    <div className='text-13px font-medium text-t-primary'>{t('settings.hubSkills', { defaultValue: 'Hub Skills' })}</div>
                    <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{hubInstalledSkills.length}</span>
                  </div>
                  {hubInstalledSkills.length > 0 ? renderInstalledSkillGrid(hubInstalledSkills) : <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noHubSkills', { defaultValue: 'No hub-installed skills' })}</div>}
                </section>

                <section>
                  <div className='flex items-center justify-between gap-8px mb-10px'>
                    <div className='text-13px font-medium text-t-primary'>{t('settings.builtinSkills')}</div>
                    <span className='px-6px py-0px bg-fill-2 text-t-secondary text-11px rd-full leading-18px'>{builtinInstalledSkills.length}</span>
                  </div>
                  {builtinInstalledSkills.length > 0 ? renderInstalledSkillGrid(builtinInstalledSkills) : <div className='bg-fill-1 border border-dashed border-line rd-12px px-14px py-18px text-12px text-t-tertiary'>{t('settings.noBuiltinSkills')}</div>}
                </section>
              </div>
            )}
          </AionScrollArea>
        </>
      )}

      {/* Store skill detail modal */}
      <SkillDetailModal
        skill={detailSkill}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        isInstalled={detailIsInstalled}
        isHubInstalled={detailIsHubInstalled}
        hasVersion={detailHasVersion}
        latestVersionInfo={detailLatestVersion}
        installing={installingSkillId === detailSkill?.id}
        downloading={downloadingSkillId === detailSkill?.id}
        installProgress={installProgress}
        onInstall={() => detailSkill && void handleInstall(detailSkill.id)}
        onDownload={() => detailSkill && void handleDownloadZip(detailSkill.id)}
        onUninstall={() => detailSkill && void handleUninstall(detailSkill.name)}
        uninstalling={uninstallingSkillName === detailSkill?.name}
        onGoUse={handleGoUse}
        onUpdate={() => detailSkill && void handleUpdate(detailSkill.id)}
        updating={detailSkill ? updatingSkillId === detailSkill.id : false}
        installedVersion={detailSkill ? normalizeSkillVersion(installedSkills.get(detailSkill.name)) : undefined}
        auditSkillName={detailSkill && detailIsInstalled ? detailSkill.name : undefined}
        onViewAuditDetails={(name) => {
          setAuditDetailSkillName(name);
          setAuditDetailVisible(true);
        }}
      />

      {/* Installed skill detail modal — data from local _sudowork_meta.json */}
      {(() => {
        const installedDetailHubId = installedDetailInfo?.meta?.id;
        const installedDetailLatestVer = installedDetailHubId ? latestVersions.get(installedDetailHubId) : undefined;
        const installedDetailInstalledVer = normalizeSkillVersion(installedDetailInfo?.version);
        const installedDetailHasUpdate = !!installedDetailInfo?.isHubInstalled && !!installedDetailLatestVer && (!installedDetailInstalledVer || installedDetailLatestVer.version !== installedDetailInstalledVer);
        return (
          <SkillDetailModal
            skill={installedDetailInfo?.meta ? installedInfoToSkill(installedDetailInfo) : null}
            visible={installedDetailVisible}
            onClose={() => {
              setInstalledDetailVisible(false);
              setInstalledDetailInfo(null);
            }}
            isInstalled
            isHubInstalled={installedDetailInfo?.isHubInstalled ?? false}
            hasVersion={false}
            latestVersionInfo={installedDetailLatestVer}
            installing={false}
            downloading={false}
            installProgress={0}
            onInstall={() => {}}
            onDownload={() => {}}
            onUninstall={() => installedDetailInfo && void handleUninstall(installedDetailInfo.name)}
            uninstalling={installedDetailInfo ? uninstallingSkillName === installedDetailInfo.name : false}
            onGoUse={
              installedDetailInfo
                ? () => {
                    setInstalledDetailVisible(false);
                    void navigate(`/guid?skill=${encodeURIComponent(installedDetailInfo.name)}`);
                  }
                : undefined
            }
            onUpdate={() => installedDetailHubId && void handleUpdate(installedDetailHubId, installedDetailInfo?.name, installedDetailInfo?.meta)}
            updating={installedDetailHubId ? updatingSkillId === installedDetailHubId : false}
            installedVersion={installedDetailInstalledVer}
            skipApiFetch
            hideActions={!installedDetailHasUpdate && !installedDetailInfo?.isHubInstalled}
            auditSkillName={installedDetailInfo?.name}
            onViewAuditDetails={(name) => {
              setAuditDetailSkillName(name);
              setAuditDetailVisible(true);
            }}
          />
        );
      })()}

      {/* Standalone audit report modal — shown after importing a custom skill */}
      <SkillAuditReportModal
        skillName={auditReportSkillName || ''}
        visible={auditReportVisible}
        onClose={() => {
          setAuditReportVisible(false);
          setAuditReportSkillName(null);
        }}
        onViewAuditDetails={(name) => {
          setAuditDetailSkillName(name);
          setAuditDetailVisible(true);
        }}
      />

      {/* Audit detail modal */}
      <SkillAuditDetailModal
        skillName={auditDetailSkillName || ''}
        visible={auditDetailVisible}
        onClose={() => {
          setAuditDetailVisible(false);
          setAuditDetailSkillName(null);
        }}
      />
    </div>
  );
};

export default SkillModalContent;
