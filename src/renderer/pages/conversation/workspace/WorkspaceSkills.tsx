/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkspaceSkills — renders the "可用技能" tab inside the right-side workspace
 * card. Mirrors the mockup supplied in issue #293:
 *
 *   ┌ ● 可用技能  N  🔁 ┐
 *   │ [🌐 browser] [🐞 chandao-api]   │
 *   │ [📄 docx]    [🖼 image-analysis] │
 *   └─────────────────────────────────┘
 *
 * The skills list is sourced from the workspace's dedicated skills directory:
 *   - OpenClaw agents  → `<workspace>/skills/`
 *   - Claude Code      → `<workspace>/.claude/skills/`
 *
 * Each sub-directory with a SKILL.md (YAML frontmatter with `name` + optional
 * `description`) shows up as a grid card. The list auto-refreshes whenever the
 * inotify bridge fires `dirChanged` on the workspace root, so creating or
 * uninstalling a skill in the workspace updates the panel without a manual
 * reload (matches the behaviour already provided for the file tree).
 */

import { ipcBridge } from '@/common';
import { iconColors } from '@/renderer/theme/colors';
import { Input, Tooltip } from '@arco-design/web-react';
import { Book, Browser, Bug, Code, FileText, FolderOpen, Picture, Refresh, Search, SettingConfig, Tool } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface WorkspaceSkillsProps {
  workspace: string;
  /**
   * Which agent backend is driving this workspace — determines whether skills
   * live under `skills/` (OpenClaw) or `.claude/skills/` (Claude Code). The
   * component always tries both paths so a user can switch agents without
   * losing the card content.
   */
  eventPrefix?: 'acp' | 'openclaw-gateway';
}

interface SkillItem {
  name: string;
  description: string;
  path: string;
  /** Which sub-directory it was found under (for tooltip / debug) */
  source: 'skills' | 'claude-skills';
}

const toSkillsRoot = (workspace: string): string => `${workspace.replace(/\/$/, '')}/skills`;
const toClaudeSkillsRoot = (workspace: string): string => `${workspace.replace(/\/$/, '')}/.claude/skills`;

/**
 * Pick a stable color + icon for a skill name. Uses a tiny hash so that the
 * same skill name always renders the same accent, giving the grid the colourful
 * "icon wall" look from the mockup without shipping a curated icon catalogue.
 */
const SKILL_ACCENTS: Array<{ bg: string; fg: string }> = [
  { bg: 'rgba(22, 93, 255, 0.14)', fg: 'rgb(22, 93, 255)' }, // blue
  { bg: 'rgba(245, 63, 63, 0.14)', fg: 'rgb(245, 63, 63)' }, // red
  { bg: 'rgba(0, 180, 42, 0.14)', fg: 'rgb(0, 180, 42)' }, // green
  { bg: 'rgba(255, 125, 0, 0.14)', fg: 'rgb(255, 125, 0)' }, // orange
  { bg: 'rgba(114, 46, 209, 0.14)', fg: 'rgb(114, 46, 209)' }, // purple
  { bg: 'rgba(19, 194, 194, 0.14)', fg: 'rgb(19, 194, 194)' }, // cyan
  { bg: 'rgba(235, 47, 150, 0.14)', fg: 'rgb(235, 47, 150)' }, // pink
  { bg: 'rgba(250, 173, 20, 0.14)', fg: 'rgb(250, 173, 20)' }, // amber
];

const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
};

const pickAccent = (name: string) => SKILL_ACCENTS[hashString(name) % SKILL_ACCENTS.length];

/**
 * Rough heuristic icon picker — keyword match on the skill name so docx-ish
 * skills get a document icon, image-* get a picture icon, etc. Falls back to
 * a generic "code" icon for everything else, which matches the purple
 * skill-creator entry in the mockup.
 */
const pickIcon = (name: string): React.ComponentType<{ theme?: 'outline' | 'filled' | 'two-tone' | 'multi-color'; size?: string | number; fill?: string | string[] }> => {
  const n = name.toLowerCase();
  if (/image|picture|photo|img/.test(n)) return Picture;
  if (/doc|docx|pdf|ppt|pptx|word|excel|sheet|file|text|md|markdown/.test(n)) return FileText;
  if (/bug|chandao|issue|ticket/.test(n)) return Bug;
  if (/browser|web|http/.test(n)) return Browser;
  if (/book|wiki|note|jianshu|blog/.test(n)) return Book;
  if (/setup|config|setting|install/.test(n)) return SettingConfig;
  if (/skill|creator|wand|magic|tool|mermaid|flow/.test(n)) return Tool;
  if (/folder|dir|workspace/.test(n)) return FolderOpen;
  return Code;
};

const WorkspaceSkills: React.FC<WorkspaceSkillsProps> = ({ workspace, eventPrefix }) => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const reqSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scanBoth = useCallback(async () => {
    if (!workspace) {
      setSkills([]);
      return;
    }
    const mySeq = ++reqSeqRef.current;
    setLoading(true);
    try {
      // Scan both candidate paths so switching agents doesn't empty the panel.
      // OpenClaw-first vs Claude-first ordering only affects visual grouping.
      const primary = eventPrefix === 'openclaw-gateway' ? toSkillsRoot(workspace) : toClaudeSkillsRoot(workspace);
      const secondary = eventPrefix === 'openclaw-gateway' ? toClaudeSkillsRoot(workspace) : toSkillsRoot(workspace);
      const primarySource: SkillItem['source'] = primary.endsWith('/.claude/skills') ? 'claude-skills' : 'skills';
      const secondarySource: SkillItem['source'] = secondary.endsWith('/.claude/skills') ? 'claude-skills' : 'skills';

      const [primaryRes, secondaryRes] = await Promise.all([
        ipcBridge.fs.scanForSkills.invoke({ folderPath: primary }).catch((): undefined => undefined),
        ipcBridge.fs.scanForSkills.invoke({ folderPath: secondary }).catch((): undefined => undefined),
      ]);

      if (reqSeqRef.current !== mySeq) return;

      const collected: SkillItem[] = [];
      const seen = new Set<string>();
      const pushAll = (arr: Array<{ name: string; description: string; path: string }> | undefined, source: SkillItem['source']) => {
        if (!arr) return;
        for (const s of arr) {
          // Deduplicate by lowercased name — if both paths expose the same
          // skill, primary source wins (already processed first).
          const key = s.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push({ ...s, source });
        }
      };
      pushAll(primaryRes?.success ? primaryRes.data : undefined, primarySource);
      pushAll(secondaryRes?.success ? secondaryRes.data : undefined, secondarySource);

      collected.sort((a, b) => a.name.localeCompare(b.name));
      setSkills(collected);
    } finally {
      if (reqSeqRef.current === mySeq) {
        setLoading(false);
      }
    }
  }, [workspace, eventPrefix]);

  // Initial load + reload on workspace / agent switch.
  useEffect(() => {
    void scanBoth();
  }, [scanBoth]);

  // inotify-style auto-refresh: piggyback on the same `dirChanged` stream the
  // file tree listens to. We don't need a separate watcher — the workspace
  // watcher already covers `skills/` and `.claude/skills/`.
  useEffect(() => {
    const unsubscribe = ipcBridge.fileWatch.dirChanged.on(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void scanBoth();
      }, 250);
    });
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      unsubscribe();
    };
  }, [scanBoth]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await scanBoth();
    } finally {
      // Small minimum so the spin animation reads as a deliberate refresh.
      setTimeout(() => setRefreshing(false), 250);
    }
  }, [scanBoth]);

  const filteredSkills = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, searchText]);

  return (
    <div className='workspace-skills'>
      {/* Search + refresh row — matches the mockup's search pill */}
      <div className='workspace-skills__search'>
        <Input
          className='w-full workspace-search-input'
          placeholder={t('conversation.workspace.skillsSearchPlaceholder', { defaultValue: '搜索技能...' })}
          value={searchText}
          onChange={(value) => setSearchText(value)}
          allowClear
          prefix={<Search theme='outline' size='14' fill={iconColors.secondary} />}
        />
        <Tooltip content={t('conversation.workspace.refresh')}>
          <button
            type='button'
            className={`workspace-skills__refresh ${refreshing || loading ? 'workspace-skills__refresh--spinning' : ''}`}
            onClick={handleManualRefresh}
            aria-label={t('conversation.workspace.refresh')}
          >
            <Refresh theme='outline' size='14' fill={iconColors.secondary} />
          </button>
        </Tooltip>
      </div>

      {filteredSkills.length === 0 ? (
        <div className='workspace-card__empty'>
          <div className='workspace-card__empty-icon'>
            <Code theme='outline' size='20' fill='currentColor' />
          </div>
          <div className='workspace-card__empty-title'>
            {searchText
              ? t('conversation.workspace.skillsSearchEmpty', { defaultValue: '未找到匹配的技能' })
              : t('conversation.workspace.skillsEmpty', { defaultValue: '工作空间暂无可用技能' })}
          </div>
          {!searchText && (
            <div className='workspace-card__empty-desc'>
              {eventPrefix === 'openclaw-gateway'
                ? t('conversation.workspace.skillsEmptyDescOpenClaw', { defaultValue: '在 skills/ 目录下添加 SKILL.md 后会自动显示' })
                : t('conversation.workspace.skillsEmptyDescClaude', { defaultValue: '在 .claude/skills/ 目录下添加 SKILL.md 后会自动显示' })}
            </div>
          )}
        </div>
      ) : (
        <div className='workspace-skills__grid'>
          {filteredSkills.map((skill) => {
            const accent = pickAccent(skill.name);
            const Icon = pickIcon(skill.name);
            return (
              <Tooltip key={`${skill.source}:${skill.path}`} content={skill.description || skill.path} position='top' mini>
                <div
                  className='workspace-skill-card'
                  role='button'
                  tabIndex={0}
                  title={skill.description || skill.name}
                >
                  <div className='workspace-skill-card__icon' style={{ background: accent.bg, color: accent.fg }}>
                    <Icon theme='outline' size='14' fill={accent.fg} />
                  </div>
                  <div className='workspace-skill-card__meta'>
                    <div className='workspace-skill-card__name'>{skill.name}</div>
                    {skill.description && <div className='workspace-skill-card__desc'>{skill.description}</div>}
                  </div>
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorkspaceSkills;
