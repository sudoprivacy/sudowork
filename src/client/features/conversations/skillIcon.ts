/**
 * 技能图标工具（对齐 Sudowork WorkspaceSkills 的自研映射，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * @icon-park/react 仅提供图标组件本体；名称→图标字典、颜色解析为 Sudowork 手写逻辑的移植。
 * 供右侧面板技能卡（WorkspaceTab）与 @技能弹层（SkillSelectorMenu）共用。
 */
import React from 'react'
import {
  Book,
  Branch,
  Browser,
  Bug,
  Calendar,
  Code,
  FileText,
  FolderOpen,
  Picture,
  SettingConfig,
  Star,
  Tool,
} from '@icon-park/react'

export type IconComponent = React.ComponentType<{
  theme?: 'outline' | 'filled' | 'two-tone' | 'multi-color'
  size?: string | number
  fill?: string | string[]
}>

// ——— 颜色解析：Tailwind 色名（ui.zip 参考）→ 具体 rgb()；hex / rgb() 原样通过 ———
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
}

const toRgbTuple = (rgb: string): [number, number, number] | undefined => {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return undefined
  const r = m[1]
  const g = m[2]
  const b = m[3]
  if (r === undefined || g === undefined || b === undefined) return undefined
  return [parseInt(r, 10), parseInt(g, 10), parseInt(b, 10)]
}

const hexToRgb = (hex: string): string | undefined => {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  const h = m?.[1]
  if (!h) return undefined
  const expanded = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

/** 解析技能作者声明的颜色（Tailwind 名 / hex / rgb()）→ rgb()；无法解析返回 undefined。 */
export function resolveColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const v = raw.trim()
  if (!v) return undefined
  const lower = v.toLowerCase()
  const normalized = lower.replace(/^text-/, '').replace(/^bg-/, '')
  if (NAMED_COLORS[normalized]) return NAMED_COLORS[normalized]
  if (v.startsWith('#')) return hexToRgb(v)
  if (lower.startsWith('rgb')) return v
  return undefined
}

// 哈希兜底色板：SKILL.md 未声明 color 时按名称取一个稳定的强调色
const FALLBACK_ACCENTS: string[] = [
  'rgb(96, 165, 250)', // blue-400
  'rgb(248, 113, 113)', // red-400
  'rgb(52, 211, 153)', // emerald-400
  'rgb(251, 146, 60)', // orange-400
  'rgb(168, 85, 247)', // purple-400
  'rgb(34, 211, 238)', // cyan-400
  'rgb(244, 114, 182)', // pink-400
  'rgb(251, 191, 36)', // amber-400
]

const hashString = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export const pickFallbackAccent = (name: string): string =>
  FALLBACK_ACCENTS[hashString(name) % FALLBACK_ACCENTS.length] ?? FALLBACK_ACCENTS[0] ?? 'rgb(96, 165, 250)'

export const withAlpha = (rgb: string, alpha: number): string => {
  const t = toRgbTuple(rgb)
  if (!t) return rgb
  return `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${alpha})`
}

// ——— 图标解析：ui.zip / lucide 参考名 → icon-park 等价物（大小写不敏感）———
const ICON_BY_NAME: Record<string, IconComponent> = {
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
}

export const pickIconByName = (raw: string | undefined): IconComponent | undefined => {
  if (!raw) return undefined
  const k = raw.trim().toLowerCase()
  if (!k) return undefined
  return ICON_BY_NAME[k]
}

/** 名称启发式：icon 未声明或字典未命中时按技能名猜图标（多数技能的常态）。 */
export const pickIconByHeuristic = (name: string): IconComponent => {
  const n = name.toLowerCase()
  if (/image|picture|photo|img/.test(n)) return Picture
  if (/excel|sheet|csv/.test(n)) return FileText
  if (/translate|i18n|locale/.test(n)) return Book
  if (/doc|docx|pdf|ppt|pptx|word|markdown|md|office|star|file/.test(n)) return FileText
  if (/bug|chandao|issue|ticket/.test(n)) return Bug
  if (/browser|web|http/.test(n)) return Browser
  if (/book|wiki|note|jianshu|jiansheku|blog/.test(n)) return Book
  if (/leave|calendar|schedule/.test(n)) return Calendar
  if (/mermaid|flow|graph|diagram/.test(n)) return Branch
  if (/setup|config|setting|install/.test(n)) return SettingConfig
  if (/skill|creator|wand|magic|tool/.test(n)) return Tool
  if (/folder|dir|workspace/.test(n)) return FolderOpen
  if (/story|role|character/.test(n)) return Star
  return Code
}
