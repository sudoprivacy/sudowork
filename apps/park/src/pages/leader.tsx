import { useEffect, useState } from 'react'
import type { ParkApi } from './api'
import type { PageId } from './index'
import { parkLabels as t } from './labels'
import styles from './park.module.css'

interface Overview {
  cards: Record<string, number>
  card_trends: Record<string, number[]>
  trend: Array<{ day: string; inquiries: number }>
  popular_topics: Array<{ category: string; count: number }>
  policy_interest: Array<{ policy: string; count: number }>
  channels: Array<{
    channel: string
    sessions: number
    consulted: number
    contacted: number
  }>
  research: {
    weekly_topics: Array<{ topic: string; count: number }>
    four_week_signals: Array<{
      week: number
      intent: Record<string, number>
      industry: Record<string, number>
    }>
  }
}
interface Summary {
  distribution: Record<string, number>
  pending_claim: number
  following_up: number
  funnel: Record<string, number>
}
interface Report {
  month: string
  inquiries: number
  leads: number
  converted: number
  popular_topics: Record<string, number>
  channels: Record<string, number>
}
interface Compliance {
  session_risk: Record<string, number>
  rejection_hits: {
    by_reason: Record<string, number>
    by_status: Record<string, number>
  }
  audit_failures: { total: number; auth_rejections: number }
  contact_retention: { expiring_soon: number; expired: number }
}

function points(values: number[], width = 800, height = 190): string {
  const maximum = Math.max(1, ...values)
  return values
    .map(
      (value, index) =>
        `${(index * width) / Math.max(1, values.length - 1)},${height - (value / maximum) * (height - 20)}`,
    )
    .join(' ')
}

function Sparkline({ values }: { values: number[] }) {
  return (
    <svg
      className={styles.sparkline}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={points(values, 100, 28)} />
    </svg>
  )
}

function TrendChart({ values }: { values: Array<{ day: string; inquiries: number }> }) {
  const line = points(values.map((item) => item.inquiries))
  const area = `0,190 ${line} 800,190`
  return (
    <svg
      className={styles.chart}
      viewBox="0 0 800 220"
      role="img"
      aria-label={t.trend}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="park-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#173d66" stopOpacity=".33" />
          <stop offset="1" stopColor="#173d66" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[40, 90, 140, 190].map((y) => (
        <line key={y} x1="0" x2="800" y1={y} y2={y} />
      ))}
      <polygon points={area} fill="url(#park-area)" />
      <polyline points={line} />
      <text x="0" y="215" fontSize="10" fill="#84939b">
        {values[0]?.day}
      </text>
      <text x="720" y="215" fontSize="10" fill="#84939b">
        {values.at(-1)?.day}
      </text>
    </svg>
  )
}

function Bars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  if (!rows.length) return <div className={styles.empty}>{t.empty}</div>
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <div>
      {rows.map((row) => (
        <div className={styles.barRow} key={row.label}>
          <span>{row.label}</span>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  )
}

function Donut({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (!total) return <div className={styles.empty}>{t.empty}</div>
  const colors = ['#173d66', '#b99a61', '#5d8e82', '#c9d3d1', '#879cb1']
  let position = 0
  const segments = rows.map((row, index) => {
    const start = position
    position += (row.value / total) * 100
    return `${colors[index % colors.length]} ${start}% ${position}%`
  })
  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut} style={{ background: `conic-gradient(${segments.join(',')})` }}>
        <div className={styles.donutCenter}>{total}</div>
      </div>
      <div className={styles.legend}>
        {rows.map((row, index) => (
          <div key={row.label}>
            <i style={{ background: colors[index % colors.length] }} />
            {row.label} · {row.value}
          </div>
        ))}
      </div>
    </div>
  )
}

function ChannelChart({ rows }: { rows: Overview['channels'] }) {
  if (!rows.length) return <div className={styles.empty}>{t.empty}</div>
  const max = Math.max(1, ...rows.map((row) => row.sessions))
  return (
    <>
      <div className={styles.legend}>
        <div>
          <i style={{ background: '#173d66' }} />
          {t.channelVisits}
        </div>
        <div>
          <i style={{ background: '#b99a61' }} />
          {t.channelConsulted}
        </div>
        <div>
          <i style={{ background: '#5d8e82' }} />
          {t.channelContacted}
        </div>
      </div>
      {rows.map((row) => {
        const viewed = Math.max(0, row.sessions - row.consulted)
        const consulted = Math.max(0, row.consulted - row.contacted)
        return (
          <div className={styles.barRow} key={row.channel}>
            <span>{row.channel}</span>
            <div
              className={styles.stack}
              role="img"
              aria-label={`${row.channel}: ${row.sessions} ${t.channelVisits}，${row.consulted} ${t.channelConsulted}，${row.contacted} ${t.channelContacted}`}
            >
              <span style={{ width: `${(viewed / max) * 100}%` }} />
              <span style={{ width: `${(consulted / max) * 100}%` }} />
              <span style={{ width: `${(row.contacted / max) * 100}%` }} />
            </div>
            <strong>{row.sessions}</strong>
          </div>
        )
      })}
    </>
  )
}

function ResearchChart({ weeks }: { weeks: Overview['research']['four_week_signals'] }) {
  const labels = [
    ...new Set(
      weeks.flatMap((week) => [
        ...Object.keys(week.intent),
        ...Object.keys(week.industry).filter((key) => key !== 'null'),
      ]),
    ),
  ]
  const ranked = labels
    .map((label) => ({
      label,
      total: weeks.reduce(
        (sum, week) => sum + (week.intent[label] ?? week.industry[label] ?? 0),
        0,
      ),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 4)
  if (!ranked.length) return <div className={styles.empty}>{t.empty}</div>
  const colors = ['#173d66', '#b99a61', '#5d8e82', '#b67462']
  const maximum = Math.max(
    1,
    ...ranked.flatMap((item) =>
      weeks.map((week) => week.intent[item.label] ?? week.industry[item.label] ?? 0),
    ),
  )
  return (
    <>
      <svg
        className={styles.chart}
        viewBox="0 0 800 220"
        role="img"
        aria-label={t.researchHint}
        preserveAspectRatio="none"
      >
        {[35, 80, 125, 170].map((y) => (
          <line key={y} x1="0" x2="800" y1={y} y2={y} />
        ))}
        {ranked.map((item, index) => (
          <polyline
            key={item.label}
            points={weeks
              .map(
                (week, weekIndex) =>
                  `${40 + weekIndex * 240},${185 - ((week.intent[item.label] ?? week.industry[item.label] ?? 0) / maximum) * 145}`,
              )
              .join(' ')}
            style={{ stroke: colors[index] }}
          />
        ))}
        {weeks.map((week, index) => (
          <text key={week.week} x={25 + index * 240} y="214" fontSize="11" fill="#84939b">
            {t.weekPrefix}
            {week.week}
            {t.weekSuffix}
          </text>
        ))}
      </svg>
      <div className={styles.legend}>
        {ranked.map((item, index) => (
          <div key={item.label}>
            <i style={{ background: colors[index] }} />
            {item.label}
          </div>
        ))}
      </div>
    </>
  )
}

function OverviewPage({ data }: { data: Overview }) {
  const cards = [
    ['total_inquiries', t.cards.total],
    ['today_inquiries', t.cards.today],
    ['anonymous_leads', t.cards.anonymous],
    ['contacted_leads', t.cards.contacted],
    ['converted_leads', t.cards.converted],
  ]
  return (
    <>
      <div className={styles.grid5}>
        {cards.map(([key, label]) => {
          const values = data.card_trends[key] ?? []
          const previous = values.slice(0, 7).reduce((a, b) => a + b, 0)
          const current = values.slice(7).reduce((a, b) => a + b, 0)
          const change = previous
            ? Math.round(((current - previous) / previous) * 100)
            : current
              ? 100
              : 0
          return (
            <article className={styles.stat} key={key}>
              <div className={styles.statLabel}>
                {label}
                <span>↗</span>
              </div>
              <div className={styles.statValue}>{data.cards[key] ?? 0}</div>
              <span className={styles.statTrend}>
                {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
              </span>
              <Sparkline values={values} />
            </article>
          )
        })}
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.trend}</h2>
          <TrendChart values={data.trend} />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.topics}</h2>
          <Bars
            rows={data.popular_topics.map((row) => ({
              label: row.category,
              value: row.count,
            }))}
          />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.policyInterest}</h2>
          <Donut
            rows={data.policy_interest.map((row) => ({
              label: row.policy,
              value: row.count,
            }))}
          />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.channels}</h2>
          <ChannelChart rows={data.channels} />
        </section>
      </div>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.research}</h2>
        <p className={styles.panelNote}>{t.researchHint}</p>
        <div className={styles.grid}>
          <Bars
            rows={data.research.weekly_topics.map((row) => ({
              label: row.topic,
              value: row.count,
            }))}
          />
          <ResearchChart weeks={data.research.four_week_signals} />
        </div>
      </section>
    </>
  )
}

function SummaryPage({ data }: { data: Summary }) {
  return (
    <>
      <div className={styles.grid3}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.pendingClaim}</div>
          <div className={styles.statValue}>{data.pending_claim}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.followingUp}</div>
          <div className={styles.statValue}>{data.following_up}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.converted}</div>
          <div className={styles.statValue}>{data.distribution.converted ?? 0}</div>
        </div>
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.distribution}</h2>
          <Donut
            rows={Object.entries(data.distribution).map(([label, value]) => ({
              label: t.statuses[label as keyof typeof t.statuses] ?? label,
              value,
            }))}
          />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.funnel}</h2>
          <Bars
            rows={Object.entries(data.funnel).map(([label, value]) => ({
              label: t.statuses[label as keyof typeof t.statuses] ?? label,
              value,
            }))}
          />
        </section>
      </div>
    </>
  )
}

function ReportPage({
  data,
  month,
  onMonthChange,
}: {
  data: Report
  month: string
  onMonthChange: (value: string) => void
}) {
  return (
    <>
      <label className={styles.field}>
        {t.month}
        <input
          className={styles.input}
          type="month"
          value={month}
          onChange={(event) => onMonthChange(event.target.value)}
        />
      </label>
      <div className={`${styles.grid3} ${styles.sectionGap}`}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.monthlyInquiries}</div>
          <div className={styles.statValue}>{data.inquiries}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.monthlyLeads}</div>
          <div className={styles.statValue}>{data.leads}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.monthlyConverted}</div>
          <div className={styles.statValue}>{data.converted}</div>
        </div>
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.topics}</h2>
          <Bars
            rows={Object.entries(data.popular_topics).map(([label, value]) => ({
              label,
              value,
            }))}
          />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.channels}</h2>
          <Bars
            rows={Object.entries(data.channels).map(([label, value]) => ({
              label,
              value,
            }))}
          />
        </section>
      </div>
    </>
  )
}

function CompliancePage({ data }: { data: Compliance }) {
  return (
    <div className={styles.grid}>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.risk}</h2>
        <Donut
          rows={Object.entries(data.session_risk).map(([label, value]) => ({
            label,
            value,
          }))}
        />
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.rejected}</h2>
        <Bars
          rows={Object.entries(data.rejection_hits.by_reason).map(([label, value]) => ({
            label,
            value,
          }))}
        />
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.auditFailures}</h2>
        <div className={styles.statValue}>{data.audit_failures.total}</div>
        <p className={styles.summaryLine}>
          {t.authFailures} · {data.audit_failures.auth_rejections}
        </p>
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.contact}</h2>
        <div className={styles.grid}>
          <div>
            <div className={styles.statValue}>{data.contact_retention.expiring_soon}</div>
            <span className={styles.summaryLine}>{t.expiringContacts}</span>
          </div>
          <div>
            <div className={styles.statValue}>{data.contact_retention.expired}</div>
            <span className={styles.summaryLine}>{t.expiredContacts}</span>
          </div>
        </div>
      </section>
    </div>
  )
}

export function LeaderPage({ id, api }: { id: PageId; api: ParkApi }) {
  const [data, setData] = useState<Overview | Summary | Report | Compliance | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  useEffect(() => {
    const suffix =
      id === 'overview'
        ? 'metrics'
        : id === 'summary'
          ? 'leads/summary'
          : id === 'reports'
            ? `reports?month=${month}`
            : 'compliance/summary'
    setIsLoading(true)
    void api
      .get<Overview | Summary | Report | Compliance>(suffix)
      .then((result) => {
        setData(result)
        setError('')
      })
      .catch(() => setError(t.failed))
      .finally(() => setIsLoading(false))
  }, [api, id, month])
  if (isLoading) return <div className={styles.message}>{t.loading}</div>
  if (error || !data) return <div className={styles.message}>{error || t.failed}</div>
  if (id === 'overview') return <OverviewPage data={data as Overview} />
  if (id === 'summary') return <SummaryPage data={data as Summary} />
  if (id === 'reports')
    return <ReportPage data={data as Report} month={month} onMonthChange={setMonth} />
  return <CompliancePage data={data as Compliance} />
}
