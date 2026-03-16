/**
 * TaskPanel — Copilot DAG Task Panel
 *
 * 右侧面板：紧凑 mini tracker（card 样式）
 * 展开后：多 DAG 卡片列表，每张卡可折叠，深色画布 + 节点操作
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { IDirOrFile } from '@/common/ipcBridge';
import { useTaskDags } from './hooks/useTaskDags';
import { useTaskPanelHeader } from './TaskPanelHeaderContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused';
export type TaskType = 'search' | 'analyze' | 'generate' | 'code' | 'file' | 'api' | 'review' | 'summarize' | 'custom';

export interface TaskMetrics {
  created_at?: string;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
}

export interface SubTask {
  task_id: string;
  name: string;
  description?: string;
  type: TaskType;
  dependencies: string[];
  status: TaskStatus;
  priority?: number;
  metrics?: TaskMetrics;
  result?: { content?: string | null; artifacts?: string[]; structured_output?: Record<string, unknown> } | null;
  error?: { message?: string | null; code?: string | null } | null;
  worker_id?: string | null;
  retry?: { count: number; max: number };
  tags?: string[];
  notes?: string;
}

export interface DagProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  running: number;
  queued: number;
  pending: number;
}

export interface Dag {
  dag_id: string;
  title: string;
  status: TaskStatus;
  progress: DagProgress;
  created_at: string;
  tasks: SubTask[];
  summary?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<TaskStatus, { label: string; color: string; bg: string; border: string; dot: string; pulse?: boolean }> = {
  pending: { label: '待执行', color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0', dot: '#cbd5e1' },
  queued: { label: '已入队', color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', dot: '#60a5fa' },
  running: { label: '执行中', color: '#2563eb', bg: '#dbeafe', border: '#93c5fd', dot: '#3b82f6', pulse: true },
  completed: { label: '已完成', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', dot: '#22c55e' },
  failed: { label: '失败', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', dot: '#ef4444' },
  skipped: { label: '已跳过', color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', dot: '#d1d5db' },
  paused: { label: '已暂停', color: '#d97706', bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b' },
};

const TYPE_CFG: Record<TaskType, { icon: string }> = {
  search: { icon: '🔍' },
  analyze: { icon: '🧠' },
  generate: { icon: '✍️' },
  code: { icon: '💻' },
  file: { icon: '📁' },
  api: { icon: '🔌' },
  review: { icon: '🔎' },
  summarize: { icon: '📋' },
  custom: { icon: '⚙️' },
};

const DAG_STATUS_COLOR: Record<string, string> = {
  running: '#58a6ff',
  completed: '#3fb950',
  failed: '#f85149',
  pending: '#8b949e',
  paused: '#f59e0b',
  queued: '#60a5fa',
};

const DAG_STATUS_LABEL: Record<string, string> = {
  running: '正在运行',
  completed: '已完成',
  failed: '任务失败',
  pending: '等待中',
  paused: '已暂停',
  queued: '排队中',
  skipped: '已跳过',
};

// ─────────────────────────────────────────────────────────────────────────────
// Layout computation
// ─────────────────────────────────────────────────────────────────────────────

interface NodePos {
  x: number;
  y: number;
  w: number;
  h: number;
}

function makeLayout(nodeW: number, nodeH: number, colGap: number, rowGap: number, pad: number) {
  return function computeLayout(tasks: SubTask[]): { positions: Record<string, NodePos>; canvasW: number; canvasH: number } {
    const levelMap: Record<string, number> = {};
    function getLevel(id: string): number {
      if (levelMap[id] !== undefined) return levelMap[id];
      const t = tasks.find((x) => x.task_id === id);
      if (!t || t.dependencies.length === 0) return (levelMap[id] = 0);
      return (levelMap[id] = 1 + Math.max(...t.dependencies.map(getLevel)));
    }
    tasks.forEach((t) => getLevel(t.task_id));
    const cols: Record<number, string[]> = {};
    tasks.forEach((t) => {
      const lvl = levelMap[t.task_id];
      if (!cols[lvl]) cols[lvl] = [];
      cols[lvl].push(t.task_id);
    });
    if (!Object.keys(cols).length) return { positions: {}, canvasW: 0, canvasH: 0 };
    const maxLvl = Math.max(...Object.keys(cols).map(Number));
    const maxColSize = Math.max(...Object.values(cols).map((c) => c.length));
    const totalH = maxColSize * nodeH + Math.max(0, maxColSize - 1) * rowGap;
    const stride = nodeW + colGap;
    const positions: Record<string, NodePos> = {};
    Object.entries(cols).forEach(([lvl, ids]) => {
      const colH = ids.length * nodeH + Math.max(0, ids.length - 1) * rowGap;
      const startY = pad + (totalH - colH) / 2;
      ids.forEach((id, i) => {
        positions[id] = { x: pad + Number(lvl) * stride, y: startY + i * (nodeH + rowGap), w: nodeW, h: nodeH };
      });
    });
    return {
      positions,
      canvasW: pad * 2 + (maxLvl + 1) * stride - colGap,
      canvasH: pad * 2 + totalH,
    };
  };
}

// Panel DAG layout (compact)
const computeLayout = makeLayout(148, 60, 64, 12, 16);
// Fullscreen DAG layout (larger nodes)
const computeFullLayout = makeLayout(200, 100, 110, 50, 40);

// ─────────────────────────────────────────────────────────────────────────────
// Path display helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTaskColumns(tasks: SubTask[]): SubTask[][] {
  const levelMap: Record<string, number> = {};
  function getLevel(id: string): number {
    if (levelMap[id] !== undefined) return levelMap[id];
    const t = tasks.find((x) => x.task_id === id);
    if (!t || t.dependencies.length === 0) return (levelMap[id] = 0);
    return (levelMap[id] = 1 + Math.max(...t.dependencies.map(getLevel)));
  }
  tasks.forEach((t) => getLevel(t.task_id));
  const colMap: Record<number, SubTask[]> = {};
  tasks.forEach((t) => {
    const lvl = levelMap[t.task_id];
    if (!colMap[lvl]) colMap[lvl] = [];
    colMap[lvl].push(t);
  });
  if (!Object.keys(colMap).length) return [];
  const maxLvl = Math.max(...Object.keys(colMap).map(Number));
  return Array.from({ length: maxLvl + 1 }, (_, i) => colMap[i] || []);
}

const DOT_COLOR: Record<TaskStatus, string> = {
  completed: '#3fb950',
  running: '#58a6ff',
  queued: '#60a5fa',
  failed: '#f85149',
  pending: '#30363d',
  skipped: '#444c56',
  paused: '#f59e0b',
};

const SingleDot: React.FC<{ task: SubTask; size?: number }> = ({ task, size = 10 }) => {
  const color = DOT_COLOR[task.status] ?? '#30363d';
  const isRunning = task.status === 'running';
  return (
    <div
      title={task.name}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        boxShadow: isRunning ? `0 0 8px ${color}` : 'none',
        animation: isRunning ? 'copilotPulse 2s ease-in-out infinite' : 'none',
      }}
    />
  );
};

const PathDisplay: React.FC<{ tasks: SubTask[]; dotSize?: number }> = ({ tasks, dotSize = 10 }) => {
  const cols = getTaskColumns(tasks);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
      {cols.map((colTasks, i) => {
        const prevDone = i > 0 && cols[i - 1].every((t) => t.status === 'completed');
        return (
          <React.Fragment key={i}>
            {i > 0 && <div style={{ flexGrow: 1, height: 2, background: prevDone ? '#3fb950' : '#30363d', minWidth: 8 }} />}
            {colTasks.length === 1 ? (
              <SingleDot task={colTasks[0]} size={dotSize} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                {colTasks.map((t) => (
                  <SingleDot key={t.task_id} task={t} size={dotSize} />
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DAG Edges (shared)
// ─────────────────────────────────────────────────────────────────────────────

const DAGEdges: React.FC<{ tasks: SubTask[]; positions: Record<string, NodePos> }> = ({ tasks, positions }) => {
  const edges: { id: string; d: string; srcStatus: TaskStatus }[] = [];
  tasks.forEach((task) => {
    task.dependencies.forEach((depId) => {
      const src = positions[depId];
      const tgt = positions[task.task_id];
      if (!src || !tgt) return;
      const x1 = src.x + src.w,
        y1 = src.y + src.h / 2;
      const x2 = tgt.x,
        y2 = tgt.y + tgt.h / 2;
      const cx = (x1 + x2) / 2;
      edges.push({
        id: `${depId}→${task.task_id}`,
        d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
        srcStatus: (tasks.find((t) => t.task_id === depId)?.status ?? 'pending') as TaskStatus,
      });
    });
  });
  const edgeColor = (s: TaskStatus) => (s === 'completed' ? '#3fb950' : s === 'failed' ? '#f85149' : '#444c56');
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        {(['default', 'done', 'fail'] as const).map((id) => (
          <marker key={id} id={`cp-arr-fs-${id}`} markerWidth='7' markerHeight='7' refX='5' refY='3.5' orient='auto'>
            <path d='M 0 1 L 5 3.5 L 0 6 Z' fill={id === 'done' ? '#3fb950' : id === 'fail' ? '#f85149' : '#444c56'} />
          </marker>
        ))}
      </defs>
      {edges.map((e) => {
        const mid = e.srcStatus === 'completed' ? 'done' : e.srcStatus === 'failed' ? 'fail' : 'default';
        const dashed = ['pending', 'skipped', 'queued'].includes(e.srcStatus);
        return <path key={e.id} d={e.d} stroke={edgeColor(e.srcStatus)} strokeWidth={1.5} fill='none' strokeDasharray={dashed ? '5 4' : 'none'} markerEnd={`url(#cp-arr-fs-${mid})`} />;
      })}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Compact panel TaskNode (for detail drawer context)
// ─────────────────────────────────────────────────────────────────────────────

const PanelTaskNode: React.FC<{ task: SubTask; pos: NodePos; selected: boolean; onClick: (t: SubTask) => void }> = ({ task, pos, selected, onClick }) => {
  const sc = STATUS_CFG[task.status] ?? STATUS_CFG.pending;
  const tc = TYPE_CFG[task.type] ?? TYPE_CFG.custom;
  const isRunning = task.status === 'running';
  return (
    <div
      onClick={() => onClick(task)}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        borderRadius: 8,
        cursor: 'pointer',
        userSelect: 'none',
        background: selected ? 'var(--color-primary-light-1, #eff6ff)' : task.status === 'failed' ? '#fff8f8' : 'var(--color-bg-1, #fff)',
        border: `1.5px solid ${selected ? 'var(--color-primary, #3b82f6)' : sc.border}`,
        boxShadow: selected ? '0 0 0 3px rgba(59,130,246,0.15)' : isRunning ? `0 0 0 2px ${sc.border}` : '0 1px 3px rgba(0,0,0,0.05)',
        padding: '7px 9px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.1s',
        animation: isRunning ? 'copilotNodePulse 2s ease-in-out infinite' : 'none',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
        <span style={{ fontSize: 13, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>{tc.icon}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-1, #1e293b)', lineHeight: 1.3, flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{task.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 5px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: sc.color, background: sc.bg, border: `1px solid ${sc.border}`, whiteSpace: 'nowrap' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot, flexShrink: 0, animation: sc.pulse ? 'copilotPulse 1.4s ease-in-out infinite' : 'none' }} />
          {sc.label}
        </span>
        <span style={{ fontSize: 9.5, color: 'var(--color-text-3, #cbd5e1)', fontFamily: 'monospace' }}>{task.task_id}</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen large TaskNode
// ─────────────────────────────────────────────────────────────────────────────

const FullTaskNode: React.FC<{ task: SubTask; pos: NodePos; selected: boolean; onClick: (t: SubTask) => void }> = ({ task, pos, selected, onClick }) => {
  const isDone = task.status === 'completed';
  const isRunning = task.status === 'running';
  const isFailed = task.status === 'failed';

  const getSubtitle = () => {
    if (isDone && task.metrics?.duration_ms) return `耗时: ${(task.metrics.duration_ms / 1000).toFixed(1)}s`;
    if (isRunning) return '处理中...';
    if (isFailed) return task.error?.message?.slice(0, 50) ?? '执行失败';
    if (task.status === 'pending') return '等待中';
    if (task.status === 'queued') return '已入队';
    return STATUS_CFG[task.status]?.label ?? '';
  };

  const borderColor = selected ? '#58a6ff' : isDone ? '#3fb950' : isRunning ? '#3b82f6' : '#30363d';

  return (
    <div
      onClick={() => onClick(task)}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: pos.w,
        minHeight: pos.h,
        borderRadius: 10,
        overflow: 'hidden',
        background: '#1c2128',
        border: `1.5px solid ${borderColor}`,
        boxShadow: isRunning ? `0 0 0 1px ${borderColor}, 0 4px 20px rgba(88,166,255,0.12)` : selected ? '0 0 0 3px rgba(88,166,255,0.2)' : '0 4px 14px rgba(0,0,0,0.4)',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      <div style={{ padding: '14px 16px 10px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#c9d1d9', marginBottom: 5, lineHeight: 1.35 }}>{task.name}</div>
        <div style={{ fontSize: 12, color: '#8b949e' }}>{getSubtitle()}</div>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.025)', borderTop: '1px solid #30363d', padding: '7px 14px', display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
        <button
          className='cp-node-action'
          onClick={(e) => {
            e.stopPropagation();
            onClick(task);
          }}
        >
          日志
        </button>
        {(isRunning || isDone) && (
          <button
            className='cp-node-action'
            onClick={(e) => {
              e.stopPropagation();
              onClick(task);
            }}
          >
            详情
          </button>
        )}
        {isFailed && (
          <button
            className='cp-node-action'
            style={{ color: '#3fb950' }}
            onClick={(e) => {
              e.stopPropagation();
              onClick(task);
            }}
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Detail Drawer
// ─────────────────────────────────────────────────────────────────────────────

const MetricRow: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => {
  if (value === null || value === undefined) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #30363d' }}>
      <span style={{ fontSize: 11, color: '#8b949e' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9', fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
};

const DetailDrawer: React.FC<{ task: SubTask; dag: Dag; onClose: () => void; dark?: boolean }> = ({ task, dag, onClose, dark }) => {
  const tc = TYPE_CFG[task.type] ?? TYPE_CFG.custom;
  const sc = STATUS_CFG[task.status] ?? STATUS_CFG.pending;
  const m = task.metrics ?? {};
  const bg = dark ? '#161b22' : 'var(--color-bg-1, #fff)';
  const border = dark ? '#30363d' : 'var(--bg-3, #e2e8f0)';
  const titleColor = dark ? '#c9d1d9' : 'var(--color-text-1, #1e293b)';
  const textSecondary = dark ? '#8b949e' : 'var(--color-text-3, #94a3b8)';
  const bodyBg = dark ? '#0d1117' : 'var(--color-fill-2, #f8fafc)';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 280,
        background: bg,
        borderLeft: `1px solid ${border}`,
        boxShadow: dark ? '-8px 0 24px rgba(0,0,0,0.4)' : '-8px 0 24px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        animation: 'cpDrawerIn 0.18s ease-out',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: textSecondary, fontFamily: 'monospace', marginBottom: 2 }}>{task.task_id}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: titleColor, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>{tc.icon}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${border}`, background: bodyBg, cursor: 'pointer', fontSize: 14, color: textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
            ×
          </button>
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 99, fontSize: 11, fontWeight: 600, color: sc.color, background: dark ? 'rgba(0,0,0,0.3)' : sc.bg, border: `1px solid ${dark ? '#30363d' : sc.border}`, whiteSpace: 'nowrap' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot, animation: sc.pulse ? 'copilotPulse 1.4s ease-in-out infinite' : 'none' }} />
            {sc.label}
          </span>
          {task.retry && task.retry.count > 0 && (
            <span style={{ fontSize: 10, color: '#ef4444', background: dark ? 'rgba(239,68,68,0.1)' : '#fef2f2', border: '1px solid #fecaca', borderRadius: 99, padding: '1px 6px', fontWeight: 600 }}>
              重试 {task.retry.count}/{task.retry.max}
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {task.dependencies.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>依赖</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {task.dependencies.map((d) => {
                const dep = dag.tasks.find((t) => t.task_id === d);
                return (
                  <span key={d} style={{ padding: '2px 8px', borderRadius: 6, background: dark ? '#0d1117' : dep ? STATUS_CFG[dep.status].bg : '#f1f5f9', border: `1px solid ${border}`, fontSize: 10.5, fontFamily: 'monospace', color: dark ? '#8b949e' : '#475569' }}>
                    {d}
                    {dep ? ` · ${STATUS_CFG[dep.status].label}` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {task.description && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>任务说明</div>
            <div style={{ fontSize: 11.5, color: dark ? '#8b949e' : '#475569', lineHeight: 1.6, background: bodyBg, borderRadius: 7, padding: 10, border: `1px solid ${border}` }}>{task.description}</div>
          </div>
        )}
        {(m.duration_ms || m.total_tokens) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>执行指标</div>
            <div style={{ background: bodyBg, borderRadius: 7, padding: '2px 10px', border: `1px solid ${border}` }}>
              <MetricRow label='耗时' value={m.duration_ms ? `${(m.duration_ms / 1000).toFixed(1)}s` : undefined} />
              <MetricRow label='Token' value={m.total_tokens?.toLocaleString()} />
              <MetricRow label='费用' value={m.cost_usd != null ? `$${m.cost_usd.toFixed(4)}` : undefined} />
            </div>
          </div>
        )}
        {task.result?.content && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>执行结果</div>
            <div style={{ fontSize: 11, color: dark ? '#3fb950' : '#334155', lineHeight: 1.65, background: dark ? 'rgba(63,185,80,0.08)' : '#f0fdf4', border: `1px solid ${dark ? '#3fb950' : '#bbf7d0'}`, borderRadius: 7, padding: 10 }}>{task.result.content}</div>
          </div>
        )}
        {task.error?.message && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>错误信息</div>
            <div style={{ fontSize: 11, lineHeight: 1.6, background: dark ? 'rgba(248,81,73,0.08)' : '#fef2f2', border: `1px solid ${dark ? '#f85149' : '#fecaca'}`, borderRadius: 7, padding: 10 }}>
              <div style={{ color: '#f85149', fontFamily: 'monospace', wordBreak: 'break-all' }}>{task.error.message}</div>
              {task.error.code && <div style={{ marginTop: 4, color: '#f87171', fontSize: 10 }}>Code: {task.error.code}</div>}
            </div>
          </div>
        )}
        {task.worker_id && <div style={{ fontSize: 10, color: textSecondary, fontFamily: 'monospace', textAlign: 'right' }}>worker: {task.worker_id}</div>}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DagCardList — 全屏详情页（多 DAG 卡片列表）
// ─────────────────────────────────────────────────────────────────────────────

const DagCardList: React.FC<{
  dags: Dag[];
  onClose: () => void;
}> = ({ dags, onClose }) => {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
    const s = new Set<string>();
    dags.forEach((d) => {
      if (d.status === 'running' || d.status === 'queued' || dags.length === 1) s.add(d.dag_id);
    });
    return s;
  });
  const [selectedTask, setSelectedTask] = useState<{ dagId: string; task: SubTask } | null>(null);

  const toggle = (dagId: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(dagId)) {
        next.delete(dagId);
        setSelectedTask(null);
      } else next.add(dagId);
      return next;
    });
  };

  const handleNodeClick = (dagId: string, task: SubTask) => {
    setSelectedTask((prev) => (prev?.dagId === dagId && prev.task.task_id === task.task_id ? null : { dagId, task }));
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: '#0d1117',
        overflowY: 'auto',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        animation: 'cpFullscreenIn 0.18s ease-out',
      }}
    >
      {/* Fixed top header — clears Mac traffic lights on the left, close on the right */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          height: 52,
          background: '#161b22',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px 0 80px', // 80px left margin clears Mac traffic light buttons
          gap: 10,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#c9d1d9', flex: 1 }}>任务面板</span>
        <span style={{ fontSize: 12, color: '#555f6e', fontVariantNumeric: 'tabular-nums' }}>{dags.length} 个任务</span>
        <button
          onClick={onClose}
          title='关闭'
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 8,
            padding: 0,
            border: '1px solid #30363d',
            background: 'transparent',
            cursor: 'pointer',
            color: '#8b949e',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#21262d';
            (e.currentTarget as HTMLButtonElement).style.color = '#c9d1d9';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = '#8b949e';
          }}
        >
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round'>
            <line x1='18' y1='6' x2='6' y2='18' />
            <line x1='6' y1='6' x2='18' y2='18' />
          </svg>
        </button>
      </div>

      <div style={{ padding: '68px 20px 40px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1400, margin: '0 auto' }}>
        {dags.map((dag, idx) => {
          const isExpanded = expandedSet.has(dag.dag_id);
          const percent = dag.progress.total > 0 ? Math.round((dag.progress.completed / dag.progress.total) * 100) : 0;
          const accentColor = DAG_STATUS_COLOR[dag.status] ?? '#8b949e';
          const { positions, canvasW, canvasH } = isExpanded ? computeFullLayout(dag.tasks) : { positions: {}, canvasW: 0, canvasH: 0 };
          const activeSel = selectedTask?.dagId === dag.dag_id ? selectedTask.task : null;

          return (
            <div
              key={dag.dag_id}
              style={{
                background: '#161b22',
                border: `1px solid ${isExpanded ? accentColor + '55' : '#30363d'}`,
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: isExpanded ? `0 0 30px rgba(0,0,0,0.5), 0 0 0 1px ${accentColor}22` : '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            >
              {/* Card header */}
              <div
                onClick={() => toggle(dag.dag_id)}
                style={{
                  padding: '18px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderBottom: isExpanded ? '1px solid #21262d' : 'none',
                }}
              >
                {/* Index + Title */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: isExpanded ? accentColor : '#555f6e', flexShrink: 0, fontFamily: 'monospace' }}>#{String(idx + 1).padStart(3, '0')}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dag.title}</span>
                </div>

                {/* Status + path + percent + chevron */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: accentColor, letterSpacing: '0.06em' }}>{(DAG_STATUS_LABEL[dag.status] ?? dag.status).toUpperCase()}</span>
                  <div style={{ width: 140, display: 'flex', alignItems: 'center' }}>
                    <PathDisplay tasks={dag.tasks} dotSize={10} />
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: accentColor, minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{percent}%</span>
                  {/* Expand chevron */}
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      background: isExpanded ? accentColor : 'rgba(255,255,255,0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    <svg width='18' height='18' viewBox='0 0 24 24' style={{ fill: isExpanded ? '#fff' : '#8b949e', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
                      <path d='M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z' />
                    </svg>
                  </div>
                </div>
              </div>

              {/* DAG canvas */}
              {isExpanded && (
                <div
                  style={{
                    position: 'relative',
                    height: Math.max(canvasH + 60, 300),
                    overflow: 'auto',
                    background: '#090c10',
                    backgroundImage: 'radial-gradient(#1f242c 1px, transparent 1px)',
                    backgroundSize: '30px 30px',
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      width: Math.max(canvasW, 600),
                      height: Math.max(canvasH, 260),
                      minWidth: '100%',
                      minHeight: '100%',
                    }}
                  >
                    <DAGEdges tasks={dag.tasks} positions={positions} />
                    {dag.tasks.map((task) => (
                      <FullTaskNode key={task.task_id} task={task} pos={positions[task.task_id]} selected={activeSel?.task_id === task.task_id} onClick={(t) => handleNodeClick(dag.dag_id, t)} />
                    ))}
                  </div>
                  {activeSel && <DetailDrawer task={activeSel} dag={dag} dark onClose={() => setSelectedTask(null)} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main TaskPanel component
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskPanelProps {
  workspaceFiles?: IDirOrFile[];
}

const TaskPanel: React.FC<TaskPanelProps> = ({ workspaceFiles = [] }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [hasScrollMore, setHasScrollMore] = useState(false);

  const { dags, isLoading } = useTaskDags(workspaceFiles);
  const { setDagCount, openFullscreenRef } = useTaskPanelHeader();

  // Sync dag count to header
  useEffect(() => {
    setDagCount(dags.length);
    return () => setDagCount(0);
  }, [dags.length, setDagCount]);

  // Register fullscreen opener with header
  useEffect(() => {
    openFullscreenRef.current = () => setFullscreen(true);
    return () => {
      openFullscreenRef.current = null;
    };
  }, [openFullscreenRef]);

  const checkScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setHasScrollMore(el.scrollHeight - el.scrollTop > el.clientHeight + 4);
  }, []);

  useEffect(() => {
    checkScroll();
  }, [dags, checkScroll]);

  if (!dags.length) return isLoading ? <style>{STYLES}</style> : null;

  return (
    <>
      <style>{STYLES}</style>

      {/* ── Mini Tracker ──────────────────────────────────────────────── */}
      <div
        className='task-panel'
        style={{
          padding: '8px 10px 10px',
          borderBottom: '1px solid var(--bg-3, #e2e8f0)',
          userSelect: 'none',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Scrollable card list */}
        <div style={{ position: 'relative' }}>
          <div
            ref={listRef}
            className='task-panel__card-list'
            onScroll={checkScroll}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 'calc(50vh - 80px)',
              overflowY: 'auto',
              paddingRight: 1,
            }}
          >
            {dags.map((d) => {
              const p = d.progress.total > 0 ? Math.round((d.progress.completed / d.progress.total) * 100) : 0;
              const sLabel = DAG_STATUS_LABEL[d.status] ?? d.status;
              const aColor = DAG_STATUS_COLOR[d.status] ?? '#8b949e';
              return (
                <div
                  key={d.dag_id}
                  style={{
                    background: 'var(--color-bg-2, rgba(22,27,34,0.9))',
                    borderRadius: 10,
                    border: '1px solid var(--bg-3, #30363d)',
                    borderTop: `2px solid ${aColor}`,
                    padding: '10px 12px 11px',
                    flexShrink: 0,
                  }}
                >
                  {/* Row 1: status + title + STEP */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--color-text-3, #8b949e)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {sLabel}: <span style={{ color: 'var(--color-text-1, #c9d1d9)', fontWeight: 500 }}>{d.title}</span>
                    </span>
                    <span style={{ fontSize: 11, color: aColor, fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      STEP {d.progress.completed}/{d.progress.total}
                    </span>
                  </div>

                  {/* Row 2: PathDisplay + percent */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PathDisplay tasks={d.tasks} dotSize={10} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: aColor, flexShrink: 0, minWidth: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fade overlay when more content is below */}
          {hasScrollMore && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 36,
                background: 'linear-gradient(to bottom, transparent, var(--color-bg-1, #f6f8fa))',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>

      {/* ── Fullscreen card list ──────────────────────────────────────── */}
      {fullscreen && <DagCardList dags={dags} onClose={() => setFullscreen(false)} />}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyframes
// ─────────────────────────────────────────────────────────────────────────────

const STYLES = `
  @keyframes copilotPulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }
  @keyframes copilotProgress {
    0%, 100% { opacity: 0.7; }
    50%       { opacity: 1; }
  }
  @keyframes copilotNodePulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(147,197,253,0.5), 0 2px 6px rgba(0,0,0,0.04); }
    50%       { box-shadow: 0 0 0 3px rgba(147,197,253,0.8), 0 2px 10px rgba(59,130,246,0.18); }
  }
  @keyframes cpDrawerIn {
    from { transform: translateX(16px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  @keyframes cpFullscreenIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .task-panel__expand-btn:hover {
    background: rgba(255,255,255,0.1) !important;
    color: #c9d1d9 !important;
  }
  .task-panel__card-list::-webkit-scrollbar { width: 3px; }
  .task-panel__card-list::-webkit-scrollbar-track { background: transparent; }
  .task-panel__card-list::-webkit-scrollbar-thumb { background: var(--bg-3, #30363d); border-radius: 99px; }
  .task-panel__card-list::-webkit-scrollbar-thumb:hover { background: #8b949e; }
  .cp-node-action {
    font-size: 11px;
    color: #58a6ff;
    cursor: pointer;
    text-decoration: none;
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
  }
  .cp-node-action:hover { text-decoration: underline; }
`;

export default TaskPanel;
