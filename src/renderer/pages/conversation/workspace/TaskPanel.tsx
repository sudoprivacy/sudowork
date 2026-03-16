/**
 * TaskPanel — Copilot DAG Task Panel
 *
 * 位置：右侧 sider，工作空间文件树上方
 * 展示来自 .tasks/ 目录的所有 DAG 任务，含依赖关系可视化、状态追踪和详情抽屉
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTaskDags } from './hooks/useTaskDags';

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
  pending:   { label: '待执行', color: '#94a3b8', bg: '#f8fafc',   border: '#e2e8f0', dot: '#cbd5e1' },
  queued:    { label: '已入队', color: '#3b82f6', bg: '#eff6ff',   border: '#bfdbfe', dot: '#60a5fa' },
  running:   { label: '执行中', color: '#2563eb', bg: '#dbeafe',   border: '#93c5fd', dot: '#3b82f6', pulse: true },
  completed: { label: '已完成', color: '#16a34a', bg: '#f0fdf4',   border: '#bbf7d0', dot: '#22c55e' },
  failed:    { label: '失败',   color: '#dc2626', bg: '#fef2f2',   border: '#fecaca', dot: '#ef4444' },
  skipped:   { label: '已跳过', color: '#9ca3af', bg: '#f9fafb',   border: '#e5e7eb', dot: '#d1d5db' },
  paused:    { label: '已暂停', color: '#d97706', bg: '#fffbeb',   border: '#fde68a', dot: '#f59e0b' },
};

const TYPE_CFG: Record<TaskType, { icon: string; label: string }> = {
  search:    { icon: '🔍', label: '搜索'   },
  analyze:   { icon: '🧠', label: '分析'   },
  generate:  { icon: '✍️', label: '生成'   },
  code:      { icon: '💻', label: '代码'   },
  file:      { icon: '📁', label: '文件'   },
  api:       { icon: '🔌', label: 'API'    },
  review:    { icon: '🔎', label: '审阅'   },
  summarize: { icon: '📋', label: '汇总'   },
  custom:    { icon: '⚙️', label: '自定义' },
};

const DAG_STATUS_COLOR: Record<string, string> = {
  running:   '#3b82f6',
  completed: '#22c55e',
  failed:    '#ef4444',
  pending:   '#94a3b8',
  paused:    '#f59e0b',
};


// ─────────────────────────────────────────────────────────────────────────────
// Layout computation
// ─────────────────────────────────────────────────────────────────────────────

const NODE_W = 148;
const NODE_H = 60;
const COL_GAP = 64;
const ROW_GAP = 12;
const COL_STRIDE = NODE_W + COL_GAP;
const PAD = 16;

interface NodePos { x: number; y: number; w: number; h: number }

function computeLayout(tasks: SubTask[]): { positions: Record<string, NodePos>; canvasW: number; canvasH: number } {
  const levelMap: Record<string, number> = {};

  function getLevel(id: string): number {
    if (levelMap[id] !== undefined) return levelMap[id];
    const t = tasks.find(x => x.task_id === id);
    if (!t || t.dependencies.length === 0) return (levelMap[id] = 0);
    return (levelMap[id] = 1 + Math.max(...t.dependencies.map(getLevel)));
  }

  tasks.forEach(t => getLevel(t.task_id));

  const cols: Record<number, string[]> = {};
  tasks.forEach(t => {
    const lvl = levelMap[t.task_id];
    if (!cols[lvl]) cols[lvl] = [];
    cols[lvl].push(t.task_id);
  });

  const maxLvl = Math.max(...Object.keys(cols).map(Number));
  const maxColSize = Math.max(...Object.values(cols).map(c => c.length));
  const totalH = maxColSize * NODE_H + Math.max(0, maxColSize - 1) * ROW_GAP;

  const positions: Record<string, NodePos> = {};
  Object.entries(cols).forEach(([lvl, ids]) => {
    const colH = ids.length * NODE_H + Math.max(0, ids.length - 1) * ROW_GAP;
    const startY = PAD + (totalH - colH) / 2;
    ids.forEach((id, i) => {
      positions[id] = {
        x: PAD + Number(lvl) * COL_STRIDE,
        y: startY + i * (NODE_H + ROW_GAP),
        w: NODE_W, h: NODE_H,
      };
    });
  });

  return {
    positions,
    canvasW: PAD * 2 + (maxLvl + 1) * COL_STRIDE - COL_GAP,
    canvasH: PAD * 2 + totalH,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: TaskStatus; small?: boolean }> = ({ status, small }) => {
  const c = STATUS_CFG[status] ?? STATUS_CFG.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: small ? '1px 5px' : '2px 7px',
      borderRadius: 99, fontSize: small ? 10 : 11, fontWeight: 600,
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', background: c.dot, flexShrink: 0,
        animation: c.pulse ? 'copilotPulse 1.4s ease-in-out infinite' : 'none',
      }} />
      {c.label}
    </span>
  );
};

const ProgressBar: React.FC<{ progress: DagProgress }> = ({ progress }) => {
  const { total, completed, running, failed } = progress;
  if (!total) return null;
  const cp = (completed / total) * 100;
  const rp = (running / total) * 100;
  const fp = (failed / total) * 100;
  return (
    <div style={{ height: 3, borderRadius: 2, background: '#e2e8f0', overflow: 'hidden', position: 'relative', width: '100%' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${cp}%`, background: '#22c55e' }} />
      <div style={{ position: 'absolute', left: `${cp}%`, top: 0, height: '100%', width: `${rp}%`, background: '#60a5fa', animation: 'copilotProgress 1.5s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', left: `${cp + rp}%`, top: 0, height: '100%', width: `${fp}%`, background: '#f87171' }} />
    </div>
  );
};

const DAGEdges: React.FC<{ tasks: SubTask[]; positions: Record<string, NodePos> }> = ({ tasks, positions }) => {
  const edges: { id: string; d: string; srcStatus: TaskStatus }[] = [];

  tasks.forEach(task => {
    task.dependencies.forEach(depId => {
      const src = positions[depId];
      const tgt = positions[task.task_id];
      if (!src || !tgt) return;
      const x1 = src.x + src.w;
      const y1 = src.y + src.h / 2;
      const x2 = tgt.x;
      const y2 = tgt.y + tgt.h / 2;
      const cx = (x1 + x2) / 2;
      edges.push({
        id: `${depId}→${task.task_id}`,
        d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
        srcStatus: (tasks.find(t => t.task_id === depId)?.status ?? 'pending') as TaskStatus,
      });
    });
  });

  const getEdgeColor = (s: TaskStatus) => {
    if (s === 'completed') return '#86efac';
    if (s === 'failed') return '#fca5a5';
    return '#cbd5e1';
  };

  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        {(['default', 'done', 'fail'] as const).map(id => (
          <marker key={id} id={`cp-arr-${id}`} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M 0 1 L 5 3.5 L 0 6 Z" fill={id === 'done' ? '#86efac' : id === 'fail' ? '#fca5a5' : '#cbd5e1'} />
          </marker>
        ))}
      </defs>
      {edges.map(e => {
        const markerId = e.srcStatus === 'completed' ? 'done' : e.srcStatus === 'failed' ? 'fail' : 'default';
        const dashed = e.srcStatus === 'pending' || e.srcStatus === 'skipped' || e.srcStatus === 'queued';
        return (
          <path key={e.id} d={e.d}
            stroke={getEdgeColor(e.srcStatus)}
            strokeWidth={1.5} fill="none"
            strokeDasharray={dashed ? '4 3' : 'none'}
            markerEnd={`url(#cp-arr-${markerId})`}
          />
        );
      })}
    </svg>
  );
};

const TaskNode: React.FC<{
  task: SubTask;
  pos: NodePos;
  selected: boolean;
  onClick: (t: SubTask) => void;
}> = ({ task, pos, selected, onClick }) => {
  const sc = STATUS_CFG[task.status] ?? STATUS_CFG.pending;
  const tc = TYPE_CFG[task.type] ?? TYPE_CFG.custom;
  const isRunning = task.status === 'running';
  const isFailed = task.status === 'failed';

  return (
    <div
      onClick={() => onClick(task)}
      style={{
        position: 'absolute',
        left: pos.x, top: pos.y,
        width: pos.w, height: pos.h,
        borderRadius: 8,
        background: selected ? '#eff6ff' : isFailed ? '#fff8f8' : '#ffffff',
        border: `1.5px solid ${selected ? '#3b82f6' : sc.border}`,
        boxShadow: selected
          ? '0 0 0 3px #bfdbfe, 0 2px 8px rgba(59,130,246,0.12)'
          : isRunning
            ? `0 0 0 2px ${sc.border}, 0 2px 6px rgba(0,0,0,0.04)`
            : '0 1px 3px rgba(0,0,0,0.05)',
        cursor: 'pointer',
        padding: '7px 9px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        userSelect: 'none',
        transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.1s',
        animation: isRunning ? 'copilotNodePulse 2s ease-in-out infinite' : 'none',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}
    >
      {/* Top row: emoji + name */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
        <span style={{ fontSize: 13, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>{tc.icon}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: '#1e293b', lineHeight: 1.3, flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {task.name}
        </span>
      </div>
      {/* Bottom row: badge + task_id */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <StatusBadge status={task.status} small />
        <span style={{ fontSize: 9.5, color: '#cbd5e1', fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
          {task.task_id}
        </span>
      </div>
    </div>
  );
};

const MetricRow: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => {
  if (value === null || value === undefined) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#1e293b', fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
};

const DetailDrawer: React.FC<{ task: SubTask; dag: Dag; onClose: () => void }> = ({ task, dag, onClose }) => {
  const tc = TYPE_CFG[task.type] ?? TYPE_CFG.custom;
  const m = task.metrics ?? {};

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 264,
      background: '#ffffff', borderLeft: '1px solid #e2e8f0',
      boxShadow: '-6px 0 20px rgba(0,0,0,0.06)',
      display: 'flex', flexDirection: 'column', zIndex: 20,
      animation: 'cpDrawerIn 0.18s ease-out',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 2 }}>{task.task_id}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>{tc.icon}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 24, height: 24, borderRadius: 6, border: '1px solid #e2e8f0',
            background: '#f8fafc', cursor: 'pointer', fontSize: 13, color: '#94a3b8',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
          }}>×</button>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusBadge status={task.status} />
          {task.retry && task.retry.count > 0 && (
            <span style={{ fontSize: 10, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 99, padding: '1px 6px', fontWeight: 600 }}>
              重试 {task.retry.count}/{task.retry.max}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>

        {/* Dependencies */}
        {task.dependencies.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>依赖</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {task.dependencies.map(d => {
                const dep = dag.tasks.find(t => t.task_id === d);
                return (
                  <span key={d} style={{
                    padding: '2px 7px', borderRadius: 6,
                    background: dep ? STATUS_CFG[dep.status].bg : '#f1f5f9',
                    border: `1px solid ${dep ? STATUS_CFG[dep.status].border : '#e2e8f0'}`,
                    fontSize: 10.5, fontFamily: 'monospace', color: '#475569',
                  }}>
                    {d}{dep ? ` · ${STATUS_CFG[dep.status].label}` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Description */}
        {task.description && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>任务说明</div>
            <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.6, background: '#f8fafc', borderRadius: 7, padding: 9 }}>
              {task.description}
            </div>
          </div>
        )}

        {/* Metrics */}
        {(m.duration_ms || m.total_tokens) && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>执行指标</div>
            <div style={{ background: '#f8fafc', borderRadius: 7, padding: '2px 9px' }}>
              <MetricRow label="耗时" value={m.duration_ms ? `${(m.duration_ms / 1000).toFixed(1)}s` : undefined} />
              <MetricRow label="Token" value={m.total_tokens?.toLocaleString()} />
              <MetricRow label="费用" value={m.cost_usd != null ? `$${m.cost_usd.toFixed(4)}` : undefined} />
              <MetricRow label="开始时间" value={m.started_at ?? undefined} />
              <MetricRow label="完成时间" value={m.completed_at ?? undefined} />
            </div>
          </div>
        )}

        {/* Result */}
        {task.result?.content && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>执行结果</div>
            <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.65, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 7, padding: 9 }}>
              {task.result.content}
            </div>
          </div>
        )}

        {/* Error */}
        {task.error?.message && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>错误信息</div>
            <div style={{ fontSize: 11, lineHeight: 1.6, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: 9 }}>
              <div style={{ color: '#dc2626', fontFamily: 'monospace', wordBreak: 'break-all' }}>{task.error.message}</div>
              {task.error.code && <div style={{ marginTop: 4, color: '#f87171', fontSize: 10 }}>Code: {task.error.code}</div>}
            </div>
          </div>
        )}

        {/* Worker ID */}
        {task.worker_id && (
          <div style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace', textAlign: 'right' }}>
            worker: {task.worker_id}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskPanelProps {
  workspace?: string;
  defaultExpanded?: boolean;
}

const TaskPanel: React.FC<TaskPanelProps> = ({ workspace, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeDagIdx, setActiveDagIdx] = useState(0);
  const [selectedTask, setSelectedTask] = useState<SubTask | null>(null);

  // ── Data source ─────────────────────────────────────────────────────────
  const { dags, isLoading } = useTaskDags(workspace ?? '');

  // active tab 越界时重置
  useEffect(() => {
    if (activeDagIdx >= dags.length && dags.length > 0) {
      setActiveDagIdx(0);
      setSelectedTask(null);
    }
  }, [dags.length, activeDagIdx]);

  const dag = dags[activeDagIdx] ?? dags[0];

  const handleNodeClick = useCallback((task: SubTask) => {
    setSelectedTask(prev => (prev?.task_id === task.task_id ? null : task));
  }, []);

  const handleTabClick = useCallback((i: number) => {
    setActiveDagIdx(i);
    setSelectedTask(null);
  }, []);

  if (!expanded) {
    // ── Collapsed header ────────────────────────────────────────────────────
    return (
      <>
        <style>{STYLES}</style>
        <div style={{
          borderBottom: '1px solid var(--bg-3, #e2e8f0)',
          background: 'var(--color-bg-1, #fff)',
          padding: '6px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', userSelect: 'none',
        }} onClick={() => {
          console.log('[TaskPanel] Header clicked, expanding panel');
          setExpanded(true);
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>任务面板</span>
            {dags.map((d) => (
              <span key={d.dag_id} style={{ width: 7, height: 7, borderRadius: '50%', background: DAG_STATUS_COLOR[d.status] ?? '#94a3b8' }} />
            ))}
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {isLoading
                ? '加载中…'
                : dags.reduce((s, d) => s + d.progress.running, 0) > 0
                  ? `${dags.reduce((s, d) => s + d.progress.running, 0)} 个任务执行中`
                  : dags.length > 0 ? `${dags.length} 个任务` : '暂无任务'}
            </span>
          </div>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>▾</span>
        </div>
      </>
    );
  }

  // ── Empty / loading state ────────────────────────────────────────────────
  if (!dag) {
    return (
      <>
        <style>{STYLES}</style>
        <div style={{
          display: 'flex', flexDirection: 'column',
          borderBottom: '1px solid var(--bg-3, #e2e8f0)',
          background: 'var(--color-bg-1, #fff)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}>
          <div style={{ padding: '7px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              任务面板
            </span>
            <button onClick={() => setExpanded(false)} style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>
              ▴ 收起
            </button>
          </div>
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
            {isLoading
              ? '扫描任务目录…'
              : '暂无任务 — 使用 Copilot 创建任务计划'}
          </div>
        </div>
      </>
    );
  }

  const { positions, canvasW, canvasH } = computeLayout(dag.tasks);

  return (
    <>
      <style>{STYLES}</style>
      <div style={{
        display: 'flex', flexDirection: 'column',
        borderBottom: '1px solid var(--bg-3, #e2e8f0)',
        background: 'var(--color-bg-1, #fff)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
      }}>

        {/* ── Panel title row ───────────────────────────────────────────── */}
        <div style={{ padding: '7px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            任务面板
          </span>
          <button
            onClick={() => { setExpanded(false); setSelectedTask(null); }}
            style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
          >
            ▴ 收起
          </button>
        </div>

        {/* ── Tab bar ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', padding: '0 8px', gap: 4, overflowX: 'auto', flexShrink: 0, borderBottom: '1px solid #f1f5f9' }}>
          {dags.map((d, i) => {
            const active = i === activeDagIdx;
            const sc = DAG_STATUS_COLOR[d.status] ?? '#94a3b8';
            return (
              <button key={d.dag_id} onClick={() => handleTabClick(i)} style={{
                flexShrink: 0, minWidth: 100, maxWidth: 160,
                padding: '6px 10px 5px',
                borderRadius: '6px 6px 0 0',
                border: `1px solid ${active ? '#e2e8f0' : 'transparent'}`,
                borderBottom: active ? '1px solid var(--color-bg-1, #fff)' : '1px solid transparent',
                background: active ? 'var(--color-bg-1, #fff)' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.1s',
                marginBottom: active ? '-1px' : 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc, flexShrink: 0, animation: d.status === 'running' ? 'copilotPulse 1.4s ease-in-out infinite' : 'none' }} />
                  <span style={{ fontSize: 11.5, fontWeight: active ? 700 : 500, color: active ? '#1e293b' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {d.title}
                  </span>
                </div>
                <ProgressBar progress={d.progress} />
                <div style={{ marginTop: 3, fontSize: 9.5, color: '#94a3b8' }}>
                  {d.progress.completed}/{d.progress.total}
                  {d.progress.running > 0 && <span style={{ color: '#60a5fa', marginLeft: 4 }}>· {d.progress.running} 执行中</span>}
                  {d.progress.failed > 0 && <span style={{ color: '#f87171', marginLeft: 4 }}>· {d.progress.failed} 失败</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── DAG canvas ────────────────────────────────────────────────── */}
        <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
          {/* Scrollable canvas */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
            <div style={{ position: 'relative', width: canvasW, height: canvasH, minWidth: '100%', minHeight: '100%' }}>
              <DAGEdges tasks={dag.tasks} positions={positions} />
              {dag.tasks.map(task => (
                <TaskNode
                  key={task.task_id}
                  task={task}
                  pos={positions[task.task_id]}
                  selected={selectedTask?.task_id === task.task_id}
                  onClick={handleNodeClick}
                />
              ))}
            </div>
          </div>

          {/* Detail drawer (overlays on right side) */}
          {selectedTask && (
            <DetailDrawer
              task={selectedTask}
              dag={dag}
              onClose={() => setSelectedTask(null)}
            />
          )}
        </div>

        {/* ── Footer stats ─────────────────────────────────────────────── */}
        <div style={{
          padding: '5px 12px', display: 'flex', gap: 12, alignItems: 'center',
          background: '#f8fafc', borderTop: '1px solid #f1f5f9', flexShrink: 0,
        }}>
          {[
            { label: '完成', val: dag.progress.completed, color: '#16a34a' },
            { label: '执行中', val: dag.progress.running, color: '#2563eb' },
            { label: '失败', val: dag.progress.failed, color: '#dc2626' },
            { label: '待执行', val: (dag.progress.pending ?? 0) + (dag.progress.queued ?? 0), color: '#94a3b8' },
          ].map(s => (
            s.val > 0 || s.label === '待执行' ? (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.val}</span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{s.label}</span>
              </div>
            ) : null
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#e2e8f0', fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
            {dag.dag_id}
          </span>
        </div>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyframes (injected once as a <style> tag)
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
    0%, 100% { box-shadow: 0 0 0 2px #bfdbfe, 0 2px 6px rgba(0,0,0,0.04); }
    50%       { box-shadow: 0 0 0 3px #93c5fd, 0 2px 10px rgba(59,130,246,0.18); }
  }
  @keyframes cpDrawerIn {
    from { transform: translateX(16px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
`;

export default TaskPanel;
