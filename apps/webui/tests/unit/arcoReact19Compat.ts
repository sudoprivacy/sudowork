import ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'

/**
 * Arco Design 2.x 兼容 React 19（Sudowork 同栈问题的通用修法）：
 * Arco 的 Message/Notification/Modal 单例调用旧版 ReactDOM.render /
 * unmountComponentAtNode，这两个 API 在 React 19 已移除。此处在启动时为
 * react-dom 模块对象补上 createRoot 版实现，避免运行时报
 * "CopyReactDOM.render is not a function"。
 */

type LegacyReactDOM = typeof ReactDOM & {
  render?: (node: React.ReactNode, container: Element | DocumentFragment) => unknown
  unmountComponentAtNode?: (container: Element | DocumentFragment) => boolean
}

const installed = new WeakSet<object>()

export function installArcoReact19Compat(): void {
  const rd = ReactDOM as LegacyReactDOM
  if (installed.has(rd)) return
  installed.add(rd)

  if (typeof rd.render !== 'function') {
    rd.render = (node, container) => {
      const root = createRoot(container as Element)
      root.render(node as React.ReactElement)
      return root
    }
  }
  if (typeof rd.unmountComponentAtNode !== 'function') {
    rd.unmountComponentAtNode = () => true
  }
}
