/**
 * 右侧面板「终端」tab（服务器 pty，按会话独立；对齐 Sudowork TerminalPanel 交互，
 * Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 每终端子 tab 一条 /ws/terminal?conversation=<id> 连接；状态（tab 列表 + xterm 实例）提升到
 * 模块级 Map 按会话存活（对齐 Sudowork TerminalPanel.tsx 的模块级状态），切会话/切 tab 不丢历史。
 * 注意：这是 webui 服务器上的 shell，不是本机终端，也不是 Moss 会话容器的终端。
 * 交互对齐：term.open 后再挂载（渲染的前提）、fit 后上报 resize 帧、exit/断线保留 [exit] 历史
 * （仅用户点 × 删除）、面板失焦禁输入（disableStdin）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

const PER_CONV_TAB_LIMIT = 10

interface TerminalEntry {
  terminalId: string
  ws: WebSocket
  term: Terminal
  fit: FitAddon
  /** xterm 渲染容器（open 的前提——element 只有 open 后才存在，先建游离容器再搬移） */
  host: HTMLDivElement
  /** 进程已退出（exit 帧已写 [exit] 历史，不再重复写断线提示） */
  ended: boolean
  /** 用户点 × 主动关闭（onclose 不写提示、不保留） */
  userClosed: boolean
}

/** 模块级状态：conversationId → { terminals, activeId }（切换会话/卸载面板后仍保留） */
const store = new Map<
  string,
  { terminals: TerminalEntry[]; activeId: string | null; seq: number }
>()

function getStore(conversationId: string) {
  let s = store.get(conversationId)
  if (!s) {
    s = { terminals: [], activeId: null, seq: 0 }
    store.set(conversationId, s)
  }
  return s
}

function closeEntry(entry: TerminalEntry): void {
  // 先置 userClosed：closeEntry 同步返回后 onclose 异步触发，靠该标记豁免写提示逻辑
  entry.userClosed = true
  try {
    entry.ws.close()
  } catch {
    /* ignore */
  }
  entry.term.dispose()
}

/** fit 后把尺寸上报给 pty（服务端支持 resize 帧；open 前无布局时 FitAddon 自行跳过） */
function fitAndResize(entry: TerminalEntry): void {
  try {
    entry.fit.fit()
    if (entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify({ type: 'resize', cols: entry.term.cols, rows: entry.term.rows }))
    }
  } catch {
    /* 容器无布局时 proposeDimensions 返回 NaN，fit 整体放弃 */
  }
}

export function TerminalTab({
  conversationId,
  active,
}: {
  conversationId: string
  active: boolean
}): React.ReactElement {
  const s = getStore(conversationId)
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender((n) => n + 1), [])
  const mountRef = useRef<HTMLDivElement | null>(null)
  const mountedEntryRef = useRef<TerminalEntry | null>(null)

  /** 激活某个终端：把已 open 的 xterm DOM 搬到当前容器并 fit 上报 */
  const mountTerm = useCallback(
    (entry: TerminalEntry) => {
      const host = mountRef.current
      if (!host) return
      if (mountedEntryRef.current === entry && host.contains(entry.host)) return
      host.innerHTML = ''
      host.appendChild(entry.host)
      fitAndResize(entry)
      if (!entry.ended) entry.term.focus()
      mountedEntryRef.current = entry
    },
    [],
  )

  useEffect(() => {
    if (!active) return
    const current = s.terminals.find((t) => t.terminalId === s.activeId)
    if (current) mountTerm(current)
  }, [active, s.activeId, s.terminals, mountTerm, s])

  /** 面板尺寸/窗口变化时 fit 当前终端并上报（对齐 Sudowork ResizeObserver + window resize） */
  useEffect(() => {
    if (!active || !mountRef.current) return
    const observer = new ResizeObserver(() => {
      const current = s.terminals.find((t) => t.terminalId === s.activeId)
      if (current) fitAndResize(current)
    })
    observer.observe(mountRef.current)
    const onWindowResize = (): void => {
      const current = s.terminals.find((t) => t.terminalId === s.activeId)
      if (current) fitAndResize(current)
    }
    window.addEventListener('resize', onWindowResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [active, s])

  /** 失焦门控（对齐 Sudowork）：面板不激活时禁用输入，键盘只进当前激活的终端 */
  useEffect(() => {
    for (const t of s.terminals) {
      t.term.options.disableStdin = !active || t.ended
    }
  }, [active, s.terminals, s])

  const openTerminal = useCallback((): void => {
    if (s.terminals.length >= PER_CONV_TAB_LIMIT) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/terminal?conversation=${encodeURIComponent(conversationId)}`)
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 5000,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: 'var(--color-bg-1)',
        foreground: 'var(--color-text-1)',
        cursor: 'var(--ui-accent-orange)',
        selectionBackground: 'rgba(245,158,11,.25)',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // 渲染前提：先创建游离容器并 open（xterm 的 element 只有 open 后才有值），
    // ready 帧到达后 mountTerm 把它搬进面板容器，re-parent 由 ResizeObserver/手动 fit 补齐布局
    const host = document.createElement('div')
    host.className = 'size-full'
    term.open(host)
    let entry: TerminalEntry | null = null
    ws.onmessage = (msg) => {
      let frame: { type?: string; data?: string; terminalId?: string }
      try {
        frame = JSON.parse(msg.data as string)
      } catch {
        return
      }
      if (frame.type === 'ready' && frame.terminalId && entry) {
        entry.terminalId = frame.terminalId
        s.seq += 1
        s.activeId = frame.terminalId
        rerender()
        requestAnimationFrame(() => entry && mountTerm(entry))
      } else if (frame.type === 'output' && typeof frame.data === 'string') {
        term.write(frame.data)
      } else if (frame.type === 'exit' && entry) {
        // 保留历史（对齐 Sudowork [exit] 语义）：服务端 exit 帧不带退出码
        entry.ended = true
        term.options.disableStdin = true
        term.write('\r\n[exit]\r\n')
        rerender()
      }
    }
    ws.onopen = () => {
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN && !entry?.ended) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })
    }
    ws.onclose = () => {
      if (!entry) return
      // 用户点 ×：closeEntry 已置 userClosed，直接跳过（term 已 dispose，write 会报错）
      if (entry.userClosed) return
      // exit 后服务端立即 ws.close()：ended 已写 [exit]，不重复写；异常断开才写断线提示
      if (!entry.ended) {
        entry.ended = true
        entry.term.options.disableStdin = true
        entry.term.write('\r\n[连接已断开]\r\n')
      }
      rerender()
    }
    entry = { terminalId: `pending-${Date.now()}`, ws, term, fit, host, ended: false, userClosed: false }
    s.terminals = [...s.terminals, entry]
    rerender()
  }, [conversationId, s, rerender, mountTerm])

  const closeTerminal = useCallback(
    (target: TerminalEntry): void => {
      closeEntry(target)
      s.terminals = s.terminals.filter((t) => t !== target)
      if (s.activeId === target.terminalId) s.activeId = s.terminals[0]?.terminalId ?? null
      rerender()
    },
    [s, rerender],
  )

  return (
    <div className='w-full h-full min-h-0 flex flex-col'>
      {/* 终端子 tab */}
      <div className='terminal-root__tabs shrink-0'>
        {s.terminals.map((t, i) => (
          <span
            key={t.terminalId}
            className={`terminal-root__tab${s.activeId === t.terminalId ? ' terminal-root__tab--active' : ''}${t.ended ? ' terminal-root__tab--ended' : ''}`}
            onClick={() => {
              s.activeId = t.terminalId
              rerender()
              requestAnimationFrame(() => mountTerm(t))
            }}
          >
            终端 {i + 1}
            {t.ended ? ' ·' : ''}
            <button
              type='button'
              className='terminal-root__tab-close'
              aria-label='关闭终端'
              onClick={(e) => {
                e.stopPropagation()
                closeTerminal(t)
              }}
            >
              ×
            </button>
          </span>
        ))}
        {s.terminals.length < PER_CONV_TAB_LIMIT ? (
          <button
            type='button'
            className='terminal-root__tab'
            aria-label='新建终端'
            data-testid='terminal-new-tab'
            onClick={openTerminal}
          >
            +
          </button>
        ) : null}
      </div>
      {/* xterm 挂载点 */}
      <div className='flex-1 min-h-0 overflow-hidden p-1'>
        <div ref={mountRef} className='size-full' data-testid='terminal-mount' />
        {s.terminals.length === 0 ? (
          <div className='size-full f-center text-12px text-tertiary select-none'>
            点击 + 新建终端（webui 服务器 shell）
          </div>
        ) : null}
      </div>
    </div>
  )
}
