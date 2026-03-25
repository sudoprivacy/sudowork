/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '../settingsViewContext';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spin, Message, Input, Progress } from '@arco-design/web-react';
import { Download, Search, Check } from '@icon-park/react';
import classNames from 'classnames';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { skillHub } from '@/common/ipcBridge';
import type { ISkillHubSkill, ISkillHubVersion, ISkillHubDetail, ISkillHubListResponse } from '@/common/ipcBridge';
import { useTranslation } from 'react-i18next';

// ==================== Types ====================

interface IBridgeResponse<D = unknown> {
  success: boolean;
  data?: D;
  msg?: string;
}

interface InstalledSkill {
  name: string;
  version: string;
}

interface SkillLatestVersion {
  version: string;
  sourceUrl: string;
  checksum: string;
}

// ==================== API Functions ====================

type SkillDetailResponse = { success: boolean; data?: ISkillHubDetail; msg?: string };

async function fetchSkillDetailHttp(skillId: string): Promise<SkillDetailResponse> {
  const response = await fetch(`/api/skill-hub/skills/${skillId}`);
  return response.json();
}

async function fetchSkillsHttp(params: { cursor?: string; limit?: number; query?: string; category?: string }) {
  const searchParams = new URLSearchParams();
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.query) searchParams.set('query', params.query);
  if (params.category) searchParams.set('category', params.category);
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

// ==================== Components ====================

const SkillItem: React.FC<{
  skill: ISkillHubSkill;
  isExpanded: boolean;
  installedVersion?: string;
  latestVersionInfo?: SkillLatestVersion;
  onToggle: () => void;
  onInstall: () => void;
  installing: boolean;
  installProgress: number;
}> = ({ skill, isExpanded, installedVersion, latestVersionInfo, onToggle, onInstall, installing, installProgress }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ISkillHubDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const isInstalled = installedVersion !== undefined;
  const hasUpdate = isInstalled && latestVersionInfo && installedVersion !== latestVersionInfo.version;

  useEffect(() => {
    if (isExpanded && !detail) {
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
  }, [isExpanded, detail, skill.id]);

  const applicableScenarios = parseJsonArray(skill.applicable_scenarios);
  const coreFeatures = parseCoreFeatures(skill.core_features);

  return (
    <div className='bg-fill-1 rd-12px cursor-pointer hover:bg-fill-2 transition border border-line overflow-hidden'>
      {/* Card Header */}
      <div className='flex items-center p-12px gap-12px' onClick={onToggle}>
        {/* Icon */}
        <div className='w-48px h-48px flex-shrink-0 rd-8px overflow-hidden bg-fill-2'>
          {skill.icon ? (
            <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' />
          ) : (
            <div className='w-full h-full flex items-center justify-center text-24px'>{skill.emoji || '📦'}</div>
          )}
        </div>

        {/* Title & Description */}
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-8px flex-wrap'>
            <span className='font-medium text-15px text-t-primary truncate'>{skill.display_name}</span>
            {isInstalled && (
              <span className='flex items-center gap-4px px-6px py-1px bg-primary-light text-primary text-11px rd-4px'>
                <Check size='12' />
                {t('settings.skill.installed', { defaultValue: '已安装' })}
              </span>
            )}
          </div>
          <div className='text-13px text-t-secondary mt-2px line-clamp-1'>{skill.description}</div>
        </div>

        {/* Install/Download Button */}
        <div className='flex-shrink-0'>
          {latestVersionInfo && !isInstalled && (
            installing ? (
              <div className='w-80px'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : (
              <Button
                type='primary'
                size='small'
                icon={<Download size='14' />}
                onClick={(e) => {
                  e.stopPropagation();
                  onInstall();
                }}
              >
                {t('settings.skill.install', { defaultValue: '安装' })}
              </Button>
            )
          )}
          {hasUpdate && (
            installing ? (
              <div className='w-80px'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : (
              <Button
                size='small'
                icon={<Download size='14' />}
                onClick={(e) => {
                  e.stopPropagation();
                  onInstall();
                }}
              >
                {t('settings.skill.update', { defaultValue: '更新' })}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className='border-t border-line bg-fill-2'>
          {loading ? (
            <div className='flex justify-center py-32px'>
              <Spin />
            </div>
          ) : detail ? (
            <div className='p-16px space-y-16px'>
              {/* Header with Icon and Title */}
              <div className='flex items-center gap-12px'>
                <div className='w-56px h-56px flex-shrink-0 rd-10px overflow-hidden bg-fill-1'>
                  {skill.icon ? (
                    <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' />
                  ) : (
                    <div className='w-full h-full flex items-center justify-center text-28px'>{skill.emoji || '📦'}</div>
                  )}
                </div>
                <div>
                  <div className='font-semibold text-18px text-t-primary'>{skill.display_name}</div>
                  {skill.categories && skill.categories.length > 0 && (
                    <div className='flex gap-4px mt-4px flex-wrap'>
                      {skill.categories.map((cat, idx) => (
                        <span key={idx} className='px-6px py-1px bg-fill-1 text-t-secondary text-11px rd-4px'>{cat}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 技能介绍 */}
              <div>
                <div className='font-medium text-14px text-t-primary mb-8px'>{t('settings.skill.introduction', { defaultValue: '技能介绍' })}</div>
                <div className='text-13px text-t-secondary leading-relaxed'>{skill.description}</div>
              </div>

              {/* 怎么使用 */}
              {coreFeatures.length > 0 && (
                <div>
                  <div className='font-medium text-14px text-t-primary mb-8px'>{t('settings.skill.howToUse', { defaultValue: '怎么使用' })}</div>
                  <div className='space-y-6px'>
                    {coreFeatures.map((feature, idx) => (
                      <div key={idx} className='bg-fill-1 rd-6px p-10px'>
                        <div className='font-medium text-13px text-t-primary'>{feature.title}</div>
                        <div className='text-12px text-t-secondary mt-2px'>{feature.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 使用场景 */}
              {applicableScenarios.length > 0 && (
                <div>
                  <div className='font-medium text-14px text-t-primary mb-8px'>{t('settings.skill.scenarios', { defaultValue: '使用场景' })}</div>
                  <div className='space-y-4px'>
                    {applicableScenarios.map((scenario, idx) => (
                      <div key={idx} className='flex items-start gap-6px text-13px text-t-secondary'>
                        <span className='text-primary mt-1px'>•</span>
                        <span>{scenario}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 去使用按钮 */}
              {latestVersionInfo && !isInstalled && (
                <div className='pt-8px'>
                  {installing ? (
                    <div className='w-full'>
                      <Progress percent={installProgress} size='small' />
                    </div>
                  ) : (
                    <Button
                      type='primary'
                      long
                      icon={<Download size='16' />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInstall();
                      }}
                    >
                      {t('settings.skill.goUse', { defaultValue: '去使用' })}
                    </Button>
                  )}
                </div>
              )}
              {hasUpdate && (
                <div className='pt-8px'>
                  {installing ? (
                    <div className='w-full'>
                      <Progress percent={installProgress} size='small' />
                    </div>
                  ) : (
                    <Button
                      long
                      icon={<Download size='16' />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInstall();
                      }}
                    >
                      {t('settings.skill.update', { defaultValue: '更新' })}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className='text-center text-t-tertiary py-32px'>{t('settings.skill.loadFailed', { defaultValue: '加载失败' })}</div>
          )}
        </div>
      )}
    </div>
  );
};

const SkillModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  const [skills, setSkills] = useState<ISkillHubSkill[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [installedSkills, setInstalledSkills] = useState<Map<string, string>>(new Map());
  const [latestVersions, setLatestVersions] = useState<Map<string, SkillLatestVersion>>(new Map());
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);

  // Fetch installed skills
  const fetchInstalledSkills = useCallback(async () => {
    if (!isElectronDesktop()) return;
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        const map = new Map<string, string>();
        for (const skill of res.data) {
          map.set(skill.name, skill.version);
        }
        setInstalledSkills(map);
      }
    } catch (err) {
      console.error('Failed to fetch installed skills:', err);
    }
  }, []);

  // Fetch latest version for each skill
  const fetchLatestVersions = useCallback(async (skillList: ISkillHubSkill[], existingMap?: Map<string, SkillLatestVersion>) => {
    const versionMap = existingMap ? new Map(existingMap) : new Map<string, SkillLatestVersion>();
    const skillsToFetch = skillList.filter((s) => !versionMap.has(s.id));
    if (skillsToFetch.length === 0) {
      setLatestVersions(versionMap);
      return;
    }

    const batchSize = 5;
    for (let i = 0; i < skillsToFetch.length; i += batchSize) {
      const batch = skillsToFetch.slice(i, i + batchSize);
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
          } catch (err) {
            console.error(`Failed to fetch detail for skill ${skill.id}:`, err);
          }
          return null;
        })
      );

      for (const result of results) {
        if (result) {
          versionMap.set(result.skillId, result.versionInfo);
        }
      }
    }

    setLatestVersions(versionMap);
  }, []);

  // Fetch skills
  const fetchSkills = useCallback(
    async (cursor?: string, append = false) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }

        const category = selectedCategory === 'all' ? '' : selectedCategory;
        const query = searchQuery.trim();

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

          const rawData = skillsRes.data as unknown as Record<string, unknown>;
          let nextCursorValue: string | null = null;
          if (typeof skillsRes.data.next_cursor === 'string' && skillsRes.data.next_cursor.length > 0) {
            nextCursorValue = skillsRes.data.next_cursor;
          } else if (typeof rawData.nextCursor === 'string' && (rawData.nextCursor as string).length > 0) {
            nextCursorValue = rawData.nextCursor as string;
          }

          const hasMoreValue = skillsRes.data.has_more === true || rawData.hasMore === true;
          setNextCursor(nextCursorValue);
          setHasMore(hasMoreValue);
          void fetchLatestVersions(newSkills, append ? latestVersions : undefined);
        }
      } catch (err) {
        console.error('Failed to fetch skills:', err);
        Message.error(t('settings.skill.fetchFailed', { defaultValue: '获取技能失败' }));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [selectedCategory, searchQuery, fetchLatestVersions, latestVersions, t]
  );

  // Load more skills
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && nextCursor) {
      void fetchSkills(nextCursor, true);
    }
  }, [loadingMore, hasMore, nextCursor, fetchSkills]);

  // Handle scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const { scrollTop, scrollHeight, clientHeight } = target;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMore();
      }
    },
    [loadMore]
  );

  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPageMode && containerRef.current) {
      let scrollParent: HTMLElement | null = containerRef.current;
      while (scrollParent) {
        const style = window.getComputedStyle(scrollParent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          break;
        }
        scrollParent = scrollParent.parentElement;
      }

      if (scrollParent) {
        const onScroll = () => {
          const { scrollTop, scrollHeight, clientHeight } = scrollParent!;
          if (scrollHeight - scrollTop - clientHeight < 100) {
            loadMore();
          }
        };
        scrollParent.addEventListener('scroll', onScroll);
        return () => scrollParent.removeEventListener('scroll', onScroll);
      }
    }
  }, [isPageMode, loadMore]);

  // Initial load
  useEffect(() => {
    setSkills([]);
    setNextCursor(null);
    setHasMore(false);
    void fetchSkills();
    void fetchInstalledSkills();
  }, [selectedCategory]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSkills([]);
      setNextCursor(null);
      setHasMore(false);
      void fetchSkills();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch categories on mount
  useEffect(() => {
    const fetchCategoriesData = async () => {
      try {
        let categoriesRes: { success: boolean; data?: string[]; msg?: string };
        if (isElectronDesktop()) {
          categoriesRes = await skillHub.fetchCategories.invoke();
        } else {
          categoriesRes = await fetchCategoriesHttp();
        }
        if (categoriesRes.success && categoriesRes.data) {
          setCategories(categoriesRes.data);
        }
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      }
    };
    void fetchCategoriesData();
  }, []);

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
        });

        if (res.success && res.data) {
          Message.success(t('settings.skill.installSuccess', { name: skill.display_name, version: versionInfo.version, defaultValue: `成功安装 ${skill.display_name} ${versionInfo.version}` }));
          await fetchInstalledSkills();
        } else {
          Message.error(t('settings.skill.installFailed', { msg: res.msg || 'Unknown error', defaultValue: `安装失败: ${res.msg || '未知错误'}` }));
        }
      } catch (err) {
        console.error('Failed to install skill:', err);
        Message.error(t('settings.skill.installFailed', { msg: String(err), defaultValue: `安装失败: ${err}` }));
      } finally {
        setInstallingSkillId(null);
        setInstallProgress(0);
      }
    },
    [skills, latestVersions, fetchInstalledSkills, t]
  );

  return (
    <div ref={containerRef} className='flex flex-col h-full w-full'>
      {/* Header */}
      <div className='text-center mb-12px'>
        <h2 className='text-18px font-bold text-t-primary'>{t('settings.skill.title', { defaultValue: '技能商店' })}</h2>
      </div>

      {/* Search */}
      <div className='mb-12px'>
        <Input
          placeholder={t('settings.skill.searchPlaceholder', { defaultValue: '搜索技能...' })}
          value={searchQuery}
          onChange={setSearchQuery}
          prefix={<Search size='16' className='text-t-secondary' />}
          className='skill-hub-input'
        />
      </div>

      {/* Category Tags */}
      <div className='flex gap-6px mb-16px flex-wrap'>
        <span
          className={classNames(
            'px-12px py-6px rd-16px text-13px cursor-pointer transition',
            selectedCategory === 'all'
              ? 'bg-primary text-white'
              : 'bg-fill-2 text-t-secondary hover:bg-fill-3'
          )}
          onClick={() => setSelectedCategory('all')}
        >
          {t('settings.skill.allCategories', { defaultValue: '全部' })}
        </span>
        {categories.map((cat) => (
          <span
            key={cat}
            className={classNames(
              'px-12px py-6px rd-16px text-13px cursor-pointer transition',
              selectedCategory === cat
                ? 'bg-primary text-white'
                : 'bg-fill-2 text-t-secondary hover:bg-fill-3'
            )}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </span>
        ))}
      </div>

      {/* List */}
      <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode} onScroll={handleScroll}>
        {loading ? (
          <div className='flex justify-center items-center py-48px'>
            <Spin size={32} />
          </div>
        ) : skills.length === 0 ? (
          <div className='p-16px text-center text-t-secondary'>{t('settings.skill.noResults', { defaultValue: '暂无技能' })}</div>
        ) : (
          <div className='space-y-8px pb-16px'>
            {skills.map((skill) => (
              <SkillItem
                key={skill.id}
                skill={skill}
                isExpanded={expandedId === skill.id}
                installedVersion={installedSkills.get(skill.name)}
                latestVersionInfo={latestVersions.get(skill.id)}
                onToggle={() => setExpandedId(expandedId === skill.id ? null : skill.id)}
                onInstall={() => handleInstall(skill.id)}
                installing={installingSkillId === skill.id}
                installProgress={installProgress}
              />
            ))}
            {loadingMore && (
              <div className='flex justify-center py-16px'>
                <Spin />
              </div>
            )}
            {!loadingMore && hasMore && (
              <div className='flex justify-center py-8px'>
                <span className='text-12px text-t-tertiary'>{t('settings.skill.scrollForMore', { defaultValue: '下拉加载更多' })}</span>
              </div>
            )}
          </div>
        )}
      </AionScrollArea>
    </div>
  );
};

export default SkillModalContent;