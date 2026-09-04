/**
 * Hub 技能图标解析（对齐 Sudowork skillDisplay.ts 的 COS 处理，Apache-2.0, Copyright 2026 SudoPrivacy）：
 * hub/installed 技能的 icon 可能是相对路径，需补 COS 桶前缀；主桶加载失败时回退 legacy 桶。
 */

/** COS 主桶（sudowork src/shared/cos.ts COS_HUB_BASE） */
const HUB_SKILL_ICON_COS_BASE = 'https://sudowork-hub-1309794936.cos.ap-beijing.myqcloud.com/'
/** legacy 桶（弃用期保留为回退，sudowork COS_LEGACY_HUB_BASE） */
const HUB_SKILL_ICON_LEGACY_BASE = 'https://sudoworkhub-1309794936.cos.ap-beijing.myqcloud.com/'

function isRelativePath(url: string): boolean {
  return !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:')
}

/** 解析 hub 技能图标：相对路径补 COS 主桶前缀，绝对地址原样返回；空值返回 undefined。 */
export function resolveHubSkillIcon(icon: string | undefined): string | undefined {
  const normalized = (icon ?? '').trim()
  if (!normalized) return undefined
  if (isRelativePath(normalized)) {
    return `${HUB_SKILL_ICON_COS_BASE}${normalized}`
  }
  return normalized
}

/** <img onError>：主桶图标失败时换 legacy 桶一次。 */
export function handleHubSkillIconError(e: { currentTarget: HTMLImageElement }): void {
  const img = e.currentTarget
  if (img.src.startsWith(HUB_SKILL_ICON_COS_BASE)) {
    const fallback = `${HUB_SKILL_ICON_LEGACY_BASE}${img.src.slice(HUB_SKILL_ICON_COS_BASE.length)}`
    if (img.src !== fallback) {
      img.src = fallback
    }
  }
}
