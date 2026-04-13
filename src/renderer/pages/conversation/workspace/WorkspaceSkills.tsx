/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkspaceSkills — renders the "可用技能" tab inside the right-side workspace
 * card. Visual layout mirrors `components/skill-grid.tsx` from the ui.zip
 * reference: a 2-column grid of `rounded-lg` cards, each with a 32×32 rounded
 * icon square tinted by the skill-author-specified color.
 *
 * Sources:
 *   - OpenClaw agents  → `<workspace>/skills/`
 *   - Claude Code      → `<workspace>/.claude/skills/`
 *
 * Each sub-directory containing a SKILL.md (YAML frontmatter) shows up as a
 * card. The `icon:` and `color:` fields from frontmatter are honoured when
 * present; otherwise we fall back to a keyword-based heuristic so older
 * skills keep their look.
 *
 *   ---
 *   name: browser
 *   description: 浏览器操作
 *   icon: Browser
 *   color: blue
 *   ---
 *
 * The list auto-refreshes on `fileWatch.dirChanged` (inotify bridge), so
 * creating / uninstalling a skill updates the panel without a manual reload.
 * The parent card owns the search input + refresh button, so this component
 * no longer renders its own toolbar — it accepts `searchQuery` via props and
 * reports loading state back via callbacks.
 */

import { ipcBridge } from '@/common';
import { Tooltip } from '@arco-design/web-react';
import { Book, Branch, Browser, Bug, Calendar, Code, FileText, FolderOpen, Picture, SettingConfig, Star, Tool } from '@icon-park/react';
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveSkillIcon } from '@/renderer/utils/skillDisplay';
import { resolveWorkspaceSkillRoot } from './skillRoots';

type IconComponent = React.ComponentType<{ theme?: 'outline' | 'filled' | 'two-tone' | 'multi-color'; size?: string | number; fill?: string | string[] }>;

export interface WorkspaceSkillsProps {
  workspace: string;
  /**
   * Which agent backend is driving this workspace — determines whether skills
   * live under `skills/` (OpenClaw / non-Claude ACP) or `.claude/skills/`
   * (Claude Code).
   */
  eventPrefix?: 'acp' | 'openclaw-gateway';
  backend?: string;
  /** Shared search query from the workspace card header. */
  searchQuery?: string;
  /** Reports loading state back to the parent for the sync footer spinner. */
  onLoadingChange?: (loading: boolean) => void;
  /** Notifies the parent that a refresh cycle just finished. */
  onSynced?: () => void;
}

export interface WorkspaceSkillsHandle {
  /** Programmatic refresh triggered by the shared refresh button. */
  refresh: () => Promise<void>;
}

interface SkillItem {
  name: string;
  description: string;
  path: string;
  displayName?: string;
  /** Which sub-directory it was found under (for tooltip / debug) */
  source: 'skills' | 'claude-skills';
  /** Icon name from SKILL.md frontmatter, if declared. */
  icon?: string;
  /** Image URL from _sudowork_meta.json icon field, if declared. */
  iconUrl?: string;
  /** Color from SKILL.md frontmatter, if declared. */
  color?: string;
  emoji?: string | null;
}

const resolveEmptyDescription = (eventPrefix: 'acp' | 'openclaw-gateway' | undefined, backend: string | undefined, t: ReturnType<typeof useTranslation>['t']): string => {
  if (eventPrefix === 'openclaw-gateway') {
    return t('conversation.workspace.skillsEmptyDescOpenClaw', {
      defaultValue: '在 skills/ 目录下添加 SKILL.md 后会自动显示',
    });
  }

  if (backend === 'claude') {
    return t('conversation.workspace.skillsEmptyDescClaude', {
      defaultValue: '在 .claude/skills/ 目录下添加 SKILL.md 后会自动显示',
    });
  }

  return t('conversation.workspace.skillsEmptyDescOpenClaw', {
    defaultValue: '在 skills/ 目录下添加 SKILL.md 后会自动显示',
  });
};

// ——— Color resolution ———
// The ui.zip reference uses Tailwind tokens like `text-blue-400`. We don't
// have Tailwind in the renderer, so we map each supported name to a concrete
// rgb() pair (fg + bg tint). Hex / rgb() pass through verbatim.
const NAMED_COLORS: Record<string, string> = {
  blue: 'rgb(96, 165, 250)',
  'blue-400': 'rgb(96, 165, 250)',
  'blue-500': 'rgb(59, 130, 246)',
  red: 'rgb(248, 113, 113)',
  'red-400': 'rgb(248, 113, 113)',
  'red-500': 'rgb(239, 68, 68)',
  green: 'rgb(74, 222, 128)',
  'green-400': 'rgb(74, 222, 128)',
  'green-500': 'rgb(34, 197, 94)',
  emerald: 'rgb(52, 211, 153)',
  'emerald-400': 'rgb(52, 211, 153)',
  orange: 'rgb(251, 146, 60)',
  'orange-400': 'rgb(251, 146, 60)',
  'orange-500': 'rgb(249, 115, 22)',
  amber: 'rgb(251, 191, 36)',
  'amber-400': 'rgb(251, 191, 36)',
  'amber-500': 'rgb(245, 158, 11)',
  yellow: 'rgb(250, 204, 21)',
  'yellow-400': 'rgb(250, 204, 21)',
  pink: 'rgb(244, 114, 182)',
  'pink-400': 'rgb(244, 114, 182)',
  purple: 'rgb(168, 85, 247)',
  violet: 'rgb(167, 139, 250)',
  'violet-400': 'rgb(167, 139, 250)',
  cyan: 'rgb(34, 211, 238)',
  'cyan-400': 'rgb(34, 211, 238)',
  slate: 'rgb(148, 163, 184)',
  'slate-400': 'rgb(148, 163, 184)',
  gray: 'rgb(156, 163, 175)',
};

const toRgbTuple = (rgb: string): [number, number, number] | undefined => {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return undefined;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
};

const hexToRgb = (hex: string): string | undefined => {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
};

const resolveColor = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  const lower = v.toLowerCase();
  // Support Tailwind `text-blue-400` / `bg-blue-400` by stripping the prefix.
  const normalized = lower.replace(/^text-/, '').replace(/^bg-/, '');
  if (NAMED_COLORS[normalized]) return NAMED_COLORS[normalized];
  if (v.startsWith('#')) return hexToRgb(v);
  if (lower.startsWith('rgb')) return v;
  return undefined;
};

// Hash fallback palette — used when SKILL.md doesn't specify `color`.
const FALLBACK_ACCENTS: string[] = [
  'rgb(96, 165, 250)', // blue-400
  'rgb(248, 113, 113)', // red-400
  'rgb(52, 211, 153)', // emerald-400
  'rgb(251, 146, 60)', // orange-400
  'rgb(168, 85, 247)', // purple-400
  'rgb(34, 211, 238)', // cyan-400
  'rgb(244, 114, 182)', // pink-400
  'rgb(251, 191, 36)', // amber-400
];

const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

const pickFallbackAccent = (name: string) => FALLBACK_ACCENTS[hashString(name) % FALLBACK_ACCENTS.length];

const withAlpha = (rgb: string, alpha: number): string => {
  const t = toRgbTuple(rgb);
  if (!t) return rgb;
  return `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${alpha})`;
};

// ——— Icon resolution ———
// Map the ui.zip reference icon names (lucide-react) to the icon-park
// equivalents we already have in the bundle. Case-insensitive.
const ICON_BY_NAME: Record<string, IconComponent> = {
  // ui.zip / lucide names
  globe: Browser,
  browser: Browser,
  filetext: FileText,
  'file-text': FileText,
  file: FileText,
  image: Picture,
  imageplus: Picture,
  picture: Picture,
  bookopen: Book,
  'book-open': Book,
  book: Book,
  calendar: Calendar,
  gitbranch: Branch,
  'git-branch': Branch,
  mermaid: Branch,
  settings: SettingConfig,
  settingconfig: SettingConfig,
  config: SettingConfig,
  star: Star,
  sparkles: Star,
  presentation: FileText,
  bug: Bug,
  wand2: Tool,
  wand: Tool,
  tool: Tool,
  code: Code,
  folder: FolderOpen,
  folderopen: FolderOpen,
};

const pickIconByName = (raw: string | undefined): IconComponent | undefined => {
  if (!raw) return undefined;
  const k = raw.trim().toLowerCase();
  if (!k) return undefined;
  return ICON_BY_NAME[k];
};

const pickIconByHeuristic = (name: string): IconComponent => {
  const n = name.toLowerCase();
  if (/image|picture|photo|img/.test(n)) return Picture;
  if (/excel|sheet|csv/.test(n)) return FileText;
  if (/translate|i18n|locale/.test(n)) return Book;
  if (/doc|docx|pdf|ppt|pptx|word|markdown|md|office|star|file/.test(n)) return FileText;
  if (/bug|chandao|issue|ticket/.test(n)) return Bug;
  if (/browser|web|http/.test(n)) return Browser;
  if (/book|wiki|note|jianshu|jiansheku|blog/.test(n)) return Book;
  if (/leave|calendar|schedule/.test(n)) return Calendar;
  if (/mermaid|flow|graph|diagram/.test(n)) return Branch;
  if (/setup|config|setting|install|openclaw/.test(n)) return SettingConfig;
  if (/skill|creator|wand|magic|tool/.test(n)) return Tool;
  if (/folder|dir|workspace/.test(n)) return FolderOpen;
  if (/story|role|character/.test(n)) return Star;
  return Code;
};

const remoteIconCache = new Map<string, string>();

const SkillIconGraphic: React.FC<{
  iconUrl?: string;
  icon?: string;
  displayName: string;
  emoji?: string | null;
  Icon: IconComponent;
  fillColor: string;
}> = ({ iconUrl, icon, displayName, emoji, Icon, fillColor }) => {
  const [resolvedIconUrl, setResolvedIconUrl] = useState<string | undefined>(() => {
    const initial = resolveSkillIcon(iconUrl || icon, false);
    if (!initial) return undefined;
    return remoteIconCache.get(initial) || initial;
  });

  useEffect(() => {
    let cancelled = false;
    const iconSource = resolveSkillIcon(iconUrl || icon, false);

    if (!iconSource) {
      setResolvedIconUrl(undefined);
      return () => {
        cancelled = true;
      };
    }

    if (!/^https?:/i.test(iconSource)) {
      setResolvedIconUrl(iconSource);
      return () => {
        cancelled = true;
      };
    }

    const cached = remoteIconCache.get(iconSource);
    if (cached) {
      setResolvedIconUrl(cached);
      return () => {
        cancelled = true;
      };
    }

    setResolvedIconUrl(iconSource);
    void ipcBridge.fs.fetchRemoteImage
      .invoke({ url: iconSource })
      .then((dataUrl) => {
        remoteIconCache.set(iconSource, dataUrl);
        if (!cancelled) {
          setResolvedIconUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedIconUrl(iconSource);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [iconUrl, icon]);

  if (resolvedIconUrl) {
    return <img src={resolvedIconUrl} alt={displayName} className='workspace-skill-card__icon-image' referrerPolicy='no-referrer' crossOrigin='anonymous' />;
  }

  if (emoji) {
    return <span className='workspace-skill-card__emoji'>{emoji}</span>;
  }

  return <Icon theme='outline' size='16' fill={fillColor} />;
};

const WorkspaceSkills = React.forwardRef<WorkspaceSkillsHandle, WorkspaceSkillsProps>(({ workspace, eventPrefix, backend, searchQuery, onLoadingChange, onSynced }, ref) => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const reqSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingCallbackRef = useRef(onLoadingChange);
  const syncedCallbackRef = useRef(onSynced);
  loadingCallbackRef.current = onLoadingChange;
  syncedCallbackRef.current = onSynced;

  const scanBoth = useCallback(async () => {
    if (!workspace) {
      setSkills([]);
      return;
    }
    const mySeq = ++reqSeqRef.current;
    setLoading(true);
    loadingCallbackRef.current?.(true);
    try {
      const skillRoot = resolveWorkspaceSkillRoot(workspace, eventPrefix, backend);
      const result = await ipcBridge.fs.scanForSkills.invoke({ folderPath: skillRoot.path }).catch((): undefined => undefined);

      if (reqSeqRef.current !== mySeq) return;

      const collected = (result?.success ? result.data : []).map((skill) => ({
        ...skill,
        source: skillRoot.source,
      }));

      collected.sort((a, b) => a.name.localeCompare(b.name));
      setSkills(collected);
      syncedCallbackRef.current?.();
    } finally {
      if (reqSeqRef.current === mySeq) {
        setLoading(false);
        loadingCallbackRef.current?.(false);
      }
    }
  }, [workspace, eventPrefix, backend]);

  // Expose a refresh() handle for the parent's shared refresh button.
  useImperativeHandle(ref, () => ({ refresh: scanBoth }), [scanBoth]);

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

  const filteredSkills = useMemo(() => {
    const q = (searchQuery ?? '').trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) => {
      const displayName = (skill.displayName || '').toLowerCase();
      return skill.name.toLowerCase().includes(q) || displayName.includes(q) || skill.description.toLowerCase().includes(q);
    });
  }, [skills, searchQuery]);

  if (filteredSkills.length === 0) {
    const initialLoading = loading && skills.length === 0;
    return (
      <div className='workspace-skills'>
        <div className='workspace-card__empty'>
          <div className='workspace-card__empty-icon'>
            <Code theme='outline' size='20' fill='currentColor' />
          </div>
          <div className='workspace-card__empty-title'>{initialLoading ? t('conversation.workspace.skillsLoading', { defaultValue: '正在扫描技能...' }) : (searchQuery ?? '').trim() ? t('conversation.workspace.skillsSearchEmpty', { defaultValue: '未找到匹配的技能' }) : t('conversation.workspace.skillsEmpty', { defaultValue: '工作空间暂无可用技能' })}</div>
          {!(searchQuery ?? '').trim() && !initialLoading && <div className='workspace-card__empty-desc'>{resolveEmptyDescription(eventPrefix, backend, t)}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className='workspace-skills'>
      <div className='workspace-skills__grid'>
        {filteredSkills.map((skill) => {
          const iconFromMeta = pickIconByName(skill.icon);
          const Icon = iconFromMeta ?? pickIconByHeuristic(skill.name);
          const resolved = resolveColor(skill.color);
          const fg = resolved ?? pickFallbackAccent(skill.name);
          const borderTint = withAlpha(fg, 0.14);
          const iconBackground = skill.iconUrl ? 'var(--color-fill-2, #f2f3f5)' : withAlpha(fg, 0.1);
          const displayName = skill.displayName || skill.name;

          return (
            <Tooltip key={`${skill.source}:${skill.path}`} content={displayName} position='top' mini>
              <div className='workspace-skill-card' role='button' tabIndex={0}>
                <div
                  className='workspace-skill-card__icon'
                  style={{
                    background: iconBackground,
                    color: fg,
                    borderColor: borderTint,
                  }}
                >
                  <SkillIconGraphic iconUrl={skill.iconUrl} icon={skill.icon} displayName={displayName} emoji={skill.emoji} Icon={Icon} fillColor={fg} />
                </div>
                <div className='workspace-skill-card__meta'>
                  <div className='workspace-skill-card__name'>{displayName}</div>
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
});

WorkspaceSkills.displayName = 'WorkspaceSkills';

export default WorkspaceSkills;
