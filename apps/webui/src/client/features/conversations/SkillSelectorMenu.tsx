/**
 * @技能选择弹层内容（对齐 Sudowork SkillSelectorPopover 的交互，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 搜索（150ms 防抖）+ 键盘导航（↑↓/Enter/Escape）+ 弹出自动聚焦搜索框 + 关闭后回焦外部输入框。
 * 初始页（OPTIONS 数据：icon 为完整 COS URL）与会话页（skills/available：icon 为图标名、图片在
 * iconUrl）共用，图标链数据源感知：iconUrl → img → icon(http) → img → icon(名) → 图标映射 →
 * emoji → 文字 → 默认图标资源。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@arco-design/web-react'
import type { RefInputType } from '@arco-design/web-react/es/Input/interface'
import { IconSearch } from '@arco-design/web-react/icon'
import { Zap } from 'lucide-react'
import type { SkillSelectorItem } from './useSkillSelector'
import { pickFallbackAccent, pickIconByName, pickIconByHeuristic, resolveColor, withAlpha } from './skillIcon'
import skillDefaultIcon from '@client/assets/skill-default.svg'

export function SkillIconGraphic({ skill }: { skill: SkillSelectorItem }): React.ReactElement {
  const [imgFailed, setImgFailed] = useState(false)
  const accent = resolveColor((skill as { color?: string }).color) ?? pickFallbackAccent(skill.name)
  const icon = skill.icon ?? ''
  const imgSrc = skill.iconUrl || (/^https?:\/\//.test(icon) ? icon : '')
  if (imgSrc && !imgFailed) {
    return (
      <img
        src={imgSrc}
        alt={skill.displayName || skill.name}
        className='w-full h-full object-cover'
        onError={() => setImgFailed(true)}
      />
    )
  }
  if (skill.emoji) {
    return <span className='text-16px leading-none'>{skill.emoji}</span>
  }
  const Icon = pickIconByName(icon) ?? pickIconByHeuristic(skill.name)
  if (Icon) {
    return <Icon theme='outline' size='18' fill={accent} />
  }
  return <img src={skillDefaultIcon} alt='' className='w-18px h-18px object-contain' />
}

export function SkillSelectorMenu({
  skills,
  selectedSkills,
  loading = false,
  popupVisible,
  onSelectItem,
  onDismiss,
}: {
  skills: SkillSelectorItem[]
  selectedSkills: string[]
  loading?: boolean
  popupVisible: boolean
  onSelectItem: (skill: SkillSelectorItem) => void
  onDismiss: () => void
}): React.ReactElement {
  const [activeIndex, setActiveIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const searchInputRef = useRef<RefInputType | null>(null)

  // 搜索防抖（150ms，对齐 Sudowork）
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // 空值安全的过滤（数据源字段可能缺失——单测 mock 的技能就只有 name）
  const filteredSkills = useMemo(() => {
    const result = skills.filter((s) => (s.enabled ?? true) !== false)
    const keyword = debouncedSearch.trim().toLowerCase()
    if (!keyword) return result
    return result.filter((s) =>
      s.name.toLowerCase().includes(keyword) ||
      (s.displayName ?? '').toLowerCase().includes(keyword) ||
      (s.description ?? '').toLowerCase().includes(keyword),
    )
  }, [skills, debouncedSearch])

  // Reset search when menu opens, and auto-focus search input
  useEffect(() => {
    if (popupVisible) {
      setSearchQuery('')
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [popupVisible])

  // Reset active index when list changes
  useEffect(() => {
    itemRefs.current = []
    setActiveIndex(0)
  }, [debouncedSearch, filteredSkills.length])

  // Scroll active item into view
  useEffect(() => {
    if (filteredSkills.length === 0) return
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, filteredSkills.length])

  // Global capture-phase keydown（↑↓/Enter/Escape 导航）
  useEffect(() => {
    if (!popupVisible) return

    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) =>
          filteredSkills.length === 0 ? 0 : Math.min(prev + 1, filteredSkills.length - 1),
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (filteredSkills[activeIndex]) {
          onSelectItem(filteredSkills[activeIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (searchQuery) {
          setSearchQuery('')
        } else {
          onDismiss()
        }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [popupVisible, filteredSkills, activeIndex, onSelectItem, onDismiss, searchQuery])

  return (
    <div className='w-72 flex flex-col'>
      {/* Search box */}
      <Input
        ref={searchInputRef}
        className='my-2'
        size='small'
        prefix={<IconSearch />}
        allowClear
        placeholder='搜索技能...'
        value={searchQuery}
        onChange={setSearchQuery}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && searchQuery) e.stopPropagation()
        }}
      />
      {/* Content area */}
      <div role='listbox' aria-busy={loading} className='overflow-y-auto h-260px flex flex-col gap-0.5 p-1'>
        {loading && filteredSkills.length === 0 ? (
          <div className='px-2.5 py-3 text-13px text-secondary'>技能加载中…</div>
        ) : null}
        {!loading && filteredSkills.length === 0 ? (
          <div className='px-2.5 py-3 text-13px text-secondary'>
            {searchQuery ? '未找到匹配结果' : '暂无可选技能'}
          </div>
        ) : null}
        {filteredSkills.map((skill, index) => {
          const on = selectedSkills.includes(skill.name)
          return (
            <button
              key={skill.name}
              type='button'
              role='option'
              aria-selected={on}
              data-testid={`skill-option-${skill.name}`}
              ref={(node) => {
                itemRefs.current[index] = node
              }}
              className={`w-full bg-transparent text-left p-2.5 rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
                index === activeIndex ? 'bg-fill-2' : ''
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelectItem(skill)}
            >
              <span
                className='inline-flex size-8 shrink-0 items-center justify-center rd-6px overflow-hidden bg-fill-2'
                style={{ backgroundColor: withAlpha(resolveColor((skill as { color?: string }).color) ?? pickFallbackAccent(skill.name), 0.12) }}
              >
                <SkillIconGraphic skill={skill} />
              </span>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-1.5 min-w-0'>
                  <span className='text-14px truncate text-foreground font-medium'>{skill.displayName || skill.name}</span>
                  {on ? <Zap size={12} color='var(--ui-accent-orange)' className='shrink-0' /> : null}
                </div>
                {skill.description ? (
                  <div className='text-11px text-secondary truncate'>{skill.description}</div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
