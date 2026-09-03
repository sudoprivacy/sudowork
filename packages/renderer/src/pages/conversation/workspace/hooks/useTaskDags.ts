/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useTaskDags — 从 .sudocode-tasks.json 读取 TaskRegistry 数据并按依赖关系分组为 DAG
 *
 * 读取 workspace 根目录下的 .sudocode-tasks.json，解析为 Task 数组，
 * 通过连通分量算法将有依赖关系的任务分组为 DAG，并通过 fileWatch 监听文件变更。
 */

import type { IDirOrFile } from '@sudowork/host-bridge/ipcBridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { Dag, SubTask, TaskStatus, TaskType } from '../TaskPanel';

// ─────────────────────────────────────────────────────────────────────────────
// TaskRegistry types (from .sudocode-tasks.json)
// ─────────────────────────────────────────────────────────────────────────────

interface RegistryTask {
  task_id: string;
  subject: string;
  prompt: string;
  description?: string;
  activeForm?: string;
  task_packet?: unknown;
  status: 'pending' | 'in_progress' | 'created' | 'running' | 'completed' | 'failed' | 'stopped';
  created_at: number; // unix seconds
  updated_at: number;
  messages: Array<{ role: string; content: string; timestamp: number }>;
  output: string;
  dependencies?: string[]; // task_ids this task depends on
}

// ─────────────────────────────────────────────────────────────────────────────
// Status mapping
// ─────────────────────────────────────────────────────────────────────────────

function mapStatus(status: RegistryTask['status']): TaskStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'in_progress':
    case 'running':
      return 'running';
    case 'created':
      return 'queued';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'skipped';
    default:
      return 'pending';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connected component grouping
// ─────────────────────────────────────────────────────────────────────────────

function groupIntoDags(tasks: RegistryTask[]): Dag[] {
  const taskMap = new Map(tasks.map((t) => [t.task_id, t]));
  const visited = new Set<string>();
  const components: RegistryTask[][] = [];

  function dfs(id: string, component: RegistryTask[]) {
    if (visited.has(id)) return;
    visited.add(id);
    const task = taskMap.get(id);
    if (!task) return;
    component.push(task);
    // Follow dependencies (forward)
    for (const dep of task.dependencies ?? []) {
      dfs(dep, component);
    }
    // Follow reverse dependencies (find tasks that depend on this one)
    for (const t of tasks) {
      if ((t.dependencies ?? []).includes(id)) {
        dfs(t.task_id, component);
      }
    }
  }

  for (const task of tasks) {
    if (!visited.has(task.task_id)) {
      const component: RegistryTask[] = [];
      dfs(task.task_id, component);
      components.push(component);
    }
  }

  // Convert each component to a Dag
  return components.map((comp) => {
    // Root task = task with no dependencies (or fewest)
    const roots = comp.filter((t) => !t.dependencies?.length);
    const title = roots[0]?.subject ?? comp[0].subject;
    const statuses = comp.map((t) => t.status);

    let dagStatus: TaskStatus = 'pending';
    if (statuses.some((s) => s === 'running' || s === 'in_progress')) dagStatus = 'running';
    else if (statuses.every((s) => s === 'completed')) dagStatus = 'completed';
    else if (statuses.some((s) => s === 'failed')) dagStatus = 'failed';

    const subtasks: SubTask[] = comp.map((t) => ({
      task_id: t.task_id,
      name: t.subject,
      description: t.description ?? undefined,
      type: 'custom' as TaskType,
      dependencies: t.dependencies ?? [],
      status: mapStatus(t.status),
      metrics: { created_at: new Date(t.created_at * 1000).toISOString() },
    }));

    const completed = subtasks.filter((s) => s.status === 'completed').length;
    const failed = subtasks.filter((s) => s.status === 'failed').length;
    const running = subtasks.filter((s) => s.status === 'running').length;
    const pending = subtasks.filter((s) => s.status === 'pending').length;

    return {
      dag_id: `group_${comp[0].task_id}`,
      title,
      status: dagStatus,
      progress: {
        total: comp.length,
        completed,
        failed,
        skipped: subtasks.filter((s) => s.status === 'skipped').length,
        running,
        queued: subtasks.filter((s) => s.status === 'queued').length,
        pending,
      },
      created_at: new Date(comp[0].created_at * 1000).toISOString(),
      tasks: subtasks,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

const TASKS_FILENAME = '.sudocode-tasks.json';

export function useTaskDags(_workspaceFiles: IDirOrFile[], workspace: string) {
  const [dags, setDags] = useState<Dag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const watchedRef = useRef<string | null>(null);

  const tasksFilePath = workspace ? `${workspace}/${TASKS_FILENAME}` : '';

  const loadAndParse = useCallback(async (path: string): Promise<Dag[]> => {
    try {
      const content = await ipcBridge.fs.readFile.invoke({ path });
      if (!content) return [];
      const tasks: RegistryTask[] = JSON.parse(content);
      if (!Array.isArray(tasks)) return [];
      return groupIntoDags(tasks);
    } catch {
      return [];
    }
  }, []);

  // Reset when workspace changes
  useEffect(() => {
    setDags([]);
    setIsLoading(false);
    if (watchedRef.current) {
      ipcBridge.fileWatch.stopWatch.invoke({ filePath: watchedRef.current }).catch(() => {});
      watchedRef.current = null;
    }
  }, [workspace]);

  // Initial load + set up watcher
  useEffect(() => {
    if (!tasksFilePath) return;

    setIsLoading(true);
    let cancelled = false;

    void (async () => {
      const result = await loadAndParse(tasksFilePath);
      if (cancelled) return;

      setDags(result);
      setIsLoading(false);

      // Start watching the file
      if (watchedRef.current !== tasksFilePath) {
        if (watchedRef.current) {
          ipcBridge.fileWatch.stopWatch.invoke({ filePath: watchedRef.current }).catch(() => {});
        }
        ipcBridge.fileWatch.startWatch.invoke({ filePath: tasksFilePath }).catch(() => {});
        watchedRef.current = tasksFilePath;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tasksFilePath, loadAndParse]);

  // Listen for file changes
  useEffect(() => {
    const unsub = ipcBridge.fileWatch.fileChanged.on(async ({ filePath, eventType }) => {
      if (filePath !== watchedRef.current) return;

      if (eventType === 'unlink') {
        setDags([]);
        ipcBridge.fileWatch.stopWatch.invoke({ filePath }).catch(() => {});
        watchedRef.current = null;
        return;
      }

      const read = async () => {
        const result = await loadAndParse(filePath);
        setDags(result);
        // Re-register watcher after rename (inode changed)
        if (eventType === 'rename') {
          ipcBridge.fileWatch.startWatch.invoke({ filePath }).catch(() => {});
        }
      };

      if (eventType === 'rename') setTimeout(() => void read(), 50);
      else void read();
    });
    return () => unsub();
  }, [loadAndParse]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (watchedRef.current) {
        ipcBridge.fileWatch.stopWatch.invoke({ filePath: watchedRef.current }).catch(() => {});
      }
    },
    []
  );

  return { dags, isLoading };
}
