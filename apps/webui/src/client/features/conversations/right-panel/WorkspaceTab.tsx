/**
 * 右侧面板「工作空间」tab（对齐 Sudowork remote 会话的只读工作空间，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 二级 tab：临时空间（文件树，只读）/ 可用技能；工具栏：搜索 + 刷新；turn 结束后自动刷新。
 * 文件树：服务端搜索（moss 支持 search 参数）+ 目录懒加载 + 展开状态按会话持久化 + 拖拽/粘贴上传 + 单击预览。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Empty, Input, Message, Modal, Tree } from '@arco-design/web-react'
import type { TreeDataType } from '@arco-design/web-react/es/Tree/interface'
import { Cloudy, FolderOpen, Magic } from '@icon-park/react'
import { RefreshCw } from 'lucide-react'
import {
  getConversationOptions,
  getWorkspaceFile,
  getWorkspaceTree,
  uploadWorkspaceFile,
  type WorkspaceNode,
} from '../conversationApi'
import { pickFallbackAccent, pickIconByName, pickIconByHeuristic, resolveColor, withAlpha } from '../skillIcon'
import type { SkillSelectorItem } from '../useSkillSelector'
import skillDefaultIcon from '@client/assets/skill-default.svg'

const FILE_TAB_KEY = 'sudowork_workspace_active_tab'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** 会话级展开键持久化前缀（对齐 Sudowork useWorkspaceTree 的按会话持久化） */
function expandedKeyStore(conversationId: string): string {
  return `sudowork_workspace_expanded:${conversationId}`
}

function readExpandedKeys(conversationId: string): string[] {
  try {
    const raw = localStorage.getItem(expandedKeyStore(conversationId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** WorkspaceNode → Arco TreeDataType（不带 children 的目录留给 loadMore 懒加载） */
function toTreeNodes(node: WorkspaceNode): TreeDataType[] {
  if (node.isDir) {
    const isDrafts = node.name === '.drafts'
    return [
      {
        key: node.relativePath,
        // .drafts 本地化显示（对齐 Sudowork 草稿箱文案）
        title: isDrafts ? '草稿箱' : node.name,
        // 草稿箱目录图标（对齐 Sudowork workspace/index.tsx:44,476 的 FolderOpen 琥珀色）
        ...(isDrafts ? { icon: <FolderOpen theme='outline' size='16' fill='#f59e0b' /> } : {}),
        isLeaf: false,
        children: Array.isArray(node.children)
          ? node.children.flatMap((c) => (c.isDir ? toTreeNodes(c) : toTreeNodes(c)))
          : undefined,
      },
    ]
  }
  return [{ key: node.relativePath, title: node.name, isLeaf: true }]
}

/** 隐藏条目判定（规则对齐 Sudowork workspace/index.tsx:46-51）：'.' 开头隐藏，.drafts 豁免 */
function isHiddenEntry(name: string): boolean {
  if (name === '.drafts') return false
  return name.startsWith('.')
}

/** 渲染层递归过滤隐藏条目（不动 root 状态，loadMore 增量合并不受影响） */
function filterHiddenNodes(nodes: WorkspaceNode[]): WorkspaceNode[] {
  return nodes.filter((n) => !isHiddenEntry(n.name)).map((n) => (
    Array.isArray(n.children) ? { ...n, children: filterHiddenNodes(n.children) } : n
  ))
}

/** 把 loadMore 拉回的子树合并进本地树中 path 对应的目录节点 */
function mergeSubtree(root: WorkspaceNode, path: string, subtree: WorkspaceNode | null): WorkspaceNode {
  if (!subtree) return root
  if (root.relativePath === path) {
    return { ...root, children: subtree.children ?? [] }
  }
  if (!Array.isArray(root.children)) return root
  return { ...root, children: root.children.map((c) => mergeSubtree(c, path, subtree)) }
}

/** 技能卡数据形态（复用 @技能弹层的共享 item 类型；color 为可选补充字段） */
type PanelSkill = SkillSelectorItem & { color?: string }

/** 技能图标块（渲染链对齐 Sudowork WorkspaceSkills：图片 → 图标名映射 → emoji → 默认资源） */
function SkillIconGraphic({ skill }: { skill: PanelSkill }): React.ReactElement {
  const [imgFailed, setImgFailed] = useState(false)
  const accent = resolveColor(skill.color) ?? pickFallbackAccent(skill.name)
  const imgSrc = skill.iconUrl || (/^https?:\/\//.test(skill.icon ?? '') ? skill.icon : '')
  if (imgSrc && !imgFailed) {
    return (
      <img
        src={imgSrc}
        alt={skill.displayName || skill.name}
        className='size-full object-cover'
        onError={() => setImgFailed(true)}
      />
    )
  }
  if (skill.emoji) {
    return <span className='text-16px leading-none'>{skill.emoji}</span>
  }
  const Icon = pickIconByName(skill.icon) ?? pickIconByHeuristic(skill.name)
  if (Icon) {
    return <Icon theme='outline' size='18' fill={accent} />
  }
  return <img src={skillDefaultIcon} alt='' className='size-18px object-contain' />
}

export function WorkspaceTab({
  conversationId,
  active,
  turnFinishedAt,
  workspaceRefreshKey,
}: {
  conversationId: string
  active: boolean
  turnFinishedAt: number
  /** 会话进行中刷新信号（tool_use 防抖递增；turnFinishedAt 只在 turn 结束时递增） */
  workspaceRefreshKey: number
}): React.ReactElement {
  const [subTab, setSubTab] = useState<'files' | 'skills'>(() =>
    localStorage.getItem(FILE_TAB_KEY) === 'skills' ? 'skills' : 'files',
  )
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [root, setRoot] = useState<WorkspaceNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => readExpandedKeys(conversationId))
  const [preview, setPreview] = useState<{ name: string; mime: string; content: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const treeScrollRef = useRef<HTMLDivElement | null>(null)

  // 可用技能数据源 = 全局已安装技能（与初始页 @技能/技能库「我的技能」同接口同 SWR key，共享缓存）
  const { data: options } = useSWR('conversation-options', getConversationOptions)

  useEffect(() => {
    localStorage.setItem(FILE_TAB_KEY, subTab)
  }, [subTab])

  useEffect(() => {
    localStorage.setItem(expandedKeyStore(conversationId), JSON.stringify(expandedKeys))
  }, [conversationId, expandedKeys])

  /** 整树拉取（搜索词非空时走服务端搜索，结果整树替换并展开全部命中目录） */
  const refreshTree = useCallback(
    async (searchTerm: string): Promise<void> => {
      if (!conversationId) return
      setLoading(true)
      try {
        const tree = await getWorkspaceTree(conversationId, '', searchTerm)
        setRoot(tree)
        if (searchTerm && tree) {
          // 搜索结果整树替换后展开全部（对齐 Sudowork useWorkspaceTree 的搜索行为）；
          // 根节点在渲染层被隐藏，展开键从 children 起收集
          const keys: string[] = []
          const walk = (node: WorkspaceNode): void => {
            if (node.isDir) {
              keys.push(node.relativePath)
              for (const child of node.children ?? []) walk(child)
            }
          }
          for (const child of tree.children ?? []) walk(child)
          setExpandedKeys(keys)
        }
      } catch {
        setRoot(null)
      } finally {
        setLoading(false)
      }
    },
    [conversationId],
  )

  // 首载 + 会话变化 + turn 结束 + 会话进行中信号 + 面板激活：刷新整树
  useEffect(() => {
    if (!active && root === null) return
    void refreshTree(debouncedSearch)
    // eslint 无法识别 refreshTree 的稳定性，依赖数组为有意取舍（与原实现一致）
  }, [conversationId, turnFinishedAt, workspaceRefreshKey, active])

  // 搜索 300ms 防抖 → 服务端搜索
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (active) void refreshTree(debouncedSearch)
    // 依赖数组为有意取舍（与原实现一致，避免与上面的整树刷新 effect 重复触发）
  }, [debouncedSearch])

  /** 目录懒加载：按 path 增量请求子树并合并（moss 带 path 时返回该目录子树） */
  const loadMore = useCallback(
    (node: { key?: unknown }): Promise<void> => {
      const path = String(node.key ?? '')
      return getWorkspaceTree(conversationId, path)
        .then((subtree) => {
          if (subtree) setRoot((prev) => (prev ? mergeSubtree(prev, path, subtree) : subtree))
        })
        .catch(() => undefined)
    },
    [conversationId],
  )

  async function openFilePreview(path: string, name: string): Promise<void> {
    setPreviewLoading(true)
    try {
      const file = await getWorkspaceFile(conversationId, path)
      setPreview({ name, mime: file.mime, content: file.content })
    } catch {
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  /** 拖拽/粘贴上传（上传到工作区根目录；客户端先按 10MB 预检，服务端仍有 413 兜底） */
  const handleUpload = useCallback(
    (files: File[]): void => {
      if (files.length === 0 || uploading) return
      void (async () => {
        setUploading(true)
        try {
          for (const file of files) {
            if (file.size > MAX_UPLOAD_BYTES) {
              Message.error(`「${file.name}」超过 10MB 上限`)
              continue
            }
            await uploadWorkspaceFile(conversationId, file.name, file)
          }
          await refreshTree(debouncedSearch)
        } catch (err) {
          const code = (err as { code?: string }).code
          Message.error(code === 'FILE_TOO_LARGE' ? '文件超过大小上限' : '上传失败，请重试')
        } finally {
          setUploading(false)
        }
      })()
    },
    [conversationId, debouncedSearch, refreshTree, uploading],
  )

  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      setDragOver(false)
      handleUpload(Array.from(e.dataTransfer.files ?? []))
    },
    [handleUpload],
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent): void => {
      handleUpload(Array.from(e.clipboardData.files ?? []))
    },
    [handleUpload],
  )

  // 隐藏根目录（对齐 Sudowork：单根时直接展示 children，工具栏已承担一级目录）+ 渲染层过滤隐藏条目
  const treeData = useMemo(
    () => (root ? filterHiddenNodes(root.children ?? []).flatMap(toTreeNodes) : []),
    [root],
  )
  const skillList: PanelSkill[] = options?.skills ?? []

  return (
    <div
      className='w-full h-full min-h-0 flex flex-col'
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onPaste={onPaste}
    >
      {/* 二级 tab（图标与参数对齐 Sudowork workspace/index.tsx:1185-1192） */}
      <div className='workspace-card__tabs shrink-0'>
        <button
          type='button'
          className={`workspace-card__tab${subTab === 'files' ? ' workspace-card__tab--active' : ''}`}
          onClick={() => setSubTab('files')}
        >
          <Cloudy theme='outline' size='14' fill={subTab === 'files' ? 'rgb(var(--primary-6))' : 'var(--text-secondary)'} />
          <span>临时空间</span>
        </button>
        <button
          type='button'
          className={`workspace-card__tab${subTab === 'skills' ? ' workspace-card__tab--active' : ''}`}
          onClick={() => setSubTab('skills')}
        >
          <Magic theme='outline' size='14' fill={subTab === 'skills' ? 'rgb(var(--primary-6))' : 'var(--text-secondary)'} />
          <span>可用技能</span>
        </button>
      </div>
      {/* 工具栏 */}
      <div className='flex items-center gap-2 px-4 py-2 shrink-0'>
        <Input
          size='small'
          value={search}
          onChange={setSearch}
          placeholder={subTab === 'files' ? '搜索文件…' : '搜索技能…'}
          aria-label='搜索工作空间'
          allowClear
        />
        <button
          type='button'
          aria-label='刷新'
          className='inline-flex items-center justify-center size-6 rd-4 border-none bg-transparent text-secondary cursor-pointer hover:bg-fill-2 transition-colors'
          onClick={() => void refreshTree(debouncedSearch)}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>
      {/* 内容 */}
      <div className='flex-1 min-h-0 overflow-y-auto' ref={treeScrollRef}>
        {subTab === 'files' ? (
          <>
            {treeData.length > 0 ? (
              <Tree
                className='!pl-8px !pr-16px workspace-tree'
                treeData={treeData}
                selectedKeys={[]}
                expandedKeys={expandedKeys}
                onExpand={(keys: string[]) => setExpandedKeys(keys)}
                loadMore={loadMore}
                onSelect={(_, extra) => {
                  const node = extra?.node as
                    | { props?: { isLeaf?: boolean }; key?: string | null }
                    | undefined
                  const key = node?.key
                  if (typeof key !== 'string') return
                  if (node?.props?.isLeaf) {
                    const name = key.split('/').pop() ?? key
                    void openFilePreview(key, name)
                    return
                  }
                  // 目录：单击切换展开（对齐 Sudowork workspace/index.tsx:1361-1364）
                  setExpandedKeys((prev) =>
                    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                  )
                }}
              />
            ) : (
              <Empty
                description={loading ? '加载中…' : debouncedSearch ? '未找到匹配文件' : '暂无工作区文件'}
                className='mt-8'
              />
            )}
          </>
        ) : skillList.length > 0 ? (
          <div className='flex flex-col gap-2 p-3'>
            {skillList
              .filter((s) => {
                const keyword = search.trim().toLowerCase()
                if (!keyword) return true
                return (
                  s.name.toLowerCase().includes(keyword) ||
                  (s.displayName ?? '').toLowerCase().includes(keyword) ||
                  (s.description ?? '').toLowerCase().includes(keyword)
                )
              })
              .map((s) => {
                const accent = resolveColor(s.color) ?? pickFallbackAccent(s.name)
                return (
                  <div
                    key={s.name}
                    className='flex items-start gap-8px px-10px py-8px rd-8px border b-solid border-[var(--border-light)] bg-[var(--color-bg-2)]'
                  >
                    <span
                      className='inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rd-6px'
                      style={{ backgroundColor: withAlpha(accent, 0.12) }}
                    >
                      <SkillIconGraphic skill={s} />
                    </span>
                    <div className='min-w-0 flex flex-col gap-2px'>
                      <span className='text-13px text-1 font-500 truncate'>{s.displayName || s.name}</span>
                      {s.description ? (
                        <span className='text-12px text-3 line-clamp-2'>{s.description}</span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <Empty description='暂无已安装的技能' className='mt-8' />
        )}
      </div>
      {/* 文件预览（复用交付物 tab 的预览形态） */}
      <Modal
        title={preview?.name ?? '预览'}
        visible={preview !== null || previewLoading}
        onCancel={() => setPreview(null)}
        footer={null}
        style={{ width: 680, maxHeight: '80vh' }}
      >
        {previewLoading ? (
          <div className='py-8 text-center text-13px text-tertiary'>加载中…</div>
        ) : preview ? (
          preview.mime.startsWith('image/') && preview.mime !== 'image/svg+xml' ? (
            <img src={`data:${preview.mime};base64,${preview.content}`} alt={preview.name} className='max-w-full' />
          ) : (
            <pre className='max-h-[60vh] overflow-auto text-12px whitespace-pre-wrap break-words text-foreground'>
              {preview.content}
            </pre>
          )
        ) : null}
      </Modal>
    </div>
  )
}
