/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '../settingsViewContext';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spin, Message, Input, Select, Progress } from '@arco-design/web-react';
import { Down, Install, Search, Star, Check } from '@icon-park/react';
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
  const response = await fetch('/api/skill-hub/categories');
  return response.json();
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

  return (
    <div className='bg-fill-1 rd-16px p-16px cursor-pointer hover:bg-fill-2 transition border border-line'>
      <div className='flex justify-between items-start' onClick={onToggle}>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-8px flex-wrap'>
            <span className='font-medium text-16px text-t-primary'>
              {skill.display_name} {skill.emoji || ''}
            </span>
            {isInstalled && (
              <span className='flex items-center gap-4px px-8px py-2px bg-primary-light text-primary text-12px rd-4px'>
                <Check size='12' />
                {t('settings.skill.installed', { defaultValue: 'Installed' })}
                {installedVersion !== 'unknown' && ` ${installedVersion}`}
              </span>
            )}
          </div>
          <div className='text-14px text-t-secondary mt-4px line-clamp-2'>{skill.description}</div>
          <div className='text-13px text-t-secondary mt-4px'>{skill.category || '-'}</div>
        </div>
        <div className='flex items-center gap-8px ml-8px flex-shrink-0'>
          {/* Install/Update button */}
          {latestVersionInfo && !isInstalled && (
            installing ? (
              <div className='w-100px'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : (
              <Button
                type='primary'
                size='small'
                icon={<Install size='14' />}
                onClick={(e) => {
                  e.stopPropagation();
                  onInstall();
                }}
              >
                {t('settings.skill.install', { defaultValue: 'Install' })}
              </Button>
            )
          )}
          {hasUpdate && (
            installing ? (
              <div className='w-100px'>
                <Progress percent={installProgress} size='small' />
              </div>
            ) : (
              <Button
                size='small'
                icon={<Install size='14' />}
                onClick={(e) => {
                  e.stopPropagation();
                  onInstall();
                }}
              >
                {t('settings.skill.update', { defaultValue: 'Update' })}
              </Button>
            )
          )}
          <div className='flex items-center gap-4px text-t-secondary text-14px'>
            <Star theme='filled' size='16' fill='#f59e0b' />
            <span>{skill.star_count}</span>
          </div>
          <span className={classNames('transition-transform text-t-secondary text-20px', isExpanded && 'rotate-180')}>
            <Down size='20' />
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className='mt-12px pt-12px border-t border-line'>
          {loading ? (
            <div className='flex justify-center py-16px'>
              <Spin />
            </div>
          ) : detail ? (
            <div className='space-y-8px text-14px'>
              <div>
                <span className='font-semibold text-t-secondary'>{t('settings.skill.homepage', { defaultValue: 'Homepage' })}: </span>
                {detail.skill.homepage ? (
                  <a href={detail.skill.homepage} target='_blank' rel='noopener noreferrer' className='text-primary hover:underline'>
                    {detail.skill.homepage}
                  </a>
                ) : (
                  <span className='text-t-tertiary'>-</span>
                )}
              </div>

              {detail.versions.length > 0 && (
                <div className='flex items-start gap-8px flex-wrap'>
                  <span className='font-semibold text-t-secondary flex-shrink-0'>{t('settings.skill.versions', { defaultValue: 'Versions' })}:</span>
                  <div className='flex flex-wrap gap-8px'>
                    {detail.versions.map((v) => (
                      <Button key={v.id} size='small' onClick={(e) => { e.stopPropagation(); }} icon={isInstalled && v.version === installedVersion ? <Check size='14' /> : <Install size='14' />} className='bg-fill-1 border-border-2'>
                        {v.version}
                        {isInstalled && v.version === installedVersion && ` (${t('settings.skill.current', { defaultValue: 'current' })})`}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className='text-center text-t-tertiary py-16px'>{t('settings.skill.loadFailed', { defaultValue: 'Failed to load details' })}</div>
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

  // Fetch latest version for each skill (append to existing map)
  const fetchLatestVersions = useCallback(async (skillList: ISkillHubSkill[], existingMap?: Map<string, SkillLatestVersion>) => {
    const versionMap = existingMap ? new Map(existingMap) : new Map<string, SkillLatestVersion>();

    // Only fetch for skills that don't have version info yet
    const skillsToFetch = skillList.filter(s => !versionMap.has(s.id));
    if (skillsToFetch.length === 0) {
      setLatestVersions(versionMap);
      return;
    }

    // Fetch details in parallel with a limit of 5 concurrent requests
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

  // Fetch skills (initial or load more)
  const fetchSkills = useCallback(async (cursor?: string, append = false) => {
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
          setSkills(prev => [...prev, ...newSkills]);
        } else {
          setSkills(newSkills);
        }
        setNextCursor(skillsRes.data.next_cursor || null);
        setHasMore(skillsRes.data.has_more || false);
        // Fetch latest versions for new skills
        fetchLatestVersions(newSkills, append ? latestVersions : undefined);
      }
    } catch (err) {
      console.error('Failed to fetch skills:', err);
      Message.error(t('settings.skill.fetchFailed', { defaultValue: 'Failed to fetch skills' }));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedCategory, searchQuery, fetchLatestVersions, latestVersions, t]);

  // Load more skills
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && nextCursor) {
      fetchSkills(nextCursor, true);
    }
  }, [loadingMore, hasMore, nextCursor, fetchSkills]);

  // Handle scroll for infinite scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    // Load more when user scrolls to within 100px of the bottom
    if (scrollHeight - scrollTop - clientHeight < 100) {
      loadMore();
    }
  }, [loadMore]);

  // Initial load and when filters change
  useEffect(() => {
    setSkills([]);
    setNextCursor(null);
    setHasMore(false);
    fetchSkills();
    void fetchInstalledSkills();
  }, [selectedCategory]); // Re-fetch when category changes

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSkills([]);
      setNextCursor(null);
      setHasMore(false);
      fetchSkills();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]); // Re-fetch when search query changes

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
        Message.warning(t('settings.skill.desktopOnly', { defaultValue: 'Skill installation is only available in desktop app' }));
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
          Message.success(t('settings.skill.installSuccess', { name: skill.display_name, version: versionInfo.version, defaultValue: `Successfully installed ${skill.display_name} ${versionInfo.version}` }));
          // Refresh installed skills
          await fetchInstalledSkills();
        } else {
          Message.error(t('settings.skill.installFailed', { msg: res.msg || 'Unknown error', defaultValue: `Installation failed: ${res.msg || 'Unknown error'}` }));
        }
      } catch (err) {
        console.error('Failed to install skill:', err);
        Message.error(t('settings.skill.installFailed', { msg: String(err), defaultValue: `Installation failed: ${err}` }));
      } finally {
        setInstallingSkillId(null);
        setInstallProgress(0);
      }
    },
    [skills, latestVersions, fetchInstalledSkills, t]
  );

  const categoryOptions = useMemo(() => {
    return [{ label: t('settings.skill.allCategories', { defaultValue: 'All Categories' }), value: 'all' }, ...categories.map((cat) => ({ label: cat || t('settings.skill.uncategorized', { defaultValue: 'Uncategorized' }), value: cat || '' }))];
  }, [categories, t]);

  return (
    <div className='flex flex-col h-full w-full'>
      {/* Header */}
      <div className='text-center mb-16px'>
        <h2 className='text-20px font-bold text-t-primary'>Skill Hub</h2>
      </div>

      {/* Search & Filter */}
      <div className='flex gap-8px mb-16px items-center'>
        <Input placeholder={t('settings.skill.searchPlaceholder', { defaultValue: 'Search...' })} value={searchQuery} onChange={setSearchQuery} prefix={<Search size='16' className='text-t-secondary' />} className='flex-1 skill-hub-input' />
        <Select value={selectedCategory} onChange={setSelectedCategory} className='w-140px flex-shrink-0 skill-hub-select'>
          {categoryOptions.map((opt) => (
            <Select.Option key={opt.value} value={opt.value}>
              {opt.label}
            </Select.Option>
          ))}
        </Select>
      </div>

      {/* List */}
      <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode} onScroll={handleScroll}>
        {loading ? (
          <div className='flex justify-center items-center py-48px'>
            <Spin size={32} />
          </div>
        ) : skills.length === 0 ? (
          <div className='p-16px text-center text-t-secondary'>{t('settings.skill.noResults', { defaultValue: 'No skills found' })}</div>
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
                <span className='text-12px text-t-tertiary'>{t('settings.skill.scrollForMore', { defaultValue: 'Scroll for more' })}</span>
              </div>
            )}
          </div>
        )}
      </AionScrollArea>
    </div>
  );
};

export default SkillModalContent;
