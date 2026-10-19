import { useCallback, useEffect, useState } from 'react'
import type { ParkApi } from './api'
import type { PageId } from './index'
import { parkLabels as t } from './labels'
import styles from './park.module.css'

interface Config {
  display_name: string
  logo_url: string | null
  welcome_text: string
  park_profile: string
  service_catalog: string
  service_catalog_version: string
  contact_enabled: number
}
interface Policy {
  id: string
  title: string
  version: string
  section: string
  content: string
  status: string
  effective_from: number
  effective_until: number | null
  updated_at: number
}
interface QuickQuestion {
  id: string
  question: string
  sort_order: number
  enabled: number
}
interface ConfigValue {
  value: Record<string, unknown>
  status?: string
}
interface PublicLinks {
  public_url: string | null
  links: Array<{ id: string; channel: string; label: string; enabled: number }>
}
interface AuditEvent {
  id: string
  actor_user_id: string | null
  action: string
  resource: string
  method: string
  path: string
  response_status: number
  ip_address: string | null
  created_at: number
}
interface BoxStatus {
  version: string | null
  uptime_seconds: number
  memory: { total_bytes: number; free_bytes: number }
  disk: { total_bytes: number; free_bytes: number }
  health: Array<{ url: string; healthy: boolean; status: number }>
  model: unknown
  archives: string[]
  upgrades: string[]
  available_actions: Record<string, boolean>
}

function localTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

function dateInput(value: number | null): string {
  return value == null
    ? ''
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(Number(value))
}

function shanghaiMidnight(value: FormDataEntryValue | null): number | null {
  return value ? Date.parse(`${String(value)}T00:00:00+08:00`) : null
}

function Feedback({ message, isError }: { message: string; isError?: boolean }) {
  return message ? (
    <p className={isError ? styles.errorLine : styles.statusLine}>{message}</p>
  ) : null
}

function PoliciesPage({ api }: { api: ParkApi }) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [config, setConfig] = useState<Config | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const reload = useCallback(async () => {
    const [policyRows, parkConfig] = await Promise.all([
      api.get<Policy[]>('admin/policies'),
      api.get<Config>('admin/config'),
    ])
    setPolicies(policyRows)
    setConfig(parkConfig)
  }, [api])
  useEffect(() => {
    void reload().catch(() => {
      setMessage(t.failed)
      setIsError(true)
    })
  }, [reload])
  async function onNewPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    const form = event.currentTarget
    const values = new FormData(form)
    const until = shanghaiMidnight(values.get('effective_until'))
    try {
      await api.send('admin/policies', 'POST', {
        title: values.get('title'),
        version: values.get('version'),
        section: values.get('section'),
        content: values.get('content'),
        effective_from: shanghaiMidnight(values.get('effective_from')),
        effective_until: until === null ? null : until + 86_400_000 - 1,
      })
      form.reset()
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  async function onStatus(id: string, status: 'published' | 'offline') {
    setIsSaving(true)
    try {
      await api.send(`admin/policies/${encodeURIComponent(id)}/status`, 'PATCH', { status })
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  async function onConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    const form = new FormData(event.currentTarget)
    try {
      const catalog = JSON.parse(String(form.get('service_catalog') ?? '[]')) as unknown
      await api.send('admin/config', 'PUT', {
        display_name: form.get('display_name'),
        logo_url: form.get('logo_url'),
        welcome_text: form.get('welcome_text'),
        park_profile: form.get('park_profile'),
        service_catalog: catalog,
        service_catalog_version: form.get('service_catalog_version'),
        contact_enabled: form.get('contact_enabled') === 'on',
      })
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <>
      <Feedback message={message} isError={isError} />
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.policyList}</h2>
        {policies.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t.title}</th>
                  <th>{t.version}</th>
                  <th>{t.section}</th>
                  <th>{t.status}</th>
                  <th>{t.effective}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id}>
                    <td>
                      <strong>{policy.title}</strong>
                    </td>
                    <td>{policy.version}</td>
                    <td>{policy.section}</td>
                    <td>
                      <span className={styles.pill}>
                        {t.statuses[policy.status as keyof typeof t.statuses] ?? policy.status}
                      </span>
                    </td>
                    <td>
                      {dateInput(policy.effective_from)} —{' '}
                      {dateInput(policy.effective_until) || '∞'}
                    </td>
                    <td className={styles.inlineActions}>
                      <button
                        className={styles.buttonSecondary}
                        type="button"
                        onClick={() => void onStatus(policy.id, 'published')}
                        disabled={isSaving || policy.status === 'published'}
                      >
                        {t.publish}
                      </button>
                      <button
                        className={styles.buttonDanger}
                        type="button"
                        onClick={() => void onStatus(policy.id, 'offline')}
                        disabled={isSaving || policy.status === 'offline'}
                      >
                        {t.offline}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>{t.empty}</div>
        )}
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.policyCreate}</h2>
        <form className={styles.formGrid} onSubmit={(event) => void onNewPolicy(event)}>
          <label className={styles.field}>
            {t.title}
            <input className={styles.input} name="title" required />
          </label>
          <label className={styles.field}>
            {t.version}
            <input className={styles.input} name="version" required />
          </label>
          <label className={styles.field}>
            {t.section}
            <input className={styles.input} name="section" required />
          </label>
          <label className={styles.field}>
            {t.effectiveFrom}
            <input className={styles.input} type="date" name="effective_from" required />
          </label>
          <label className={styles.field}>
            {t.effectiveUntil}
            <input className={styles.input} type="date" name="effective_until" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.policyContent}
            <textarea className={styles.textarea} name="content" required />
          </label>
          <button className={styles.button} type="submit" disabled={isSaving}>
            {t.create}
          </button>
        </form>
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>
          {t.parkProfile} / {t.serviceCatalog}
        </h2>
        <form
          className={styles.formGrid}
          onSubmit={(event) => void onConfig(event)}
          key={(config?.display_name ?? 'new') + (config?.service_catalog_version ?? '')}
        >
          <label className={styles.field}>
            {t.displayName}
            <input
              className={styles.input}
              name="display_name"
              defaultValue={config?.display_name ?? ''}
              required
            />
          </label>
          <label className={styles.field}>
            {t.logoUrl}
            <input className={styles.input} name="logo_url" defaultValue={config?.logo_url ?? ''} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.welcomeText}
            <input
              className={styles.input}
              name="welcome_text"
              defaultValue={config?.welcome_text ?? ''}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.parkProfile}
            <textarea
              className={styles.textarea}
              name="park_profile"
              defaultValue={config?.park_profile ?? ''}
            />
          </label>
          <label className={styles.field}>
            {t.serviceCatalogVersion}
            <input
              className={styles.input}
              name="service_catalog_version"
              defaultValue={config?.service_catalog_version ?? '1'}
              required
            />
          </label>
          <label className={styles.field}>
            {t.contactEnabled}
            <input
              type="checkbox"
              name="contact_enabled"
              defaultChecked={config ? Boolean(config.contact_enabled) : true}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.serviceCatalog}
            <textarea
              className={styles.textarea}
              name="service_catalog"
              defaultValue={
                config ? JSON.stringify(JSON.parse(config.service_catalog), null, 2) : '[]'
              }
            />
          </label>
          <button className={styles.button} type="submit" disabled={isSaving}>
            {t.save}
          </button>
        </form>
      </section>
    </>
  )
}

function QuestionsPage({ api }: { api: ParkApi }) {
  const [rows, setRows] = useState<QuickQuestion[]>([])
  const [editing, setEditing] = useState<QuickQuestion | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const reload = useCallback(
    async () => setRows(await api.get<QuickQuestion[]>('admin/quick-questions')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => {
      setMessage(t.failed)
      setIsError(true)
    })
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await api.send('admin/quick-questions', 'POST', {
        id: editing?.id,
        question: values.get('question'),
        sort_order: Number(values.get('sort_order')),
        enabled: values.get('enabled') === 'on',
      })
      setEditing(null)
      form.reset()
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    }
  }
  async function onDelete(id: string) {
    try {
      await api.send(`admin/quick-questions/${encodeURIComponent(id)}`, 'DELETE')
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    }
  }
  return (
    <>
      <Feedback message={message} isError={isError} />
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.questions}</h2>
        <div className={styles.list}>
          {rows.length ? (
            rows.map((row) => (
              <div className={styles.listItem} key={row.id}>
                <div className={styles.inlineActions}>
                  <strong>{row.question}</strong>
                  <span className={styles.pill}>{row.enabled ? t.enabled : t.disabled}</span>
                  <span className={styles.muted}>
                    {t.order} {row.sort_order}
                  </span>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => setEditing(row)}
                  >
                    {t.edit}
                  </button>
                  <button
                    className={styles.buttonDanger}
                    type="button"
                    onClick={() => void onDelete(row.id)}
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className={styles.empty}>{t.empty}</div>
          )}
        </div>
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{editing ? t.edit : t.create}</h2>
        <form
          className={styles.formGrid}
          onSubmit={(event) => void onSave(event)}
          key={editing?.id ?? 'new'}
        >
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.question}
            <input
              className={styles.input}
              name="question"
              defaultValue={editing?.question ?? ''}
              required
            />
          </label>
          <label className={styles.field}>
            {t.order}
            <input
              className={styles.input}
              type="number"
              name="sort_order"
              defaultValue={editing?.sort_order ?? rows.length + 1}
            />
          </label>
          <label className={styles.field}>
            {t.enabled}
            <input type="checkbox" name="enabled" defaultChecked={editing?.enabled !== 0} />
          </label>
          <div className={styles.inlineActions}>
            <button className={styles.button} type="submit">
              {t.save}
            </button>
            {editing && (
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={() => setEditing(null)}
              >
                {t.cancel}
              </button>
            )}
          </div>
        </form>
      </section>
    </>
  )
}

function AssistantPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<ConfigValue | null>(null)
  const [message, setMessage] = useState('')
  const reload = useCallback(
    async () => setData(await api.get<ConfigValue>('admin/assistant')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    try {
      await api.send('admin/assistant', 'PUT', {
        status: values.get('status'),
        value: {
          model: values.get('model'),
          temperature: Number(values.get('temperature')),
          system_prompt: values.get('system_prompt'),
        },
      })
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{t.nav.assistant}</h2>
      {data && (
        <form
          className={styles.formGrid}
          onSubmit={(event) => void onSave(event)}
          key={data.status}
        >
          <label className={styles.field}>
            {t.assistantStatus}
            <select className={styles.select} name="status" defaultValue={data.status ?? 'draft'}>
              {['draft', 'pending_review', 'published', 'disabled'].map((status) => (
                <option value={status} key={status}>
                  {t.statuses[status as keyof typeof t.statuses]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {t.assistantModel}
            <input
              className={styles.input}
              name="model"
              defaultValue={String(data.value.model ?? '')}
              required
            />
          </label>
          <label className={styles.field}>
            {t.assistantTemperature}
            <input
              className={styles.input}
              type="number"
              min="0"
              max="2"
              step="0.1"
              name="temperature"
              defaultValue={Number(data.value.temperature ?? 0.2)}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.assistantPrompt}
            <textarea
              className={styles.textarea}
              name="system_prompt"
              defaultValue={String(data.value.system_prompt ?? '')}
            />
          </label>
          <button className={styles.button} type="submit">
            {t.save}
          </button>
        </form>
      )}
      <Feedback message={message} isError={message !== t.saved} />
    </section>
  )
}

function LinksPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<PublicLinks | null>(null)
  const [message, setMessage] = useState('')
  const reload = useCallback(
    async () => setData(await api.get<PublicLinks>('admin/public-links')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await api.send('admin/public-links', 'POST', {
        channel: values.get('channel'),
        label: values.get('label'),
        enabled: true,
      })
      form.reset()
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  async function onQr(channel: string) {
    try {
      const result = await api.get<{ data_url: string }>(
        `admin/public-links/${encodeURIComponent(channel)}/qr`,
      )
      const anchor = document.createElement('a')
      anchor.href = result.data_url
      anchor.download = `park-${channel}.png`
      anchor.click()
    } catch {
      setMessage(t.failed)
    }
  }
  async function onToggle(link: PublicLinks['links'][number]) {
    try {
      await api.send('admin/public-links', 'POST', {
        channel: link.channel,
        label: link.label,
        enabled: !link.enabled,
      })
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.publicUrl}</h2>
        <p>{data?.public_url ?? t.publicNotConfigured}</p>
        <div className={styles.list}>
          {data?.links.map((link) => {
            let linkUrl: URL | null = null
            try {
              linkUrl = data.public_url ? new URL(data.public_url) : null
            } catch {
              /* Show the configured value without a link. */
            }
            linkUrl?.searchParams.set('channel', link.channel)
            return (
              <div className={styles.listItem} key={link.id}>
                <strong>{link.label}</strong>
                <p>
                  {link.channel} · {link.enabled ? t.enabled : t.disabled}
                </p>
                <div className={styles.inlineActions}>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => void onToggle(link)}
                  >
                    {link.enabled ? t.disabled : t.enabled}
                  </button>
                  {link.enabled && linkUrl && (
                    <>
                      <a href={linkUrl.toString()} target="_blank" rel="noreferrer">
                        {linkUrl.toString()}
                      </a>
                      <button
                        className={styles.buttonSecondary}
                        type="button"
                        onClick={() => void onQr(link.channel)}
                      >
                        {t.qrDownload}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.create}</h2>
        <form className={styles.formGrid} onSubmit={(event) => void onSave(event)}>
          <label className={styles.field}>
            {t.channelCode}
            <input className={styles.input} name="channel" required pattern="[a-z0-9_-]+" />
          </label>
          <label className={styles.field}>
            {t.linkLabel}
            <input className={styles.input} name="label" required />
          </label>
          <button className={styles.button} type="submit">
            {t.save}
          </button>
        </form>
        <Feedback message={message} isError={message !== t.saved} />
      </section>
    </>
  )
}

const rateFields: Array<[string, string]> = [
  ['message_max_length', t.rateMessageLength],
  ['session_message_max', t.rateSessionMessages],
  ['session_token_budget', t.rateTokenBudget],
  ['concurrent_max', t.rateConcurrent],
  ['box_per_minute', t.rateBox],
  ['ip_per_minute', t.rateIp],
  ['subnet_per_minute', t.rateSubnet],
]

function RateLimitsPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<ConfigValue | null>(null)
  const [message, setMessage] = useState('')
  const reload = useCallback(
    async () => setData(await api.get<ConfigValue>('admin/rate-limits')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value: Record<string, unknown> = {}
    for (const [key] of rateFields) value[key] = Number(values.get(key))
    value.blacklist_ips = String(values.get('blacklist_ips') ?? '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    value.captcha_enabled = values.get('captcha_enabled') === 'on'
    value.automated_traffic_detection = values.get('automated_traffic_detection') === 'on'
    try {
      await api.send('admin/rate-limits', 'PUT', { value })
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{t.nav.rateLimits}</h2>
      {data && (
        <form className={styles.formGrid} onSubmit={(event) => void onSave(event)}>
          {rateFields.map(([key, label]) => (
            <label className={styles.field} key={key}>
              {label}
              <input
                className={styles.input}
                type="number"
                min="1"
                name={key}
                defaultValue={Number(data.value[key] ?? 0) || ''}
                required
              />
            </label>
          ))}
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.blacklist}
            <textarea
              className={styles.textarea}
              name="blacklist_ips"
              defaultValue={
                Array.isArray(data.value.blacklist_ips) ? data.value.blacklist_ips.join('\n') : ''
              }
            />
          </label>
          <label className={styles.field}>
            {t.automatedTrafficDetection}
            <input
              type="checkbox"
              name="automated_traffic_detection"
              defaultChecked={data.value.automated_traffic_detection !== false}
            />
          </label>
          <label className={styles.field}>
            {t.captchaEnabled}
            <input
              type="checkbox"
              name="captcha_enabled"
              defaultChecked={data.value.captcha_enabled === true}
            />
          </label>
          <button className={styles.button} type="submit">
            {t.save}
          </button>
        </form>
      )}
      <Feedback message={message} isError={message !== t.saved} />
    </section>
  )
}

function AuditPage({ api }: { api: ParkApi }) {
  const [rows, setRows] = useState<AuditEvent[]>([])
  const [redaction, setRedaction] = useState<ConfigValue | null>(null)
  const [message, setMessage] = useState('')
  const reload = useCallback(async () => {
    const [events, settings] = await Promise.all([
      api.get<AuditEvent[]>('admin/audit-events'),
      api.get<ConfigValue>('admin/redaction'),
    ])
    setRows(events)
    setRedaction(settings)
  }, [api])
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const extraTerms = String(values.get('extra_terms') ?? '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    try {
      await api.send('admin/redaction', 'PUT', {
        value: {
          extra_terms: extraTerms,
          summary_max_length: Number(values.get('summary_max_length')),
        },
      })
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.redaction}</h2>
        {redaction && (
          <form className={styles.formGrid} onSubmit={(event) => void onSave(event)}>
            <label className={styles.field}>
              {t.summaryLength}
              <input
                className={styles.input}
                type="number"
                name="summary_max_length"
                min="100"
                max="4000"
                defaultValue={Number(redaction.value.summary_max_length ?? 1000)}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              {t.redactionExtra}
              <textarea
                className={styles.textarea}
                name="extra_terms"
                defaultValue={
                  Array.isArray(redaction.value.extra_terms)
                    ? redaction.value.extra_terms.join('\n')
                    : ''
                }
              />
            </label>
            <button className={styles.button} type="submit">
              {t.save}
            </button>
          </form>
        )}
        <Feedback message={message} isError={message !== t.saved} />
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.auditEvent}</h2>
        {rows.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t.date}</th>
                  <th>{t.owner}</th>
                  <th>{t.actions}</th>
                  <th>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{localTime(Number(row.created_at))}</td>
                    <td>{row.actor_user_id ?? '—'}</td>
                    <td>
                      {row.method} {row.path}
                    </td>
                    <td>{row.response_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>{t.empty}</div>
        )}
      </section>
    </>
  )
}

function OperationsPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<BoxStatus | null>(null)
  const [archive, setArchive] = useState('')
  const [upgradePackage, setUpgradePackage] = useState('')
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const reload = useCallback(
    async () => setData(await api.get<BoxStatus>('admin/operations')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onAction(
    action: 'backup' | 'restore' | 'verify-upgrade' | 'upgrade' | 'rollback' | 'reindex',
  ) {
    const prompt =
      action === 'restore'
        ? t.confirmRestore
        : action === 'upgrade'
          ? t.confirmUpgrade
          : action === 'rollback'
            ? t.confirmRollback
            : null
    if (prompt && !window.confirm(prompt)) return
    setIsBusy(true)
    try {
      await api.send(`admin/operations/${action}`, 'POST', {
        name: action === 'restore' ? archive : upgradePackage,
      })
      await reload()
      setMessage(t.operationSuccess)
    } catch {
      setMessage(t.operationFailed)
    } finally {
      setIsBusy(false)
    }
  }
  if (!data) return <div className={styles.message}>{message || t.loading}</div>
  const gigabytes = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GB`
  return (
    <>
      <Feedback message={message} isError={message === t.operationFailed} />
      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.operationStatus}</h2>
          <div className={styles.listItem}>
            <strong>{data.version ?? t.notConfigured}</strong>
            <p>Uptime · {data.uptime_seconds}s</p>
          </div>
          <h2 className={`${styles.panelTitle} ${styles.sectionGap}`}>{t.health}</h2>
          <div className={styles.list}>
            {data.health.length ? (
              data.health.map((item) => (
                <div className={styles.listItem} key={item.url}>
                  <strong>
                    {item.healthy ? t.healthy : t.unhealthy} · {item.status}
                  </strong>
                  <p>{item.url}</p>
                </div>
              ))
            ) : (
              <div className={styles.empty}>{t.notConfigured}</div>
            )}
          </div>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.resources}</h2>
          <div className={styles.listItem}>
            <strong>
              Disk · {gigabytes(data.disk.free_bytes)} / {gigabytes(data.disk.total_bytes)}
            </strong>
            <p>
              Memory · {gigabytes(data.memory.free_bytes)} / {gigabytes(data.memory.total_bytes)}
            </p>
          </div>
          <div className={`${styles.listItem} ${styles.sectionGap}`}>
            <strong>Model</strong>
            <pre>{JSON.stringify(data.model, null, 2)}</pre>
          </div>
        </section>
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            {t.backup} / {t.restore}
          </h2>
          <div className={styles.inlineActions}>
            <button
              className={styles.button}
              disabled={isBusy || !data.available_actions.backup}
              onClick={() => void onAction('backup')}
            >
              {t.backup}
            </button>
            <select
              className={styles.select}
              value={archive}
              onChange={(event) => setArchive(event.target.value)}
            >
              <option value="">{t.archive}</option>
              {data.archives.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className={styles.buttonDanger}
              disabled={isBusy || !archive || !data.available_actions.restore}
              onClick={() => void onAction('restore')}
            >
              {t.restore}
            </button>
          </div>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            {t.upgrade} / {t.rollback}
          </h2>
          <div className={styles.inlineActions}>
            <select
              className={styles.select}
              value={upgradePackage}
              onChange={(event) => setUpgradePackage(event.target.value)}
            >
              <option value="">{t.upgradePackage}</option>
              {data.upgrades.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className={styles.buttonSecondary}
              disabled={isBusy || !upgradePackage}
              onClick={() => void onAction('verify-upgrade')}
            >
              {t.verifySignature}
            </button>
            <button
              className={styles.button}
              disabled={isBusy || !upgradePackage || !data.available_actions.upgrade}
              onClick={() => void onAction('upgrade')}
            >
              {t.applyUpgrade}
            </button>
            <button
              className={styles.buttonDanger}
              disabled={isBusy || !data.available_actions.rollback}
              onClick={() => void onAction('rollback')}
            >
              {t.rollback}
            </button>
          </div>
        </section>
      </div>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.reindex}</h2>
        <button
          className={styles.button}
          disabled={isBusy || !data.available_actions.reindex}
          onClick={() => void onAction('reindex')}
        >
          {t.run}
        </button>
      </section>
    </>
  )
}

export function OperatorPage({ id, api }: { id: PageId; api: ParkApi }) {
  if (id === 'policies') return <PoliciesPage api={api} />
  if (id === 'quickQuestions') return <QuestionsPage api={api} />
  if (id === 'assistant') return <AssistantPage api={api} />
  if (id === 'publicLinks') return <LinksPage api={api} />
  if (id === 'rateLimits') return <RateLimitsPage api={api} />
  if (id === 'audit') return <AuditPage api={api} />
  return <OperationsPage api={api} />
}
