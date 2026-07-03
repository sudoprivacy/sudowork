/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spin, Message, Input, Modal, Tooltip } from '@arco-design/web-react';
import { IconSearch } from '@arco-design/web-react/icon';
import { X, Shield, Zap, Upload, Share2, Plus, Check } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Tabs from '@renderer/components/ui/Tabs';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { ipcBridge } from '@/common';
import { parseHubError, type HubError } from '@common/nexus/hubErrors';
import HubEmptyState from '@renderer/components/HubEmptyState';
import { eeclaw, skillHub } from '@/common/ipcBridge';
import { normalizeSkillVersion } from '@/renderer/utils/skillDisplay';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { addEventListener, emitter } from '@/renderer/utils/emitter';
import type { ISkillHubSkill, ISkillHubListResponse, IInstalledSkillInfo, ISkillHubMeta } from '@/common/ipcBridge';
import { useAuth } from '@/renderer/context/AuthContext';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { SkillAuditDetailModal } from './components/SkillAuditReport';
import { SkillAuditReportModal } from './components/SkillAuditReportModal';
import SkillCard from './components/SkillCard';
import InstalledSkillCard from './components/InstalledSkillCard';
import SkillDetailModal from './components/SkillDetailModal';
import { installedInfoToSkill, resolveSkillTenantId, getLocalSkillImportDialogOptions, getInstalledSkillBadgeCount, fetchSkillsHttp, fetchCategoriesHttp, fetchSkillDetailHttp, VERSION_CACHE_TTL } from './utils';
import type { IBridgeResponse, SkillLatestVersion, SkillDetailResponse, SkillStoreTab, LocalSkillImportSource } from './types';

// ==================== Main Component ====================

const SkillSettings: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
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
  // Typed error from last fetchSkills — drives HubEmptyState (token
  // missing vs network failure vs actually-empty). See hubErrors.ts.
  const [hubError, setHubError] = useState<HubError | null>(null);

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
  /** Track skill IDs that are currently fetching version info (for loading state in SkillCard) */
  const [loadingVersionIds, setLoadingVersionIds] = useState<Set<string>>(new Set());

  // Installed tab state
  const [installedList, setInstalledList] = useState<IInstalledSkillInfo[]>([]);
  const [installedListRevision, setInstalledListRevision] = useState(0);
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
  const [importSourceVisible, setImportSourceVisible] = useState(false);

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

  // Keep fetchSkills stable: read current activeTab/currentTenantId from refs instead of the closure
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const currentTenantIdRef = useRef(currentTenantId);
  currentTenantIdRef.current = currentTenantId;

  // Enterprise mode detection - use useAppMode hook for renderer process
  const { isEnterprise } = useAppMode();

  // Upload/Publish state for enterprise mode
  const [publishingSkillName, setPublishingSkillName] = useState<string | null>(null);

  // Track if sync has been triggered for current tab session (avoid loop)
  const syncTriggeredRef = useRef(false);
  // Skip the debounced-search effect's first mount run — initial load is handled by the category-change effect
  const searchInitializedRef = useRef(false);

  // Sync status state
  const [syncStatus, setSyncStatus] = useState<{
    syncing: boolean;
    skills: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> };
    assistants: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> };
  }>({ syncing: false, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });

  // ---- Fetch installed skills ----
  const fetchInstalledSkills = useCallback(async () => {
    if (!isElectronDesktop()) {
      setInstalledSkillsReady(true);
      return;
    }

    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        const map = new Map<string, string>();
        for (const s of res.data) {
          if (s.meta?.source_type === 'hub' || (!s.meta?.source_type && s.isHubInstalled)) {
            map.set(s.name, s.version);
            if (s.meta?.id) {
              map.set(s.meta.id, s.version);
            }
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
    if (!isElectronDesktop()) {
      setInstalledSkillsReady(true);
      return;
    }
    setInstalledLoading(true);
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        setInstalledList(res.data);
        setInstalledListRevision((revision) => revision + 1);
      }
    } catch (err) {
      console.error('Failed to fetch installed list:', err);
    } finally {
      setInstalledLoading(false);
      setInstalledSkillsReady(true);
    }
  }, []);

  // ---- Enterprise mode: Upload custom skill to Moss Server ----
  const handleUploadCustomSkill = useCallback(
    async (skill: IInstalledSkillInfo): Promise<{ success: boolean; msg?: string }> => {
      if (!isElectronDesktop()) return { success: false, msg: 'Not desktop' };

      const skillName = skill.name;
      const displayName = skill.meta?.display_name || skillName;
      const description = skill.meta?.description || '';

      try {
        const res = await eeclaw.uploadCustomSkill.invoke({ skillName, displayName, description });
        if (res.success && res.data) {
          Message.success(
            t('settings.skill.uploadSuccess', {
              name: skillName,
              defaultValue: '技能 "{{name}}" 已上传到服务器',
            })
          );
          // Update local meta to mark as uploaded
          await fetchInstalledList();
          return { success: true };
        } else {
          return { success: false, msg: res.msg || 'Unknown error' };
        }
      } catch (err) {
        console.error('Failed to upload custom skill:', err);
        return { success: false, msg: String(err) };
      }
    },
    [fetchInstalledList, t]
  );

  const handleImportLocalSkill = useCallback(
    async (source?: LocalSkillImportSource) => {
      if (!isElectronDesktop()) return;

      try {
        const dialogResult = await ipcBridge.dialog.showOpen.invoke(getLocalSkillImportDialogOptions(source));

        if (!dialogResult.success || dialogResult.data?.canceled || !dialogResult.data?.filePaths?.[0]) {
          return;
        }

        const res = await skillHub.importLocalSkill.invoke({ sourcePath: dialogResult.data.filePaths[0] });
        if (res.success && res.data) {
          const importedSkillName = res.data.skillName;
          Message.success(
            t('settings.skill.importSuccess', {
              name: importedSkillName,
              defaultValue: '已导入技能：{{name}}',
            })
          );
          await fetchInstalledSkills();
          await fetchInstalledList();
          emitter.emit('skills.changed');
          // Open standalone audit report modal (just the audit summary, not the full detail page)
          setAuditReportSkillName(importedSkillName);
          setAuditReportVisible(true);

          // Enterprise mode: sync upload to Moss Server after import
          if (isEnterprise) {
            const installedRes = await skillHub.getInstalledSkills.invoke();
            if (installedRes.success && installedRes.data) {
              const newSkill = installedRes.data.find((s) => s.name === importedSkillName);
              if (newSkill) {
                const uploadRes = await handleUploadCustomSkill(newSkill);
                if (!uploadRes.success) {
                  Message.error(
                    t('settings.skill.uploadFailed', {
                      msg: uploadRes.msg,
                      defaultValue: '上传失败: {{msg}}',
                    })
                  );
                }
              }
            }
          }
        } else {
          Message.error(
            t('settings.skill.importFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: '导入失败: {{msg}}',
            })
          );
        }
      } catch (err) {
        console.error('Failed to import local skill:', err);
        Message.error(
          t('settings.skill.importFailed', {
            msg: String(err),
            defaultValue: '导入失败: {{msg}}',
          })
        );
      }
    },
    [fetchInstalledSkills, fetchInstalledList, t, isEnterprise, handleUploadCustomSkill]
  );

  const onImportButtonClick = useCallback(() => {
    setImportSourceVisible(true);
  }, []);

  // ---- Enterprise mode: Publish skill as tenant-exclusive ----
  const handlePublishTenantSkill = useCallback(
    async (skillId: string, skillName: string) => {
      if (!isElectronDesktop()) return;

      setPublishingSkillName(skillName);
      try {
        const res = await eeclaw.publishTenantSkill.invoke({ skillId });
        if (res.success && res.data) {
          Message.success(
            t('settings.skill.publishSuccess', {
              name: skillName,
              defaultValue: '技能 "{{name}}" 已提交发布申请，等待管理员审批',
            })
          );
          await fetchInstalledList();
        } else {
          Message.error(
            t('settings.skill.publishFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: '发布失败: {{msg}}',
            })
          );
        }
      } catch (err) {
        console.error('Failed to publish tenant skill:', err);
        Message.error(
          t('settings.skill.publishFailed', {
            msg: String(err),
            defaultValue: '发布失败: {{msg}}',
          })
        );
      } finally {
        setPublishingSkillName(null);
      }
    },
    [fetchInstalledList, t]
  );

  // ---- Enterprise mode: Install tenant skill ----
  // ---- Fetch latest versions ----
  // Only used in personal mode to check for skill updates
  // Enterprise mode doesn't need this - versions are managed by Moss Server
  const fetchLatestVersions = useCallback(
    async (skillList: ISkillHubSkill[], existingMap?: Map<string, SkillLatestVersion>) => {
      // Skip in enterprise mode
      if (isEnterprise) {
        return existingMap || new Map<string, SkillLatestVersion>();
      }

      const now = Date.now();
      const versionMap = existingMap ? new Map(existingMap) : new Map<string, SkillLatestVersion>();

      // Filter skills that need fetching: not in cache OR cache expired
      const toFetch = skillList.filter((s) => {
        const cached = versionMap.get(s.id);
        if (!cached) return true;
        // Check if cache is expired (older than VERSION_CACHE_TTL)
        return now - cached.fetchedAt > VERSION_CACHE_TTL;
      });

      if (toFetch.length === 0) {
        setLatestVersions(versionMap);
        return versionMap;
      }

      // Mark skills as loading
      const idsToFetch = toFetch.map((s) => s.id);
      setLoadingVersionIds((prev) => {
        const next = new Set(prev);
        idsToFetch.forEach((id) => next.add(id));
        return next;
      });

      try {
        const batchSize = 10;
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
                      fetchedAt: Date.now(),
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
        return versionMap;
      } finally {
        // Clear loading state for all fetched skills
        setLoadingVersionIds((prev) => {
          const next = new Set(prev);
          idsToFetch.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [isEnterprise]
  );

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
        const tenantId = currentTenantIdRef.current;

        if (activeTabRef.current === 'exclusive' && !tenantId) {
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
          setHubError(null);
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
          void fetchLatestVersions(newSkills, append ? latestVersionsRef.current : undefined);
        } else if (!skillsRes.success) {
          // Typed bridge failure (token missing / fetch fail) — drive
          // differentiated empty state via HubEmptyState rather than
          // showing the generic "未找到技能" text that hides the cause.
          setHubError(parseHubError(skillsRes as { success: false; errorCode?: string; msg?: string }));
          if (!append) setSkills([]);
        }
      } catch (err) {
        console.error('Failed to fetch skills:', err);
        setHubError({ code: 'FETCH_FAILED', message: err instanceof Error ? err.message : String(err), retriable: true });
        Message.error(t('settings.skill.fetchFailed', '获取技能失败'));
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
    setLatestVersions(new Map());
    setNextCursor(null);
    setHasMore(false);
    void fetchSkills();
    void fetchInstalledSkills();
  }, [activeTab, selectedCategory, fetchInstalledSkills, fetchSkills]);

  // Debounced search reload
  useEffect(() => {
    if (!searchInitializedRef.current) {
      searchInitializedRef.current = true;
      return;
    }
    if (activeTabRef.current === 'installed') return;
    const timer = setTimeout(() => {
      setSkills([]);
      setLatestVersions(new Map());
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

  // Refresh installed skills once when the page opens
  useEffect(() => {
    void fetchInstalledList();
  }, [fetchInstalledList]);

  // Refresh installed skills after agent-created skill changes.
  useEffect(() => {
    if (!isElectronDesktop()) return;

    const refreshInstalledList = () => {
      void fetchInstalledList();
    };

    const removeSkillHubChanged = skillHub.changed.on(refreshInstalledList);
    const removeSkillsChanged = addEventListener('skills.changed', refreshInstalledList);

    return () => {
      removeSkillHubChanged();
      removeSkillsChanged();
    };
  }, [fetchInstalledList]);

  // Listen for sync completed event (enterprise mode)
  useEffect(() => {
    if (!isEnterprise || !isElectronDesktop()) return;

    const handleSyncCompleted = (data: {
      skills: { hub: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> }; tenant: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> } };
      assistants: { hub: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> }; tenant: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> } };
    }) => {
      // Merge hub and tenant results for display
      const mergedSkills = {
        installed: [...data.skills.hub.installed, ...data.skills.tenant.installed],
        skipped: [...data.skills.hub.skipped, ...data.skills.tenant.skipped],
        deleted: [...data.skills.hub.deleted, ...data.skills.tenant.deleted],
        failed: [...data.skills.hub.failed, ...data.skills.tenant.failed],
      };
      const mergedAssistants = {
        installed: [...data.assistants.hub.installed, ...data.assistants.tenant.installed],
        skipped: [...data.assistants.hub.skipped, ...data.assistants.tenant.skipped],
        deleted: [...data.assistants.hub.deleted, ...data.assistants.tenant.deleted],
        failed: [...data.assistants.hub.failed, ...data.assistants.tenant.failed],
      };
      setSyncStatus({ syncing: false, skills: mergedSkills, assistants: mergedAssistants });
      // Refresh installed list after sync
      void fetchInstalledList();
    };

    const unsubscribe = eeclaw.syncCompleted.on(handleSyncCompleted);
    return () => unsubscribe();
  }, [isEnterprise, fetchInstalledList]);

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
    setSyncStatus({ syncing: true, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });

    eeclaw.syncFromRemote
      .invoke()
      .then((res) => {
        if (!res.success) {
          // Sync failed, reset status (syncCompleted event won't be emitted)
          console.error('Sync failed:', res.msg);
          setSyncStatus({ syncing: false, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });
        }
        // If success, syncCompleted event will be emitted and handled separately
      })
      .catch((err) => {
        console.error('Failed to trigger sync:', err);
        setSyncStatus({ syncing: false, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });
      });
  }, [isEnterprise, activeTab]);

  // Load installed list when switching to installed tab
  useEffect(() => {
    if (activeTab === 'installed') {
      void fetchInstalledList();
    }
  }, [activeTab, fetchInstalledList]);

  // Fetch latest hub versions for installed hub skills so we can detect updates
  // Only in personal mode (not enterprise) - enterprise mode doesn't interact with SkillHub
  useEffect(() => {
    if (isEnterprise) return; // Skip in enterprise mode
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
  }, [isEnterprise, installedList, fetchLatestVersions]);

  // ---- Install handler ----
  const handleInstall = useCallback(
    async (skillId: string) => {
      if (!isElectronDesktop()) {
        Message.warning(t('settings.skill.desktopOnly', '技能安装仅在桌面端可用'));
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
              defaultValue: '成功安装 {{name}} {{version}}',
            })
          );
          await fetchInstalledSkills();
          await fetchInstalledList();
          emitter.emit('skills.changed');
        } else {
          Message.error(
            t('settings.skill.installFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: '安装失败: {{msg}}',
            })
          );
        }
      } catch (err) {
        console.error('Failed to install skill:', err);
        Message.error(
          t('settings.skill.installFailed', {
            msg: String(err),
            defaultValue: '安装失败: {{msg}}',
          })
        );
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
              defaultValue: '已下载 {{name}} 到本地',
            })
          );
        } else {
          Message.error(
            t('settings.skill.downloadFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: '下载失败: {{msg}}',
            })
          );
        }
      } catch (err) {
        console.error('Failed to download skill zip:', err);
        Message.error(
          t('settings.skill.downloadFailed', {
            msg: String(err),
            defaultValue: '下载失败: {{msg}}',
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
    async (skillName: string, category?: 'custom' | 'hub' | 'system' | 'tenant') => {
      if (!isElectronDesktop()) return;
      setUninstallingSkillName(skillName);
      try {
        const res = await skillHub.uninstallSkill.invoke({ skillName, category });
        if (res.success) {
          Message.success(
            t('settings.skill.uninstallSuccess', {
              name: skillName,
              defaultValue: '已卸载技能：{{name}}',
            })
          );
          await fetchInstalledSkills();
          await fetchInstalledList();
          emitter.emit('skills.changed');
          // Close detail modal if showing this skill
          if (detailSkill?.name === skillName) {
            setDetailVisible(false);
          }
        } else {
          Message.error(
            t('settings.skill.uninstallFailed', {
              msg: res.msg || '未知错误',
              defaultValue: '卸载失败: {{msg}}',
            })
          );
        }
      } catch (err) {
        console.error('Failed to uninstall skill:', err);
        Message.error(
          t('settings.skill.uninstallFailed', {
            msg: String(err),
            defaultValue: '卸载失败: {{msg}}',
          })
        );
      } finally {
        setUninstallingSkillName(null);
      }
    },
    [fetchInstalledSkills, fetchInstalledList, detailSkill, t]
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
              defaultValue: '已更新 {{name}} 至 v{{version}}',
            })
          );
          await fetchInstalledSkills();
          await fetchInstalledList();
          emitter.emit('skills.changed');
        } else {
          Message.error(
            t('settings.skill.updateFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: '更新失败: {{msg}}',
            })
          );
        }
      } catch (err) {
        console.error('Failed to update skill:', err);
        Message.error(
          t('settings.skill.updateFailed', {
            msg: String(err),
            defaultValue: '更新失败: {{msg}}',
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
    async (skillName: string, enabled: boolean, category?: 'custom' | 'hub' | 'system' | 'tenant') => {
      if (!isElectronDesktop()) return;
      setTogglingSkillName(skillName);
      try {
        const res = await skillHub.setSkillEnabled.invoke({ skillName, enabled, category });
        if (res.success) {
          Message.success(enabled ? t('settings.skill.enableSuccess', { name: skillName, defaultValue: '已启用技能：{{name}}' }) : t('settings.skill.disableSuccess', { name: skillName, defaultValue: '已禁用技能：{{name}}' }));
          await fetchInstalledList();
          emitter.emit('skills.changed');
        } else {
          Message.error(
            t('settings.skill.toggleEnabledFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: '技能状态更新失败: {{msg}}',
            })
          );
        }
      } catch (err) {
        console.error('Failed to toggle skill enabled state:', err);
        Message.error(
          t('settings.skill.toggleEnabledFailed', {
            msg: String(err),
            defaultValue: '技能状态更新失败: {{msg}}',
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

  const findInstalledHubSkillInfo = (skill: Pick<ISkillHubSkill, 'id' | 'name'>) => installedList.find((installedSkill) => (installedSkill.meta?.id && installedSkill.meta.id === skill.id) || installedSkill.name === skill.name);

  const detailIsInstalled = detailSkill ? installedSkills.has(detailSkill.name) || installedSkills.has(detailSkill.id) : false;
  // Hub-installed = in installedList and has isHubInstalled flag
  const detailIsHubInstalled = detailSkill ? (findInstalledHubSkillInfo(detailSkill)?.isHubInstalled ?? false) : false;
  const detailLatestVersion = detailSkill ? latestVersions.get(detailSkill.id) : undefined;
  const detailHasVersion = !!detailLatestVersion;

  // ===== 分类逻辑：以目录分类（category）为主，source_type 仅作兼容兜底 =====
  // Tenant skills: 目录分类为 tenant
  const localTenantSkills = installedList.filter((skill) => skill.category === 'tenant');
  // Filter tenant skills by search query
  const filteredTenantSkills = searchQuery.trim()
    ? localTenantSkills.filter((skill) => {
        const displayName = skill.meta?.display_name || skill.meta?.name || skill.name;
        const description = skill.meta?.description || '';
        const query = searchQuery.trim().toLowerCase();
        const matches = displayName.toLowerCase().includes(query) || description.toLowerCase().includes(query);
        console.log('[Tenant Skill Filter]', { name: skill.name, displayName, description, query, matches });
        return matches;
      })
    : localTenantSkills;
  // Hub skills: 目录分类为 hub（source_type 仅作兼容兜底）
  const hubInstalledSkills = installedList.filter((skill) => skill.category === 'hub' || (!skill.category && !skill.isBuiltin && (skill.meta?.source_type === 'hub' || skill.isHubInstalled)));
  // Custom skills: 目录分类为 custom（source_type 仅作兼容兜底）
  const customInstalledSkills = installedList.filter((skill) => skill.category === 'custom' || (!skill.category && !skill.isBuiltin && skill.meta?.source_type === 'upload'));
  // Builtin skills: 目录分类为 system 或 isBuiltin 为 true
  const builtinInstalledSkills = installedList.filter((skill) => skill.category === 'system' || skill.isBuiltin);

  const renderInstalledSkillGrid = (skillList: IInstalledSkillInfo[], hideUninstall = false) => (
    <div className='grid gap-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {skillList.map((skill) => {
        const skillHubId = skill.meta?.id;
        const latestVer = skillHubId ? latestVersions.get(skillHubId) : undefined;
        const installedVer = normalizeSkillVersion(skill.version);
        const skillHasUpdate = skill.isHubInstalled && !!latestVer && (!installedVer || latestVer.version !== installedVer);
        // Pass category to handlers for precise skill location
        const skillCategory = skill.category as 'custom' | 'hub' | 'system' | 'tenant' | undefined;
        return (
          <InstalledSkillCard
            key={`${skill.name}:${installedListRevision}`}
            skill={skill}
            onUninstall={() => void handleUninstall(skill.name, skillCategory)}
            uninstalling={uninstallingSkillName === skill.name}
            onToggleEnabled={(enabled) => void handleToggleSkillEnabled(skill.name, enabled, skillCategory)}
            togglingEnabled={togglingSkillName === skill.name}
            hasUpdate={skillHasUpdate}
            onUpdate={() => skillHubId && void handleUpdate(skillHubId, skill.name, skill.meta)}
            updating={updatingSkillId === skillHubId}
            hideUninstall={hideUninstall}
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

  // Render custom skills with enterprise action buttons (publish only, auto-upload on create)
  const renderCustomSkillGridWithEnterpriseActions = (skillList: IInstalledSkillInfo[]) => (
    <div className='grid gap-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {skillList.map((skill) => {
        const skillHubId = skill.meta?.id;
        const isPublishing = publishingSkillName === skill.name;
        const publishStatus = skill.meta?.publish_status;
        // Custom skills have category 'custom'
        const skillCategory = skill.category as 'custom' | undefined;

        // Enterprise publish button element - placed below delete button
        const enterprisePublishButton =
          isEnterprise && !publishStatus ? (
            <Tooltip content={t('settings.skill.publishAsTenant', '发布为专属技能')}>
              <button
                className='store-action-icon'
                onClick={(e) => {
                  e.stopPropagation();
                  if (skillHubId) void handlePublishTenantSkill(skillHubId, skill.name);
                }}
                disabled={isPublishing || !skillHubId}
              >
                {isPublishing ? <Spin size={12} /> : <Share2 size={12} />}
              </button>
            </Tooltip>
          ) : isEnterprise && publishStatus === 'pending' ? (
            <Tooltip content={t('settings.skill.publishPending', '发布审批中')}>
              <span className='store-action-badge'>{t('settings.skill.publishPendingShort', '审核中')}</span>
            </Tooltip>
          ) : isEnterprise && publishStatus === 'approved' ? (
            <Tooltip content={t('settings.skill.publishApproved', '已发布为专属技能')}>
              <span className='store-action-badge text-success'>{t('settings.skill.publishedShort', '已发布')}</span>
            </Tooltip>
          ) : undefined;

        return (
          <InstalledSkillCard
            key={`${skill.name}:${installedListRevision}`}
            skill={skill}
            onUninstall={() => void handleUninstall(skill.name, skillCategory)}
            uninstalling={uninstallingSkillName === skill.name}
            onToggleEnabled={(enabled) => void handleToggleSkillEnabled(skill.name, enabled, skillCategory)}
            togglingEnabled={togglingSkillName === skill.name}
            hasUpdate={false}
            onClick={
              skill.meta
                ? () => {
                    setInstalledDetailInfo(skill);
                    setInstalledDetailVisible(true);
                  }
                : undefined
            }
            enterprisePublishButton={enterprisePublishButton}
          />
        );
      })}
    </div>
  );

  return (
    <PageWrapper>
      <div ref={containerRef} className='flex flex-col h-full w-full'>
        {/* Header: tabs + search + create button */}
        <div className='flex items-center gap-24px mb-12px'>
          {/* Tab switcher */}
          <Tabs
            variant='line'
            className='flex-shrink-0'
            value={activeTab}
            onChange={(value) => {
              if (value === 'installed' && activeTab === 'installed') {
                void fetchInstalledList();
                return;
              }
              setActiveTab(value as SkillStoreTab);
            }}
            items={[
              { value: 'store', label: t('settings.skill.storeTab', '技能库') },
              { value: 'exclusive', label: t('settings.skill.exclusiveTab', '专属技能') },
              {
                value: 'installed',
                label: (
                  <span className='f-center'>
                    {t('settings.skill.installedTab', '我的技能')}
                    {getInstalledSkillBadgeCount(installedList) > 0 && <span className='f-center min-w-4 h-4 ml-5px px-1 rd-full bg-primary text-white text-10px leading-4 font-medium'>{getInstalledSkillBadgeCount(installedList)}</span>}
                  </span>
                ),
              },
            ]}
          />

          {/* Sync status indicator for enterprise mode - compact inline style */}
          {isEnterprise && activeTab === 'store' && syncStatus.syncing && (
            <div className='flex items-center gap-6px px-10px py-4px bg-primary-light-1 rd-6px flex-shrink-0'>
              <Spin size={12} />
              <span className='text-11px text-primary'>{t('settings.skill.syncing', '同步中...')}</span>
            </div>
          )}
          {isEnterprise && activeTab === 'store' && !syncStatus.syncing && (syncStatus.skills.installed.length > 0 || syncStatus.skills.failed.length > 0) && (
            <div className='flex items-center gap-6px px-10px py-4px bg-success-light rd-6px flex-shrink-0'>
              <Check size={12} className='text-success' />
              <span className='text-11px text-success'>{t('settings.skill.syncCompleted', '已同步')}</span>
            </div>
          )}

          {/* Search - always rendered to preserve layout, hidden on installed tab */}
          <Input placeholder={t('settings.skill.searchPlaceholder', '搜索...')} value={searchQuery} onChange={setSearchQuery} prefix={<IconSearch style={{ fontSize: 14 }} className='text-tertiary' />} size='small' className={classNames('flex-1 min-w-0', activeTab === 'installed' && 'invisible')} />
          {activeTab === 'installed' && isElectronDesktop() && (
            <button
              type='button'
              className='group h-34px px-4 py-0 border border-solid rd-full flex items-center gap-8px flex-shrink-0 cursor-pointer transition-all outline-none bg-[color-mix(in_srgb,var(--color-fill-2)_84%,transparent)] border-[color-mix(in_srgb,var(--color-border-2)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary-light-1)_58%,transparent)] hover:border-[color-mix(in_srgb,var(--color-primary)_36%,transparent)]'
              onClick={onImportButtonClick}
            >
              <span className='w-22px h-22px rd-full f-center bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-primary)] transition-transform group-hover:scale-105'>{isEnterprise ? <Plus size={13} /> : <Upload size={13} />}</span>
              <span className='flex items-baseline gap-5px leading-none'>
                <span className='text-12px font-medium text-foreground'>{isEnterprise ? t('common.create', '创建') : t('common.upload', '上传')}</span>
                <span className='text-11px text-secondary'>{t('settings.customSkills', '自定义技能')}</span>
              </span>
            </button>
          )}
        </div>

        {/* ===== STORE TAB ===== */}
        {(activeTab === 'store' || activeTab === 'exclusive') && (
          <>
            {/* Category filter */}
            <div className='flex gap-6px mb-14px overflow-x-auto pb-2px flex-shrink-0 scrollbar-hide'>
              {[{ key: 'all', label: t('settings.skill.allCategories', '精选') }, ...categories.map((c) => ({ key: c, label: c }))].map(({ key, label }) => (
                <span key={key} className={classNames('category-chip', selectedCategory === key ? 'category-chip-active' : 'category-chip-idle')} onClick={() => setSelectedCategory(key)}>
                  {label}
                </span>
              ))}
            </div>

            {/* Skill grid */}
            <AionScrollArea className='flex-1 min-h-0' disableOverflow onScroll={handleScroll}>
              {/* Enterprise mode: show tenant skills from local tenant/ directory */}
              {activeTab === 'exclusive' && isEnterprise ? (
                filteredTenantSkills.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-48px text-secondary gap-8px'>
                    <Shield size={32} className='text-tertiary' />
                    <span className='text-13px'>{t('settings.skill.noTenantSkills', '暂无专属技能')}</span>
                  </div>
                ) : (
                  <div className='grid gap-16px pb-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    {filteredTenantSkills.map((skill) => {
                      // Tenant skills have category 'tenant'
                      return (
                        <InstalledSkillCard
                          key={`${skill.name}:${installedListRevision}`}
                          skill={skill}
                          onUninstall={() => void handleUninstall(skill.name, 'tenant')}
                          uninstalling={uninstallingSkillName === skill.name}
                          onToggleEnabled={(enabled) => void handleToggleSkillEnabled(skill.name, enabled, 'tenant')}
                          togglingEnabled={togglingSkillName === skill.name}
                          hasUpdate={false}
                          hideUninstall={true}
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
                )
              ) : activeTab === 'exclusive' && !enterpriseCode ? (
                <div className='flex flex-col items-center justify-center py-48px text-secondary gap-8px'>
                  <Shield size={32} className='text-tertiary' />
                  <span className='text-13px'>{t('settings.skill.noEnterpriseCode', '当前账号没有企业编码，无法加载专属技能。')}</span>
                </div>
              ) : loading || !installedSkillsReady ? (
                <div className='flex justify-center items-center py-48px'>
                  <Spin size={28} />
                </div>
              ) : skills.length === 0 ? (
                hubError ? (
                  <HubEmptyState error={hubError} onRetry={() => void fetchSkills()} />
                ) : (
                  <div className='flex flex-col items-center justify-center py-48px text-secondary gap-8px'>
                    <Zap size={32} className='text-tertiary' />
                    <span className='text-13px'>{t('settings.skill.noResults', '暂无技能')}</span>
                  </div>
                )
              ) : (
                <div className='grid gap-16px pb-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {skills.map((skill) => {
                    const isInstalled = installedSkills.has(skill.name) || installedSkills.has(skill.id);
                    const latestVer = latestVersions.get(skill.id);
                    const hasVersion = !!latestVer;
                    const isLoadingVersion = loadingVersionIds.has(skill.id);
                    const isInstalling = installingSkillId === skill.id;
                    const isUpdating = updatingSkillId === skill.id;
                    const installedVer = normalizeSkillVersion(installedSkills.get(skill.id) || installedSkills.get(skill.name));
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
                        latestVersion={latestVer?.version}
                        loadingVersion={isLoadingVersion}
                      />
                    );
                  })}
                </div>
              )}

              {/* Loading skeleton cards — match grid layout for a seamless feel */}
              {loadingMore && (
                <div className='grid gap-16px pb-16px' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={`skel-${i}`} className='bg-fill-1 rd-12px border p-12px flex items-start gap-12px animate-pulse'>
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
            <AionScrollArea className='flex-1 min-h-0' disableOverflow>
              {installedLoading ? (
                <div className='flex justify-center items-center py-48px'>
                  <Spin size={28} />
                </div>
              ) : installedList.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-48px gap-8px'>
                  <Zap size={32} className='text-tertiary' />
                  <div className='text-13px text-secondary'>{t('settings.skill.noInstalledSkills', '暂无已安装的技能')}</div>
                  <div className='text-12px text-tertiary'>{t('settings.skill.noInstalledSkillsHint', '前往技能库安装你需要的技能')}</div>
                  <Button size='small' type='outline' className='mt-4px' onClick={() => setActiveTab('store')}>
                    {t('settings.skill.browseStore', '浏览技能库')}
                  </Button>
                </div>
              ) : (
                <div className='pb-16px space-y-20px'>
                  <section>
                    <div className='flex items-center justify-between gap-8px mb-10px'>
                      <div className='text-13px font-medium text-foreground'>{t('settings.customSkills', '自定义技能')}</div>
                      <span className='px-6px py-0px bg-fill-2 text-secondary text-11px rd-full leading-18px'>{customInstalledSkills.length}</span>
                    </div>
                    {customInstalledSkills.length > 0 ? (
                      isEnterprise ? (
                        renderCustomSkillGridWithEnterpriseActions(customInstalledSkills)
                      ) : (
                        renderInstalledSkillGrid(customInstalledSkills)
                      )
                    ) : (
                      <div className='bg-fill-1 border border-dashed rd-12px px-14px py-18px text-12px text-secondary f-center'>{t('settings.noCustomSkills', '暂无自定义技能')}</div>
                    )}
                  </section>

                  {/* Tenant skills section - enterprise mode only */}
                  {isEnterprise && (
                    <section>
                      <div className='flex items-center justify-between gap-8px mb-10px'>
                        <div className='text-13px font-medium text-foreground'>{t('settings.tenantSkills', '专属技能')}</div>
                        <span className='px-6px py-0px bg-fill-2 text-secondary text-11px rd-full leading-18px'>{localTenantSkills.length}</span>
                      </div>
                      {localTenantSkills.length > 0 ? renderInstalledSkillGrid(localTenantSkills, true) : <div className='bg-fill-1 border border-dashed rd-12px px-14px py-18px text-12px text-tertiary'>{t('settings.noTenantSkills', '暂无专属技能')}</div>}
                    </section>
                  )}

                  <section>
                    <div className='flex items-center justify-between gap-8px mb-10px'>
                      <div className='text-13px font-medium text-foreground'>{t('settings.hubSkills', '商店技能')}</div>
                      <span className='px-6px py-0px bg-fill-2 text-secondary text-11px rd-full leading-18px'>{hubInstalledSkills.length}</span>
                    </div>
                    {hubInstalledSkills.length > 0 ? renderInstalledSkillGrid(hubInstalledSkills, isEnterprise) : <div className='bg-fill-1 border border-dashed rd-12px px-14px py-18px text-12px text-tertiary'>{t('settings.noHubSkills', '暂无商店安装的技能')}</div>}
                  </section>

                  <section>
                    <div className='flex items-center justify-between gap-8px mb-10px'>
                      <div className='text-13px font-medium text-foreground'>{t('settings.builtinSkills', '内置技能')}</div>
                      <span className='px-6px py-0px bg-fill-2 text-secondary text-11px rd-full leading-18px'>{builtinInstalledSkills.length}</span>
                    </div>
                    {builtinInstalledSkills.length > 0 ? renderInstalledSkillGrid(builtinInstalledSkills) : <div className='bg-fill-1 border border-dashed rd-12px px-14px py-18px text-12px text-tertiary'>{t('settings.noBuiltinSkills', '暂无可用的内置技能')}</div>}
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
          installedVersion={detailSkill ? normalizeSkillVersion(installedSkills.get(detailSkill.id) || installedSkills.get(detailSkill.name)) : undefined}
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

        <Modal visible={importSourceVisible} onCancel={() => setImportSourceVisible(false)} footer={null} closable={false} maskClosable style={{ width: 420 }} className='skill-import-source-modal'>
          <div className='flex flex-col gap-16px'>
            <div className='flex items-center justify-between'>
              <div className='font-semibold text-15px text-foreground'>{t('settings.skill.importSourceTitle', '导入自定义技能')}</div>
              <button type='button' className='w-28px h-28px f-center rd-full bg-fill-2 hover:bg-fill-3 cursor-pointer transition-colors text-secondary border-none outline-none' onClick={() => setImportSourceVisible(false)}>
                <X size={14} />
              </button>
            </div>
            <div className='text-12px text-secondary leading-relaxed'>{t('settings.skill.importSourceDescription', '请选择导入方式。')}</div>
            <div className='grid grid-cols-2 gap-10px'>
              <button
                type='button'
                className='p-14px text-left rd-12px border bg-fill-1 hover:bg-fill-2 cursor-pointer transition-colors outline-none'
                onClick={() => {
                  setImportSourceVisible(false);
                  void handleImportLocalSkill('zip');
                }}
              >
                <div className='font-medium text-13px text-foreground'>{t('settings.skill.importZipOption', '从文件导入')}</div>
                <div className='mt-4px text-11px text-secondary'>{t('settings.skill.importZipOptionDescription', '打开文件选择框，仅显示 zip 文件。')}</div>
              </button>
              <button
                type='button'
                className='p-14px text-left rd-12px border bg-fill-1 hover:bg-fill-2 cursor-pointer transition-colors outline-none'
                onClick={() => {
                  setImportSourceVisible(false);
                  void handleImportLocalSkill('directory');
                }}
              >
                <div className='font-medium text-13px text-foreground'>{t('settings.skill.importFolderOption', '从文件夹导入')}</div>
                <div className='mt-4px text-11px text-secondary'>{t('settings.skill.importFolderOptionDescription', '选择包含 SKILL.md 的技能目录。')}</div>
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </PageWrapper>
  );
};

export default SkillSettings;
