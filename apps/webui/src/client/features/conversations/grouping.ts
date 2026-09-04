/**
 * 历史分组逻辑（对齐 Sudowork timeline.ts / groupingHelpers.ts，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 时间分组标签固定顺序：今天 / 昨天 / 最近7天 / 更早；cron 会话不进入普通时间线（仅定时任务 tab）。
 */

export type TimelineLabel = '今天' | '昨天' | '最近7天' | '更早'

const DAY_MS = 86_400_000

/** 会话 source（部署版实测为 JSON 字符串：{"source":"cron","cronJobId","cronJobName","cronRunId","agentMode"}） */
export interface ParsedSource {
  source?: string
  cronJobId?: string
  cronJobName?: string
  cronRunId?: string
}

export function parseSource(raw: string | null): ParsedSource | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ParsedSource
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return raw.includes('cron') ? { source: 'cron' } : null
  }
}

export function isCronConversation(raw: string | null): boolean {
  return parseSource(raw)?.source === 'cron'
}

export function getTimelineLabel(lastActiveAt: number | null, now = Date.now()): TimelineLabel {
  if (typeof lastActiveAt !== 'number' || !Number.isFinite(lastActiveAt)) return '更早'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const today0 = startOfToday.getTime()
  if (lastActiveAt >= today0) return '今天'
  if (lastActiveAt >= today0 - DAY_MS) return '昨天'
  if (lastActiveAt >= today0 - 7 * DAY_MS) return '最近7天'
  return '更早'
}

const LABEL_ORDER: TimelineLabel[] = ['今天', '昨天', '最近7天', '更早']

export function groupByTimeline<T extends { lastActiveAt: number | null }>(
  items: T[],
  now = Date.now(),
): { label: TimelineLabel; items: T[] }[] {
  const buckets = new Map<TimelineLabel, T[]>()
  for (const item of items) {
    const label = getTimelineLabel(item.lastActiveAt, now)
    const list = buckets.get(label) ?? []
    list.push(item)
    buckets.set(label, list)
  }
  return LABEL_ORDER.filter((l) => buckets.has(l)).map((label) => ({ label, items: buckets.get(label)! }))
}
