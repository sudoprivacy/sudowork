import { useEffect, useRef, useState } from 'react'
import type { ParkApi } from './api'
import { parkLabels as t } from './labels'
import styles from './park.module.css'

interface Task {
  id: string
  action: string
  status: string
  phase: string
  error?: string
  recovery_error?: string
  recovered?: boolean
  result?: unknown
}

interface Status {
  version: string | null
  components?: Record<string, unknown>
  uptime_seconds: number
  checked_at?: number
  memory: { total_bytes: number; free_bytes: number }
  disk: { total_bytes: number; free_bytes: number }
  health: unknown
  model: unknown
  archives: string[]
  upgrades: string[]
  available_actions: Record<string, boolean>
  action_reasons?: Record<string, string[]>
  current_task?: Task
  services?: Array<{
    service: string
    running: boolean
    image_id: string
    started_at: string
    restart_count: number
  }>
  directories?: Record<string, { status: string; reason?: string }>
}

/** Operational state comes from durable tasks, independently of status refreshes. */
export default function OperationsPage({ api }: IOperationsPageProps) {
  const [data, setData] = useState<Status | null>(null)
  const [archive, setArchive] = useState('')
  const [upgrade, setUpgrade] = useState('')
  const [task, setTask] = useState<Task | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const taskId = useRef<string | null>(null)
  const isBusy = isSubmitting || Boolean(task && !['succeeded', 'failed'].includes(task.status))
  async function reload() {
    const next = await api.get<Status>('admin/operations')
    setData(next)
    if (!taskId.current && next.current_task) {
      taskId.current = next.current_task.id
      setTask(next.current_task)
    }
  }
  useEffect(() => {
    let isMounted = true
    let isLoading = false
    async function poll() {
      if (isLoading || document.hidden) return
      isLoading = true
      try {
        const nextStatus = await api.get<Status>('admin/operations')
        if (isMounted) {
          setData(nextStatus)
          if (nextStatus.current_task) taskId.current = nextStatus.current_task.id
        }
        if (taskId.current) {
          const next = await api.get<Task>(`admin/operations/tasks/${taskId.current}`)
          if (isMounted) setTask(next)
        }
      } catch (error) {
        if (isMounted)
          setMessage((previous) =>
            previous.includes(t.operationRefreshFailed)
              ? previous
              : `${previous} ${t.operationRefreshFailed} ${error instanceof Error ? error.message : ''}`.trim(),
          )
      } finally {
        isLoading = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), isBusy ? 2000 : 15_000)
    return () => {
      isMounted = false
      window.clearInterval(timer)
    }
  }, [api, isBusy])

  async function onAction(action: string) {
    const prompt =
      action === 'restore'
        ? `${t.confirmRestore} ${t.restorePointWarning}`
        : action === 'upgrade'
          ? t.confirmUpgrade
          : action === 'rollback'
            ? `${t.confirmRollback} ${t.restorePointWarning}`
            : null
    if (prompt && !window.confirm(prompt)) return
    setIsSubmitting(true)
    setIsError(false)
    setMessage('')
    try {
      const response = await api.send<Task | { result: unknown }>(
        `admin/operations/${action}`,
        'POST',
        {
          request_id: crypto.randomUUID(),
          name: action === 'restore' ? archive : upgrade,
        },
      )
      if ('id' in response) {
        setTask(response)
        taskId.current = response.id
      } else if (response.result === false) {
        setIsError(true)
        setMessage(t.signatureInvalid)
      } else setMessage(t.operationSuccess)
    } catch (error) {
      setIsError(true)
      setMessage(error instanceof Error ? error.message : t.operationFailed)
    } finally {
      setIsSubmitting(false)
    }
    try {
      await reload()
    } catch {
      setMessage((previous) => `${previous} ${t.operationRefreshFailed}`)
    }
  }
  if (!data) return <div className={styles.message}>{message || t.loading}</div>
  const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
  const actions = [
    ['backup', t.backup],
    ['restore', t.restore],
    ['verify-upgrade', t.verifySignature],
    ['upgrade', t.applyUpgrade],
    ['rollback', t.rollback],
    ['reindex', t.reindex],
    ['model-check', t.modelCheck],
  ]
  return (
    <>
      {message && (
        <p role="status" className={isError ? styles.errorLine : styles.statusLine}>
          {message}
        </p>
      )}
      {task && (
        <section className={styles.panel} aria-live="polite">
          <h2 className={styles.panelTitle}>{t.operationTask}</h2>
          <p>
            {actions.find(([action]) => action === task.action)?.[1] ?? task.action} ·{' '}
            {t.operationPhases[task.status as keyof typeof t.operationPhases] ?? task.status} ·{' '}
            {t.operationStages[task.phase as keyof typeof t.operationStages] ?? task.phase}
          </p>
          {task.error && <p className={styles.errorLine}>{task.error}</p>}
          {task.recovered && <p>{t.rollbackVerified}</p>}
          {task.recovery_error && (
            <p className={styles.errorLine}>
              {t.recoveryFailed} {task.recovery_error}
            </p>
          )}
          {task.status === 'succeeded' && <p>{t.operationSuccess}</p>}
          {task.result !== undefined && <pre>{JSON.stringify(task.result, null, 2)}</pre>}
        </section>
      )}
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.operationStatus}</h2>
          <p>
            {data.version ?? t.notConfigured} · {t.processUptime} {data.uptime_seconds}s
          </p>
          <pre>{JSON.stringify(data.components ?? {}, null, 2)}</pre>
          <h2 className={styles.panelTitle}>{t.componentRuntime}</h2>
          {data.services?.map((service) => (
            <div key={service.service}>
              <p>
                {service.service} · {service.running ? t.healthy : t.unhealthy} ·{' '}
                {t.componentStartedAt} {service.started_at} · {t.componentRestartCount}{' '}
                {service.restart_count}
              </p>
              <code>{service.image_id}</code>
            </div>
          ))}
          <h2 className={styles.panelTitle}>{t.health}</h2>
          <pre>{JSON.stringify(data.health, null, 2)}</pre>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.resources}</h2>
          <p>
            {t.diskResource} {gigabytes(data.disk.free_bytes)} / {gigabytes(data.disk.total_bytes)}
          </p>
          <p>
            {t.memoryResource} {gigabytes(data.memory.free_bytes)} /{' '}
            {gigabytes(data.memory.total_bytes)}
          </p>
          <pre>{JSON.stringify(data.model, null, 2)}</pre>
        </section>
      </div>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>
          {t.backup} / {t.upgrade}
        </h2>
        <div className={styles.inlineActions}>
          <select
            aria-label={t.archive}
            className={styles.select}
            value={archive}
            onChange={(event) => setArchive(event.target.value)}
          >
            <option value="">{t.archive}</option>
            {data.archives.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            aria-label={t.upgradePackage}
            className={styles.select}
            value={upgrade}
            onChange={(event) => setUpgrade(event.target.value)}
          >
            <option value="">{t.upgradePackage}</option>
            {data.upgrades.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        {Object.entries(data.directories ?? {}).map(([kind, value]) => (
          <p key={kind}>
            {kind} · {value.status} {value.reason}
          </p>
        ))}
        <div className={`${styles.list} ${styles.sectionGap}`}>
          {actions.map(([action, label]) => (
            <div className={styles.listItem} key={action}>
              <button
                className={styles.button}
                disabled={
                  isBusy ||
                  !data.available_actions[action!] ||
                  (action === 'restore' && !archive) ||
                  (['verify-upgrade', 'upgrade'].includes(action!) && !upgrade)
                }
                onClick={() => void onAction(action!)}
              >
                {label}
              </button>
              {data.action_reasons?.[action!]?.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

interface IOperationsPageProps {
  api: ParkApi
}
