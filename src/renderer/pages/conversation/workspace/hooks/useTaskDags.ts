/**
 * useTaskDags — 从文件树数据中提取 .tasks/ DAG JSON 并读取内容
 *
 * 直接复用 treeHook.files（文件树已加载的目录树），不额外发起任何目录扫描请求。
 * 找到 JSON 路径后用 readFile 读取内容，并通过 fileWatch 监听文件内容变更。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import type { Dag } from '../TaskPanel';

/**
 * 在目录树中找出所有 .tasks/dag_xxx/dag_xxx.json 文件节点。
 *
 * .tasks/ 只会出现在 workspace 根目录（${workspacePath}/.tasks），所以只在
 * 顶层节点中查找，最多进入一层 wrapper 根节点（treeHook.files = [rootNode]）。
 * 不做深层递归，避免误命中子项目中的 .tasks/ 目录。
 */
function findDagJsonNodes(nodes: IDirOrFile[]): IDirOrFile[] {
  const extractFromTasksDir = (tasksNode: IDirOrFile): IDirOrFile[] => {
    const results: IDirOrFile[] = [];
    for (const dagDir of tasksNode.children ?? []) {
      if (!dagDir.isDir || !dagDir.name.startsWith('dag_')) continue;
      for (const file of dagDir.children ?? []) {
        if (file.isFile && file.name.startsWith('dag_') && file.name.endsWith('.json')) {
          results.push(file);
        }
      }
    }
    return results;
  };

  // 1. 在顶层节点中查找 .tasks/
  for (const node of nodes) {
    if (node.isDir && node.name === '.tasks') {
      return extractFromTasksDir(node);
    }
  }

  // 2. treeHook.files 通常是 [rootNode]（wrapper），检查其 children 一层
  if (nodes.length === 1 && nodes[0].isDir && (nodes[0].children?.length ?? 0) > 0) {
    for (const child of nodes[0].children!) {
      if (child.isDir && child.name === '.tasks') {
        return extractFromTasksDir(child);
      }
    }
  }

  return [];
}

export function useTaskDags(workspaceFiles: IDirOrFile[], workspace: string) {
  const [dags, setDags] = useState<Dag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const watchedRef = useRef<Set<string>>(new Set());

  // Reset immediately when workspace identity changes — ensures the panel
  // goes blank before the new file tree finishes loading, preventing stale
  // DAGs from a previous workspace from being visible during the gap.
  useEffect(() => {
    setDags([]);
    setIsLoading(false);
    for (const p of watchedRef.current) {
      ipcBridge.fileWatch.stopWatch.invoke({ filePath: p }).catch(() => {});
    }
    watchedRef.current.clear();
  }, [workspace]);

  const loadDag = useCallback(async (path: string): Promise<Dag | null> => {
    try {
      const content = await ipcBridge.fs.readFile.invoke({ path });
      if (!content) return null;
      return JSON.parse(content) as Dag;
    } catch {
      return null;
    }
  }, []);

  // 文件树变化时，重新派生 dag 文件路径并读取内容
  useEffect(() => {
    const jsonNodes = findDagJsonNodes(workspaceFiles);
    if (jsonNodes.length === 0) {
      setDags([]);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    void (async () => {
      const results: Dag[] = [];
      const activePaths: string[] = [];

      for (const node of jsonNodes) {
        const dag = await loadDag(node.fullPath);
        if (dag) {
          results.push(dag);
          activePaths.push(node.fullPath);
        }
      }

      if (cancelled) return;

      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setDags(results);
      setIsLoading(false);

      // 同步 watcher（监听 JSON 内容变更，Worker 写入结果时实时刷新）
      for (const p of activePaths) {
        if (!watchedRef.current.has(p)) {
          ipcBridge.fileWatch.startWatch.invoke({ filePath: p }).catch(() => {});
          watchedRef.current.add(p);
        }
      }
      for (const p of watchedRef.current) {
        if (!activePaths.includes(p)) {
          ipcBridge.fileWatch.stopWatch.invoke({ filePath: p }).catch(() => {});
          watchedRef.current.delete(p);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceFiles, loadDag]);

  // 监听 JSON 文件内容变更（Worker 写入后实时更新对应 DAG）
  useEffect(() => {
    const unsub = ipcBridge.fileWatch.fileChanged.on(async ({ filePath, eventType }) => {
      if (!watchedRef.current.has(filePath)) return;

      if (eventType === 'unlink') {
        ipcBridge.fileWatch.stopWatch.invoke({ filePath }).catch(() => {});
        watchedRef.current.delete(filePath);
        setDags((prev) => prev.filter((d) => !filePath.includes(d.dag_id)));
        return;
      }

      // rename = 原子写入完成，稍等 50ms 再读
      const read = async () => {
        const updated = await loadDag(filePath);
        if (!updated) return;
        // rename 后 inode 变了，重新注册 watcher
        if (eventType === 'rename') {
          ipcBridge.fileWatch.startWatch.invoke({ filePath }).catch(() => {});
        }
        setDags((prev) => {
          const idx = prev.findIndex((d) => d.dag_id === updated.dag_id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updated;
            return next;
          }
          return [updated, ...prev];
        });
      };

      if (eventType === 'rename') setTimeout(() => void read(), 50);
      else void read();
    });
    return () => unsub();
  }, [loadDag]);

  // 卸载时清理
  useEffect(
    () => () => {
      for (const p of watchedRef.current) {
        ipcBridge.fileWatch.stopWatch.invoke({ filePath: p }).catch(() => {});
      }
    },
    []
  );

  return { dags, isLoading };
}
