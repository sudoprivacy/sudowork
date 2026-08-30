import { useEffect, useState } from 'react'

/**
 * placeholder 打字机逐字动画（对齐 Sudowork guid/hooks/useTypewriterPlaceholder，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 300ms 初始延迟后每 80ms 打出一个字符，打字期间以「|」作光标，完成后显示全文。
 */
export function useTypewriterPlaceholder(text: string): string {
  const [placeholder, setPlaceholder] = useState('')

  useEffect(() => {
    let currentIndex = 0
    const typingSpeed = 80
    let intervalId: ReturnType<typeof setInterval> | null = null

    const typeNextChar = (): void => {
      if (currentIndex <= text.length) {
        setPlaceholder(text.slice(0, currentIndex) + (currentIndex < text.length ? '|' : ''))
        currentIndex++
      }
    }

    const initialDelay = setTimeout(() => {
      intervalId = setInterval(() => {
        typeNextChar()
        if (currentIndex > text.length) {
          if (intervalId) clearInterval(intervalId)
          setPlaceholder(text)
        }
      }, typingSpeed)
    }, 300)

    return () => {
      clearTimeout(initialDelay)
      if (intervalId) clearInterval(intervalId)
    }
  }, [text])

  return placeholder
}
