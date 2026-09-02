/**
 * @技能选择器控制器（移植自 Sudowork useSkillSelectorController，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 输入框键入 @ 触发弹层：按光标位置匹配 @query（不传光标退化为整段匹配，多行编辑时会漏触发/误维持）。
 * 初始页与会话页共用。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// Match @ followed by query text, ending at the current cursor position
const AT_QUERY_RE = /(?:^|\s)@([^\s@]*)$/

/**
 * Extract the @ query from input text based on cursor position.
 * Returns the query string after @, or null if no @ trigger found.
 */
export function matchSkillQuery(input: string, cursorPosition?: number): string | null {
  const textBeforeCursor = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input
  const match = textBeforeCursor.match(AT_QUERY_RE)
  return match?.[1] ?? null
}

/**
 * Strip the @query portion from input text at specific position.
 */
export function stripAtQuery(input: string, cursorPosition?: number): string {
  const textBeforeCursor = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input
  const textAfterCursor = cursorPosition !== undefined ? input.slice(cursorPosition) : ''

  const match = textBeforeCursor.match(/(?:^|\s)@[^\s@]*$/)
  if (!match) return input

  const matched = match[0] ?? ''
  const matchStart = match.index ?? 0
  const prefix = textBeforeCursor.slice(0, matchStart)

  let resultPrefix = prefix
  if (matched.startsWith(' ') || matched.startsWith('\t') || matched.startsWith('\n')) {
    resultPrefix = prefix + (matched[0] ?? '')
  }

  return resultPrefix + textAfterCursor
}

/**
 * Replace the @query portion in input text with a new value.
 */
export function replaceAtQuery(input: string, replacement: string, cursorPosition?: number): string {
  const textBeforeCursor = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input
  const textAfterCursor = cursorPosition !== undefined ? input.slice(cursorPosition) : ''

  const match = textBeforeCursor.match(/(?:^|\s)@[^\s@]*$/)
  if (!match) return input + replacement

  const matched = match[0] ?? ''
  const matchStart = match.index ?? 0
  const prefix = textBeforeCursor.slice(0, matchStart)

  let resultPrefix = prefix
  if (matched.startsWith(' ') || matched.startsWith('\t') || matched.startsWith('\n')) {
    resultPrefix = prefix + (matched[0] ?? '')
  }

  return resultPrefix + replacement + ' ' + textAfterCursor
}

export interface SkillSelectorItem {
  name: string
  displayName: string
  description?: string
  icon?: string
  iconUrl?: string
  emoji?: string | null
  enabled?: boolean
}

interface UseSkillSelectorOptions {
  input: string
  cursorPosition?: number
  selectedSkills: string[]
  onRemoveSkill?: (skillName: string) => void
}

export function useSkillSelector(options: UseSkillSelectorOptions) {
  const { input, cursorPosition, selectedSkills, onRemoveSkill } = options
  const query = useMemo(() => matchSkillQuery(input, cursorPosition), [input, cursorPosition])
  const [dismissed, setDismissed] = useState(false)
  const prevQueryRef = useRef<string | null>(null)

  // Reset dismissed state when a new @ query appears
  if (query !== prevQueryRef.current) {
    if (query !== null) setDismissed(false)
    prevQueryRef.current = query
  }

  const isOpen = query !== null && !dismissed

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isOpen) return false

      if (event.key === 'Backspace' && query === '') {
        const last = selectedSkills[selectedSkills.length - 1]
        if (last !== undefined) {
          onRemoveSkill?.(last)
          return true
        }
      }

      return false
    },
    [isOpen, query, selectedSkills, onRemoveSkill],
  )

  return {
    query,
    isOpen,
    setDismissed,
    onKeyDown,
  }
}
