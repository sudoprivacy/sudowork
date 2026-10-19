import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useParkAuth } from '../auth'
import type { ParkApi } from './api'
import type { PageId } from './index'
import { parkLabels as t } from './labels'
import styles from './park.module.css'

interface Lead {
  id: string
  status: string
  score: number
  score_explanation: string
  tags: string[]
  tags_json?: string
  suggested_action: string
  contact_status: string
  owner_id: string | null
  source_channel?: string
  has_contact?: boolean
  display_name?: string
  created_at: number
}
interface Inquiry {
  id: string
  redacted_question: string
  redacted_answer: string
  intent: string
  industry: string | null
  scale: string | null
  urgency: string | null
  concerns_json: string
  created_at: number
}
interface Contact {
  name: string | null
  company_name: string | null
  phone: string | null
  email: string | null
  consent_at: number
  retention_until: number
}
interface FollowUp {
  id: string
  note: string
  outcome: string | null
  actor_user_id: string
  created_at: number
}
interface LeadDetail extends Lead {
  contact: Contact | null
  inquiries: Inquiry[]
  follow_ups: FollowUp[]
}

function localTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

function LeadTable({ rows }: { rows: Lead[] }) {
  if (!rows.length) return <div className={styles.empty}>{t.empty}</div>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t.title}</th>
            <th>{t.status}</th>
            <th>{t.score}</th>
            <th>{t.tags}</th>
            <th>{t.channel}</th>
            <th>{t.contact}</th>
            <th>{t.owner}</th>
            <th>{t.date}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <tr key={lead.id}>
              <td>
                <Link to={`/park/leads/${lead.id}`}>
                  {lead.display_name || (lead.has_contact ? t.contactCard : t.unknownContact)}
                </Link>
                <div className={styles.muted}>{lead.id.slice(0, 8)}</div>
              </td>
              <td>
                <span className={styles.pill}>
                  {t.statuses[lead.status as keyof typeof t.statuses] ?? lead.status}
                </span>
              </td>
              <td>
                <strong>{lead.score}</strong>
              </td>
              <td>{lead.tags?.join(' · ') || t.empty}</td>
              <td>{lead.source_channel ?? '—'}</td>
              <td>{lead.has_contact ? t.contactCard : t.unknownContact}</td>
              <td>{lead.owner_id ?? '—'}</td>
              <td>{localTime(Number(lead.created_at))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LeadsPage({ api }: { api: ParkApi }) {
  const [rows, setRows] = useState<Lead[]>([])
  const [status, setStatus] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setIsLoading(true)
    void api
      .get<Lead[]>(`leads${status ? `?status=${encodeURIComponent(status)}` : ''}`)
      .then((result) => {
        setRows(result)
        setError('')
      })
      .catch(() => setError(t.failed))
      .finally(() => setIsLoading(false))
  }, [api, status])
  return (
    <>
      <div className={styles.inlineActions}>
        <label className={styles.field}>
          {t.status}
          <select
            className={styles.select}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t.status}</option>
            {Object.entries(t.statuses)
              .filter(([key]) =>
                ['proposed', 'claimed', 'following_up', 'converted', 'invalid', 'closed'].includes(
                  key,
                ),
              )
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className={styles.sectionGap}>
        {isLoading ? (
          <div className={styles.message}>{t.loading}</div>
        ) : error ? (
          <div className={styles.message}>{error}</div>
        ) : (
          <LeadTable rows={rows} />
        )}
      </div>
    </>
  )
}

function FollowUpsPage({ api }: { api: ParkApi }) {
  const [rows, setRows] = useState<Lead[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void api
      .get<Lead[]>('follow-ups')
      .then(setRows)
      .catch(() => setError(t.failed))
  }, [api])
  return error ? <div className={styles.message}>{error}</div> : <LeadTable rows={rows} />
}

function DetailPage({ api, leadId }: { api: ParkApi; leadId: string }) {
  const { state } = useParkAuth()
  const userId = state.status === 'authenticated' ? state.user.id : null
  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState('')
  const [closingStatus, setClosingStatus] = useState('converted')
  const reload = useCallback(async () => {
    setIsLoading(true)
    try {
      setLead(await api.get<LeadDetail>(`leads/${encodeURIComponent(leadId)}`))
      setError('')
    } catch {
      setError(t.failed)
    } finally {
      setIsLoading(false)
    }
  }, [api, leadId])
  useEffect(() => {
    void reload()
  }, [reload])

  async function onClaim() {
    setIsSaving(true)
    try {
      await api.send(`leads/${encodeURIComponent(leadId)}/claim`, 'POST')
      await reload()
    } catch {
      setError(t.saveFailed)
    } finally {
      setIsSaving(false)
    }
  }
  async function onFollowUp(event: React.FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    setIsSaving(true)
    try {
      await api.send(`leads/${encodeURIComponent(leadId)}/follow-ups`, 'POST', {
        note,
        outcome,
      })
      setNote('')
      setOutcome('')
      await reload()
    } catch {
      setError(t.saveFailed)
    } finally {
      setIsSaving(false)
    }
  }
  async function onClose() {
    setIsSaving(true)
    try {
      await api.send(`leads/${encodeURIComponent(leadId)}`, 'PATCH', {
        status: closingStatus,
      })
      await reload()
    } catch {
      setError(t.saveFailed)
    } finally {
      setIsSaving(false)
    }
  }
  if (isLoading) return <div className={styles.message}>{t.loading}</div>
  if (!lead) return <div className={styles.message}>{error || t.empty}</div>
  const latest = lead.inquiries.at(-1)
  return (
    <>
      {error && <p className={styles.errorLine}>{error}</p>}
      <div className={styles.grid3}>
        <article className={styles.stat}>
          <div className={styles.statLabel}>{t.score}</div>
          <div className={styles.statValue}>{lead.score}</div>
          <p className={styles.summaryLine}>{lead.score_explanation}</p>
        </article>
        <article className={styles.stat}>
          <div className={styles.statLabel}>{t.status}</div>
          <div className={styles.statValue}>
            {t.statuses[lead.status as keyof typeof t.statuses] ?? lead.status}
          </div>
          <p className={styles.summaryLine}>{lead.suggested_action}</p>
        </article>
        <article className={styles.stat}>
          <div className={styles.statLabel}>{t.contact}</div>
          <div className={styles.statValue}>{lead.contact ? t.contactCard : t.unknownContact}</div>
        </article>
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.intent}</h2>
          <div className={styles.detailMeta}>
            <div>
              <span>{t.intent}</span>
              <strong>{latest?.intent ?? '—'}</strong>
            </div>
            <div>
              <span>{t.industry}</span>
              <strong>{latest?.industry ?? '—'}</strong>
            </div>
            <div>
              <span>{t.scale}</span>
              <strong>{latest?.scale ?? '—'}</strong>
            </div>
            <div>
              <span>{t.urgency}</span>
              <strong>{latest?.urgency ?? '—'}</strong>
            </div>
          </div>
          <p className={styles.summaryLine}>
            {t.concerns} · {lead.tags?.join(' · ') || t.empty}
          </p>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.contactCard}</h2>
          {lead.contact ? (
            <div className={styles.list}>
              <div className={styles.listItem}>
                <strong>
                  {lead.contact.name ?? '—'} · {lead.contact.company_name ?? '—'}
                </strong>
                <p>
                  {t.phone}: {lead.contact.phone ?? '—'}
                </p>
                <p>
                  {t.email}: {lead.contact.email ?? '—'}
                </p>
                <p>
                  {t.date}: {localTime(Number(lead.contact.consent_at))}
                </p>
              </div>
            </div>
          ) : (
            <p className={styles.muted}>{t.unknownContact}</p>
          )}
        </section>
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.timeline}</h2>
          <div className={styles.list}>
            {lead.inquiries.length ? (
              lead.inquiries.map((item) => (
                <div className={styles.listItem} key={item.id}>
                  <strong>
                    {localTime(Number(item.created_at))} · {item.intent}
                  </strong>
                  <div className={styles.quote}>{item.redacted_question}</div>
                  <p>{item.redacted_answer}</p>
                </div>
              ))
            ) : (
              <div className={styles.empty}>{t.empty}</div>
            )}
          </div>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.followUpHistory}</h2>
          <div className={styles.list}>
            {lead.follow_ups.length ? (
              lead.follow_ups.map((item) => (
                <div className={styles.listItem} key={item.id}>
                  <strong>
                    {localTime(Number(item.created_at))} · {item.actor_user_id}
                  </strong>
                  <p>{item.note}</p>
                  <p>{item.outcome}</p>
                </div>
              ))
            ) : (
              <div className={styles.empty}>{t.empty}</div>
            )}
          </div>
        </section>
      </div>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.actions}</h2>
        <div className={styles.inlineActions}>
          {lead.status === 'proposed' && (
            <button
              className={styles.button}
              type="button"
              onClick={() => void onClaim()}
              disabled={isSaving}
            >
              {t.claim}
            </button>
          )}
          {lead.owner_id === userId &&
            !['converted', 'invalid', 'closed'].includes(lead.status) && (
              <>
                <form className={styles.formGrid} onSubmit={(event) => void onFollowUp(event)}>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    {t.followUpNote}
                    <textarea
                      className={styles.textarea}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    {t.followUpOutcome}
                    <input
                      className={styles.input}
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                    />
                  </label>
                  <button className={styles.button} type="submit" disabled={isSaving}>
                    {t.submitFollowUp}
                  </button>
                </form>
                <select
                  className={styles.select}
                  value={closingStatus}
                  onChange={(event) => setClosingStatus(event.target.value)}
                >
                  <option value="converted">{t.converted}</option>
                  <option value="invalid">{t.invalid}</option>
                  <option value="closed">{t.closed}</option>
                </select>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => void onClose()}
                  disabled={isSaving}
                >
                  {t.closeLead}
                </button>
              </>
            )}
        </div>
      </section>
    </>
  )
}

export function RecruiterPage({ id, api, leadId }: { id: PageId; api: ParkApi; leadId?: string }) {
  if (id === 'leads') return <LeadsPage api={api} />
  if (id === 'followUps') return <FollowUpsPage api={api} />
  return <DetailPage api={api} leadId={leadId!} />
}
