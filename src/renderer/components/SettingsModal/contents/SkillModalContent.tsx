/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '../settingsViewContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spin, Message, Input, Progress, Modal, Select, Popconfirm } from '@arco-design/web-react';
import { Download, Search, Delete, Close, Shield, Lightning } from '@icon-park/react';
import classNames from 'classnames';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { skillHub } from '@/common/ipcBridge';
import type { ISkillHubSkill, ISkillHubDetail, ISkillHubListResponse, IInstalledSkillInfo, ISkillHubMeta } from '@/common/ipcBridge';
import { useTranslation } from 'react-i18next';

// ==================== Helpers ====================

/** Build a synthetic ISkillHubSkill from locally-stored hub metadata */
function metaToSkill(meta: ISkillHubMeta): ISkillHubSkill {
  return {
    id: meta.id,
    name: meta.name,
    display_name: meta.display_name,
    description: meta.description,
    icon: resolveExtensionAssetUrl(meta.icon) || meta.icon,
    emoji: meta.emoji,
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

async function fetchSkillsHttp(params: { cursor?: string; limit?: number; query?: string; category?: string }) {
  const searchParams = new URLSearchParams();
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.query) searchParams.set('query', params.query);
  if (params.category) searchParams.set('categories', params.category);
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

// ==================== SkillCard Component ====================

const SkillCard: React.FC<{
  skill: ISkillHubSkill;
  isInstalled: boolean;
  hasVersion: boolean;
  installing: boolean;
  installProgress: number;
  onInstall: (e: React.MouseEvent) => void;
  onClick: () => void;
}> = ({ skill, isInstalled, hasVersion, installing, installProgress, onInstall, onClick }) => {
  return (
    <div className='bg-fill-1 rd-12px cursor-pointer hover:bg-fill-2 transition-colors border border-line p-12px flex items-start gap-12px relative overflow-hidden' onClick={onClick}>
      {/* Icon */}
      <div className='w-48px h-48px flex-shrink-0 rd-8px overflow-hidden bg-fill-2'>{skill.icon ? <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' /> : <div className='w-full h-full flex items-center justify-center text-22px'>{skill.emoji || '📦'}</div>}</div>

      {/* Content */}
      <div className='flex-1 min-w-0 pr-28px'>
        <div className='flex items-center gap-6px flex-wrap'>
          <span className='font-medium text-13px text-t-primary truncate max-w-full'>{skill.display_name}</span>
          {isInstalled && <span className='px-5px py-0px bg-primary-light text-primary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>已添加</span>}
        </div>
        <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{skill.description}</div>
      </div>

      {/* Action - top right */}
      <div
        className='absolute top-10px right-10px'
        onClick={(e) => {
          e.stopPropagation();
          if (!isInstalled && hasVersion) onInstall(e);
        }}
      >
        {installing ? (
          <div className='w-52px'>
            <Progress percent={installProgress} size='mini' />
          </div>
        ) : !isInstalled && hasVersion ? (
          <div className='w-22px h-22px flex items-center justify-center text-t-tertiary hover:text-primary cursor-pointer transition-colors'>
            <Download size='15' />
          </div>
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
  onClick?: () => void;
}> = ({ skill, onUninstall, uninstalling, onClick }) => {
  const displayName =
    skill.meta?.display_name ||
    skill.name
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const description = skill.meta?.description;
  const icon = resolveExtensionAssetUrl(skill.meta?.icon) || skill.meta?.icon;
  const emoji = skill.meta?.emoji;
  const canUninstall = skill.isHubInstalled && !skill.isBuiltin;
  const hasDetail = !!skill.meta;

  return (
    <div className={classNames('bg-fill-1 rd-12px border border-line p-12px flex items-start gap-12px relative overflow-hidden transition-colors', hasDetail ? 'cursor-pointer hover:bg-fill-2' : 'hover:bg-fill-2')} onClick={hasDetail ? onClick : undefined}>
      {/* Icon */}
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

      {/* Content */}
      <div className='flex-1 min-w-0 pr-28px'>
        <div className='flex items-center gap-6px flex-wrap'>
          <span className='font-medium text-13px text-t-primary truncate'>{displayName}</span>
          {!skill.isBuiltin && <span className='px-5px py-0px bg-fill-3 text-t-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{skill.version}</span>}
        </div>
        {description ? <div className='text-11px text-t-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div> : <div className='text-11px text-t-tertiary mt-3px italic'>{skill.name}</div>}
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
  installProgress: number;
  onInstall: () => void;
  onUninstall: () => void;
  uninstalling: boolean;
  /**
   * When true, skip the remote API fetch for detail.
   * Use this when opening from the installed tab where all data is
   * already available from the locally-stored _sudowork_meta.json.
   */
  skipApiFetch?: boolean;
  /** When true, hide the action buttons area entirely (e.g. when opened from installed tab) */
  hideActions?: boolean;
}> = ({ skill, visible, onClose, isInstalled, isHubInstalled, hasVersion, latestVersionInfo, installing, installProgress, onInstall, onUninstall, uninstalling, skipApiFetch = false, hideActions = false }) => {
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
  const hasUpdate = isInstalled && latestVersionInfo;

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
              </div>
            )}
          </div>
        </AionScrollArea>

        {/* Action buttons — hidden when opened from installed tab */}
        <div className={classNames('px-8px pt-12px border-t border-line mt-4px', hideActions && 'hidden')}>
          <div className='flex gap-8px items-center'>
            {isInstalled ? (
              <>
                <Button type='primary' long size='large' className='flex-1' onClick={onClose}>
                  {t('settings.skill.goUse', { defaultValue: '去使用' })}
                </Button>
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
              <Button type='primary' long size='large' onClick={onInstall}>
                <span className='flex items-center gap-6px justify-center'>
                  <Download size='15' />
                  {t('settings.skill.install', { defaultValue: '安装技能' })}
                </span>
              </Button>
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
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  // Tab state
  const [activeTab, setActiveTab] = useState<'store' | 'installed'>('store');

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
  const [installProgress, setInstallProgress] = useState(0);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<string | null>(null);

  // Installed tab state
  const [installedList, setInstalledList] = useState<IInstalledSkillInfo[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);

  // Installed skill detail modal state (separate from store detail modal)
  const [installedDetailInfo, setInstalledDetailInfo] = useState<IInstalledSkillInfo | null>(null);
  const [installedDetailVisible, setInstalledDetailVisible] = useState(false);

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

  // ---- Fetch installed skills ----
  const fetchInstalledSkills = useCallback(async () => {
    if (!isElectronDesktop()) return;
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        const map = new Map<string, string>();
        for (const s of res.data) map.set(s.name, s.version);
        setInstalledSkills(map);
      }
    } catch (err) {
      console.error('Failed to fetch installed skills:', err);
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

        let skillsRes: IBridgeResponse<ISkillHubListResponse>;
        if (isElectronDesktop()) {
          skillsRes = await skillHub.fetchSkills.invoke({ cursor, limit: 20, query, category });
        } else {
          skillsRes = await fetchSkillsHttp({ cursor, limit: 20, query, category });
        }

        if (skillsRes.success && skillsRes.data) {
          const newSkills = skillsRes.data.skills || [];
          if (append) {
            setSkills((prev) => [...prev, ...newSkills]);
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
    [fetchLatestVersions, t]
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

  // ---- IntersectionObserver: fires when the sentinel at the bottom of the list enters view ----
  // Created once on mount. loadMoreRef.current is always up-to-date so no stale closure.
  // This handles the common case where the user scrolls to the bottom of the skill list
  // regardless of which element (inner grid or outer panel) is the actual scroll container.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // Find the nearest scrollable ancestor to use as the IntersectionObserver root.
    // This ensures the threshold is measured against the actual clipping element,
    // not the viewport, which is more reliable inside a fixed-height modal.
    let root: HTMLElement | null = sentinel.parentElement;
    while (root) {
      const { overflowY } = window.getComputedStyle(root);
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      root = root.parentElement;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current();
      },
      { root: root ?? null, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []); // Empty deps: observer created once; loadMoreRef.current stays fresh

  // ---- Auto-fill: when content doesn't overflow the container, keep loading until it does ----
  // This fixes the large-window case where more columns fit → fewer rows → 20 items don't
  // fill the visible area → user can't scroll → IntersectionObserver never triggers.
  useEffect(() => {
    if (!hasMore || loadingMore || !nextCursor) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // Find the scroll container the sentinel lives in
    let scrollEl: HTMLElement | null = sentinel.parentElement;
    while (scrollEl) {
      const { overflowY } = window.getComputedStyle(scrollEl);
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollEl = scrollEl.parentElement;
    }
    // If there is no overflow (all content visible), load the next page immediately
    if (scrollEl && scrollEl.scrollHeight <= scrollEl.clientHeight) {
      loadMore();
    }
  }, [skills, hasMore, loadingMore, nextCursor, loadMore]);

  // Reload when category changes — fetchSkills is now stable so no infinite loop
  useEffect(() => {
    setSkills([]);
    setNextCursor(null);
    setHasMore(false);
    void fetchSkills();
    void fetchInstalledSkills();
  }, [selectedCategory, fetchSkills, fetchInstalledSkills]);

  // Debounced search reload
  useEffect(() => {
    const timer = setTimeout(() => {
      setSkills([]);
      setNextCursor(null);
      setHasMore(false);
      void fetchSkills();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchSkills]);

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

  // Load installed list when switching to installed tab
  useEffect(() => {
    if (activeTab === 'installed') {
      void fetchInstalledList();
    }
  }, [activeTab]);

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
    [skills, latestVersions, fetchInstalledSkills, t]
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

  // ---- Open detail modal ----
  const openDetail = useCallback((skill: ISkillHubSkill) => {
    setDetailSkill(skill);
    setDetailVisible(true);
  }, []);

  // ==================== Render ====================

  const detailIsInstalled = detailSkill ? installedSkills.has(detailSkill.name) : false;
  // Hub-installed = in installedList and has isHubInstalled flag
  const detailIsHubInstalled = detailSkill ? (installedList.find((s) => s.name === detailSkill.name)?.isHubInstalled ?? false) : false;
  const detailLatestVersion = detailSkill ? latestVersions.get(detailSkill.id) : undefined;
  const detailHasVersion = !!detailLatestVersion;

  return (
    <div ref={containerRef} className='flex flex-col h-full w-full'>
      {/* Header: tabs + search + create button */}
      <div className='flex items-center gap-12px mb-12px'>
        {/* Tab switcher */}
        <div className='flex items-center bg-fill-2 rd-8px p-2px gap-1px flex-shrink-0'>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'store' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('store')}>
            {t('settings.skill.storeTab', { defaultValue: '技能库' })}
          </button>
          <button className={classNames('px-12px py-5px text-13px rd-6px transition-colors cursor-pointer border-none outline-none', activeTab === 'installed' ? 'bg-base text-t-primary font-medium shadow-sm' : 'bg-transparent text-t-secondary hover:text-t-primary')} onClick={() => setActiveTab('installed')}>
            {t('settings.skill.installedTab', { defaultValue: '我的技能' })}
            {installedSkills.size > 0 && <span className='ml-5px px-5px py-0px bg-primary text-white text-10px rd-full leading-16px'>{installedSkills.size}</span>}
          </button>
        </div>

        {/* Search - always rendered to preserve layout, hidden on installed tab */}
        <div className={classNames('flex-1 min-w-0 transition-opacity duration-150', activeTab !== 'store' ? 'opacity-0 pointer-events-none' : '')}>
          <Input placeholder={t('settings.skill.searchPlaceholder', { defaultValue: '搜索技能库...' })} value={searchQuery} onChange={setSearchQuery} prefix={<Search size='14' className='text-t-tertiary' />} size='small' className='skill-hub-input' />
        </div>
      </div>

      {/* ===== STORE TAB ===== */}
      {activeTab === 'store' && (
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
            {loading ? (
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
                    />
                  );
                })}
              </div>
            )}

            {loadingMore && (
              <div className='flex justify-center py-16px'>
                <Spin size={20} />
              </div>
            )}
            {!loadingMore && hasMore && (
              <div className='flex justify-center py-8px'>
                <span className='text-11px text-t-tertiary'>{t('settings.skill.scrollForMore', { defaultValue: '继续滚动加载更多' })}</span>
              </div>
            )}
            {/* Sentinel for IntersectionObserver — triggers loadMore when it enters the viewport */}
            <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />
          </AionScrollArea>
        </>
      )}

      {/* ===== INSTALLED TAB ===== */}
      {activeTab === 'installed' && (
        <>
          {/* Directory info / dropdown */}
          <div className='flex items-center gap-8px mb-14px flex-shrink-0'>
            <div className='flex-1 min-w-0'>
              <Select
                value='default'
                size='small'
                className='w-full'
                placeholder='选择技能目录'
                onChange={() => {
                  // Future: support custom directories
                }}
              >
                <Select.Option value='default'>
                  <span className='text-12px text-t-secondary'>📁 本地技能目录（默认）</span>
                </Select.Option>
              </Select>
            </div>
            <Button size='small' onClick={() => void fetchInstalledList()} icon={<span className='text-11px'>↻</span>}>
              刷新
            </Button>
          </div>

          {/* Installed grid */}
          <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
            {installedLoading ? (
              <div className='flex justify-center items-center py-48px'>
                <Spin size={28} />
              </div>
            ) : installedList.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-48px gap-8px'>
                <Lightning size='32' className='text-t-tertiary' />
                <div className='text-13px text-t-secondary'>暂无已安装的技能</div>
                <div className='text-12px text-t-tertiary'>前往技能库安装你需要的技能</div>
                <Button size='small' type='outline' className='mt-4px' onClick={() => setActiveTab('store')}>
                  浏览技能库
                </Button>
              </div>
            ) : (
              <div className='grid gap-8px pb-16px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {installedList.map((skill) => (
                  <InstalledSkillCard
                    key={skill.name}
                    skill={skill}
                    onUninstall={() => void handleUninstall(skill.name)}
                    uninstalling={uninstallingSkillName === skill.name}
                    onClick={
                      skill.meta
                        ? () => {
                            setInstalledDetailInfo(skill);
                            setInstalledDetailVisible(true);
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </AionScrollArea>
        </>
      )}

      {/* Store skill detail modal */}
      <SkillDetailModal skill={detailSkill} visible={detailVisible} onClose={() => setDetailVisible(false)} isInstalled={detailIsInstalled} isHubInstalled={detailIsHubInstalled} hasVersion={detailHasVersion} latestVersionInfo={detailLatestVersion} installing={installingSkillId === detailSkill?.id} installProgress={installProgress} onInstall={() => detailSkill && void handleInstall(detailSkill.id)} onUninstall={() => detailSkill && void handleUninstall(detailSkill.name)} uninstalling={uninstallingSkillName === detailSkill?.name} />

      {/* Installed skill detail modal — data from local _sudowork_meta.json, no action buttons */}
      <SkillDetailModal
        skill={installedDetailInfo?.meta ? metaToSkill(installedDetailInfo.meta) : null}
        visible={installedDetailVisible}
        onClose={() => {
          setInstalledDetailVisible(false);
          setInstalledDetailInfo(null);
        }}
        isInstalled
        isHubInstalled={false}
        hasVersion={false}
        latestVersionInfo={undefined}
        installing={false}
        installProgress={0}
        onInstall={() => {}}
        onUninstall={() => {}}
        uninstalling={false}
        skipApiFetch
        hideActions
      />
    </div>
  );
};

export default SkillModalContent;
