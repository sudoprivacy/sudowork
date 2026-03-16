/**
 * useTaskDags — 扫描 workspace/.tasks/ 目录，读取 DAG JSON 并实时监听变化
 *
 * 逻辑链路：会话 → workspace 路径 → 扫描 .tasks/ → 读取 JSON → 监听变化
 * 完全独立于 Tree 组件，直接通过 IPC 读取文件系统。
 *
 * 监听策略（三层）：
 *   1. workspace 根目录  → .tasks/ 目录首次出现时触发重扫
 *   2. .tasks/ 目录      → 新增 dag_xxx/ 子目录时触发重扫
 *   3. dag_xxx.json 文件 → 文件内容更新时刷新对应 DAG 状态
 */

import { ipcBridge } from '@/common';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dag } from '../TaskPanel';

/** 列出 workspace/.tasks/ 下所有 dag_xxx/dag_xxx.json 的绝对路径 */
async function scanDagJsonPaths(workspace: string): Promise<string[]> {
  if (!workspace) return [];
  const tasksDir = `${workspace}/.tasks`;
  try {
    const entries = await ipcBridge.fs.getFilesByDir.invoke({ dir: tasksDir, root: workspace });
    const dagDirs = (entries[0]?.children ?? []).filter(e => e.isDir && e.name.startsWith('dag_'));
    return dagDirs.map(e => `${e.fullPath}/${e.name}.json`);
  } catch {
    return [];
  }
}

export function useTaskDags(workspace: string) {
  const [dags, setDags] = useState<Dag[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /** 已监听的 JSON 文件路径集合 */
  const watchedJsonRef = useRef<Set<string>>(new Set());
  /** 当前 workspace 路径（供 fileChanged 回调使用）*/
  const workspaceRef = useRef('');
  /** .tasks/ 目录路径（供 fileChanged 回调使用）*/
  const tasksDirRef = useRef('');
  /** 序列号：丢弃被并发调用覆盖的旧结果 */
  const loadSeqRef = useRef(0);

  const loadDag = useCallback(async (jsonPath: string): Promise<Dag | null> => {
    try {
      const content = await ipcBridge.fs.readFile.invoke({ path: jsonPath });
      if (!content) return null;
      return JSON.parse(content) as Dag;
    } catch {
      return null;
    }
  }, []);

  const loadAllDags = useCallback(async (): Promise<Dag[]> => {
    if (!workspace) return [];
    const seq = ++loadSeqRef.current;
    setIsLoading(true);
    try {
      const jsonPaths = await scanDagJsonPaths(workspace);

      if (seq !== loadSeqRef.current) return [];

      const results: Dag[] = [];
      const activePaths: string[] = [];

      for (const p of jsonPaths) {
        if (seq !== loadSeqRef.current) return [];
        const dag = await loadDag(p);
        if (dag) {
          results.push(dag);
          activePaths.push(p);
        }
      }

      if (seq !== loadSeqRef.current) return [];

      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setDags(results);

      // 同步 JSON 文件 watcher（只监听已成功解析的文件）
      for (const p of activePaths) {
        if (!watchedJsonRef.current.has(p)) {
          ipcBridge.fileWatch.startWatch.invoke({ filePath: p }).catch(() => {});
          watchedJsonRef.current.add(p);
        }
      }
      for (const p of watchedJsonRef.current) {
        if (!activePaths.includes(p)) {
          ipcBridge.fileWatch.stopWatch.invoke({ filePath: p }).catch(() => {});
          watchedJsonRef.current.delete(p);
        }
      }

      return results;
    } catch {
      return [];
    } finally {
      if (seq === loadSeqRef.current) setIsLoading(false);
    }
  }, [workspace, loadDag]);

  // workspace 变化：立即扫描，并监听两层目录
  useEffect(() => {
    if (!workspace) return;
    workspaceRef.current = workspace;
    tasksDirRef.current = `${workspace}/.tasks`;

    void loadAllDags();

    // 层 1：监听 workspace 根目录 —— .tasks/ 首次创建时触发
    ipcBridge.fileWatch.startWatch.invoke({ filePath: workspace }).catch(() => {});
    // 层 2：监听 .tasks/ 目录 —— 新增 dag_xxx/ 子目录时触发（.tasks/ 可能尚不存在，失败静默）
    ipcBridge.fileWatch.startWatch.invoke({ filePath: tasksDirRef.current }).catch(() => {});

    return () => {
      ipcBridge.fileWatch.stopWatch.invoke({ filePath: workspace }).catch(() => {});
      ipcBridge.fileWatch.stopWatch.invoke({ filePath: tasksDirRef.current }).catch(() => {});
      workspaceRef.current = '';
      tasksDirRef.current = '';
    };
  }, [workspace, loadAllDags]);

  // 文件/目录变更监听
  useEffect(() => {
    const unsub = ipcBridge.fileWatch.fileChanged.on(async ({ filePath, eventType }) => {

      // ── 层 1/2：根目录或 .tasks/ 目录变化 → 重新扫描全部 DAG ──────────────
      if (filePath === workspaceRef.current || filePath === tasksDirRef.current) {
        // .tasks/ 可能刚被创建，尝试补注册其 watcher
        ipcBridge.fileWatch.startWatch.invoke({ filePath: tasksDirRef.current }).catch(() => {});
        void loadAllDags();
        return;
      }

      // ── 层 3：JSON 文件变化 → 刷新对应 DAG ────────────────────────────────
      if (!watchedJsonRef.current.has(filePath)) return;

      // 'rename' 表示文件被原子替换（tmp → mv），旧 inode 已失效，需重新注册 watcher
      if (eventType === 'rename') {
        ipcBridge.fileWatch.startWatch.invoke({ filePath }).catch(() => {});
      }

      // 原子写入时文件在极短时间内可能不存在，稍作延迟再读
      const doRead = async () => {
        const updated = await loadDag(filePath);
        if (!updated) return;
        setDags(prev => {
          const idx = prev.findIndex(d => d.dag_id === updated.dag_id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updated;
            return next;
          }
          // 新文件（首次写入完成），追加到列表头部
          return [updated, ...prev];
        });
      };

      if (eventType === 'rename') {
        // 等待原子写入完成（rename 后新文件落盘）
        setTimeout(() => void doRead(), 50);
      } else {
        void doRead();
      }
    });
    return () => unsub();
  }, [loadAllDags, loadDag]);

  // 卸载时清理所有 JSON 文件 watcher
  useEffect(() => {
    return () => {
      for (const p of watchedJsonRef.current) {
        ipcBridge.fileWatch.stopWatch.invoke({ filePath: p }).catch(() => {});
      }
    };
  }, []);

  return { dags, isLoading, reload: loadAllDags };
}
