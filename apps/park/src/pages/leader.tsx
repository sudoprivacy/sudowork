import { useEffect, useState } from 'react'
import type { ParkApi } from './api'
import type { PageId } from './index'
import { parkLabels as t } from './labels'
import styles from './park.module.css'
import {
  LeaderDatePicker,
  LeaderMonthPicker,
  defaultLeaderRange,
  leadershipToday,
} from './leaderTime'

interface StatisticsMeta {
  as_of: number
  period?: { from: string; to: string; time_zone: string; is_partial?: boolean }
  data_quality?: Record<string, number>
}
interface Overview extends StatisticsMeta {
  popular_questions: Array<{ question: string; count: number }>
  question_samples: { total: number; available: number }
  card_comparisons: Record<string, { previous: number; current: number; change: number | null }>
  comparison_period: { from: string; to: string }
  channel_evidence: Record<string, { contacted: number; converted: number }>
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
    converted: number
  }>
  research: {
    weekly_topics: Array<{ topic: string; count: number }>
    four_week_signals: Array<{
      week: number
      from: string
      to: string
      question_sample_count: number
      sample_count: number
      topics: Record<string, number>
      intent: Record<string, number>
      industry: Record<string, number>
    }>
  }
}
interface Summary extends StatisticsMeta {
  distribution: Record<string, number>
  pending_claim: number
  following_up: number
  funnel: Record<string, number>
}
interface Report extends StatisticsMeta {
  month: string
  unverified_inquiries: number
  popular_questions: Overview['popular_questions']
  question_samples: Overview['question_samples']
  channel_evidence: Overview['channel_evidence']
  inquiries: number
  leads: number
  converted: number | null
  verified_converted: number
  popular_topics: Record<string, number>
  channels: Overview['channels']
  policy_interest: Overview['policy_interest']
}
interface Compliance extends StatisticsMeta {
  session_risk: Record<string, number>
  rejection_hits: {
    by_reason: Record<string, number>
    by_status: Record<string, number>
  }
  audit_failures: { total: number; auth_rejections: number; service_errors: number }
  contact_retention: { expiring_soon: number; expired: number }
}

function PeriodNote({ data }: IPeriodNoteProps) {
  return (
    <p className={styles.panelNote}>
      {t.selectedPeriod} · {data.period?.from} ~ {data.period?.to}
    </p>
  )
}

function EvidenceCount({ value, missing = 0 }: IEvidenceCountProps) {
  return <span>{missing ? `${t.verifiedEvents}${value} · ${t.incompleteEvents}` : value}</span>
}

function QuestionList({ rows, samples }: IQuestionListProps) {
  return (
    <>
      <p className={styles.panelNote}>{t.questionHint}</p>
      <p className={styles.panelNote}>
        {t.availableSamples} · {samples.available} / {t.completedSamples} · {samples.total}
      </p>
      {!rows.length ? (
        <div className={styles.empty}>{t.empty}</div>
      ) : (
        <table className={`${styles.table} ${styles.questionTable}`}>
          <thead>
            <tr>
              <th>{t.question}</th>
              <th>{t.questionCount}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.question}>
                <td>{row.question}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
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
    <>
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
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t.date}</th>
              <th>{t.inquiryUnit}</th>
            </tr>
          </thead>
          <tbody>
            {values.map((row) => (
              <tr key={row.day}>
                <td>{row.day}</td>
                <td>{row.inquiries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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

function ChannelChart({
  rows,
  evidence,
}: {
  rows: Overview['channels']
  evidence: Overview['channel_evidence']
}) {
  return (
    <>
      <p className={styles.panelNote}>{t.channelHint}</p>
      {!rows.length ? (
        <div className={styles.empty}>{t.empty}</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t.channel}</th>
                <th>{t.channelVisits}</th>
                <th>{t.channelConsulted}</th>
                <th>{t.channelContacted}</th>
                <th>{t.channelConverted}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.channel}>
                  <td>{row.channel}</td>
                  <td>{row.sessions}</td>
                  <td>{row.consulted}</td>
                  <td>
                    <EvidenceCount
                      value={row.contacted}
                      missing={evidence[row.channel]?.contacted}
                    />
                  </td>
                  <td>
                    <EvidenceCount
                      value={row.converted}
                      missing={evidence[row.channel]?.converted}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function ResearchChart({ weeks }: { weeks: Overview['research']['four_week_signals'] }) {
  const dimensions = [
    { key: 'topics', label: t.weeklyQuestions },
    { key: 'intent', label: t.intent },
    { key: 'industry', label: t.industry },
  ] as const
  return (
    <div>
      {dimensions.map((dimension) => {
        const labels = [...new Set(weeks.flatMap((week) => Object.keys(week[dimension.key])))]
        if (dimension.key === 'topics') {
          labels.sort((a, b) =>
            weeks.reduce((sum, week) => sum + (week.topics[b] ?? 0) - (week.topics[a] ?? 0), 0),
          )
        } else {
          labels.sort()
        }
        return (
          <section key={dimension.key}>
            <h3>{dimension.label}</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{dimension.label}</th>
                    {weeks.map((week) => (
                      <th key={week.week}>
                        {week.from} ~ {week.to}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{dimension.key === 'topics' ? t.availableSamples : t.sampleCount}</td>
                    {weeks.map((week) => (
                      <td key={week.week}>
                        {dimension.key === 'topics'
                          ? week.question_sample_count
                          : week.sample_count}
                      </td>
                    ))}
                  </tr>
                  {labels.map((label) => (
                    <tr key={label}>
                      <td>{label}</td>
                      {weeks.map((week) => (
                        <td key={week.week}>{week[dimension.key][label] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
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
          const change = data.card_comparisons[key]?.change ?? null
          const evidenceKey =
            key === 'anonymous_leads'
              ? 'missing_creation_events'
              : key === 'contacted_leads'
                ? 'missing_contact_events'
                : key === 'converted_leads'
                  ? 'missing_conversion_events'
                  : ''
          const missing = data.data_quality?.[evidenceKey] ?? 0
          return (
            <article className={`${styles.stat} ${styles.overviewStat}`} key={key}>
              <div className={styles.statLabel}>{label}</div>
              <div className={styles.statValue}>{data.cards[key] ?? 0}</div>
              <span className={styles.statTrend}>
                {t.comparison} · {change === null ? t.notComparable : `${change}%`}
              </span>
              <p className={styles.panelNote}>
                {key === 'total_inquiries'
                  ? t.cumulative
                  : key === 'today_inquiries'
                    ? `${t.cards.today} · ${leadershipToday()}`
                    : t.currentStock}
              </p>
              {key === 'total_inquiries' && Boolean(data.data_quality?.legacy_inquiries) && (
                <p className={styles.panelNote}>
                  {t.unverifiedHistory} · {data.data_quality?.legacy_inquiries}
                </p>
              )}
              {missing > 0 && <p className={styles.panelNote}>{t.verifiedTrend}</p>}
              <Sparkline values={values} />
            </article>
          )
        })}
      </div>
      <p className={styles.panelNote}>{t.stockHint}</p>
      <PeriodNote data={data} />
      <p className={styles.panelNote}>
        {t.comparisonPeriod} · {data.comparison_period.from} ~ {data.comparison_period.to}
      </p>
      {data.period?.is_partial && <p className={styles.panelNote}>{t.partialPeriod}</p>}
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.trend}</h2>
          <PeriodNote data={data} />
          <TrendChart values={data.trend} />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.topics}</h2>
          <PeriodNote data={data} />
          <QuestionList rows={data.popular_questions} samples={data.question_samples} />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.policyInterest}</h2>
          <PeriodNote data={data} />
          <p className={styles.panelNote}>{t.policyHint}</p>
          <Donut
            rows={data.policy_interest.map((row) => ({
              label: row.policy,
              value: row.count,
            }))}
          />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.channels}</h2>
          <PeriodNote data={data} />
          <ChannelChart rows={data.channels} evidence={data.channel_evidence} />
        </section>
      </div>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.research}</h2>
        <p className={styles.panelNote}>{t.researchHint}</p>
        <div className={styles.researchStack}>
          <section>
            <h3>{t.consultationThemes}</h3>
            <PeriodNote data={data} />
            <Bars
              rows={data.research.weekly_topics.map((row) => ({
                label: row.topic,
                value: row.count,
              }))}
            />
          </section>
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
          <PeriodNote data={data} />
          <p className={styles.panelNote}>{t.currentStock}</p>
          <Donut
            rows={Object.entries(data.distribution).map(([label, value]) => ({
              label: t.statuses[label as keyof typeof t.statuses] ?? label,
              value,
            }))}
          />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.funnel}</h2>
          <p className={styles.panelNote}>{t.funnelHint}</p>
          <PeriodNote data={data} />
          <table className={styles.table}>
            <tbody>
              {Object.entries(data.funnel).map(([key, value]) => (
                <tr key={key}>
                  <td>{t.funnelLabels[key as keyof typeof t.funnelLabels] ?? key}</td>
                  <td>
                    <EvidenceCount
                      value={value}
                      missing={
                        data.data_quality?.[
                          key === 'claimed'
                            ? 'missing_claim_events'
                            : key === 'converted'
                              ? 'missing_conversion_events'
                              : key === 'following_up'
                                ? 'missing_follow_up_records'
                                : ''
                        ]
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  )
}

function ReportPage({ data }: { data: Report }) {
  return (
    <>
      <div className={`${styles.grid3} ${styles.sectionGap}`}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.monthlyInquiries}</div>
          <div className={styles.statValue}>{data.inquiries}</div>
          {data.unverified_inquiries > 0 && (
            <p className={styles.panelNote}>
              {t.unverifiedHistory} · {data.unverified_inquiries}
            </p>
          )}
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.monthlyLeads}</div>
          <div className={styles.statValue}>{data.leads}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t.monthlyConverted}</div>
          <div className={styles.statValue}>{data.converted ?? t.uncertain}</div>
          <p className={styles.panelNote}>
            {t.verifiedConversions} · {data.verified_converted}
          </p>
        </div>
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.topics}</h2>
          <PeriodNote data={data} />
          <QuestionList rows={data.popular_questions} samples={data.question_samples} />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.channels}</h2>
          <PeriodNote data={data} />
          <ChannelChart rows={data.channels} evidence={data.channel_evidence} />
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.policyInterest}</h2>
          <PeriodNote data={data} />
          <p className={styles.panelNote}>{t.policyHint}</p>
          <Bars
            rows={data.policy_interest.map((row) => ({ label: row.policy, value: row.count }))}
          />
        </section>
      </div>
    </>
  )
}

function translatedRows(
  values: Record<string, number>,
  labels: Record<string, string>,
  fallback: string,
) {
  const totals = new Map<string, number>()
  for (const [key, value] of Object.entries(values)) {
    const label = labels[key] ?? fallback
    totals.set(label, (totals.get(label) ?? 0) + value)
  }
  return [...totals].map(([label, value]) => ({ label, value }))
}

function CompliancePage({ data }: { data: Compliance }) {
  return (
    <div className={styles.grid}>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.risk}</h2>
        <p className={styles.panelNote}>{t.riskHint}</p>
        <Donut rows={translatedRows(data.session_risk, t.riskLabels, t.unknownRisk)} />
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.rejected}</h2>
        <PeriodNote data={data} />
        <Bars
          rows={translatedRows(
            data.rejection_hits.by_reason,
            t.rejectionLabels,
            t.unknownRejection,
          )}
        />
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.auditFailures}</h2>
        <PeriodNote data={data} />
        <div className={styles.statValue}>{data.audit_failures.total}</div>
        <p className={styles.summaryLine}>
          {t.authFailures} · {data.audit_failures.auth_rejections}
        </p>
        <p className={styles.summaryLine}>
          {t.serviceErrors} · {data.audit_failures.service_errors}
        </p>
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.contact}</h2>
        <p className={styles.panelNote}>{t.currentRetention}</p>
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
  const [month, setMonth] = useState(() => leadershipToday().slice(0, 7))
  const [ranges, setRanges] = useState(() => ({
    overview: defaultLeaderRange(false),
    summary: defaultLeaderRange(true),
    compliance: defaultLeaderRange(false),
  }))
  const rangeKey = id === 'summary' ? 'summary' : id === 'compliance' ? 'compliance' : 'overview'
  const range = ranges[rangeKey]
  useEffect(() => {
    let isCurrent = true
    const suffix =
      id === 'overview'
        ? 'metrics'
        : id === 'summary'
          ? 'leads/summary'
          : id === 'reports'
            ? `reports?month=${month}`
            : 'compliance/summary'
    const query =
      id === 'reports'
        ? suffix
        : `${suffix}?${new URLSearchParams({ from: range.from, to: range.to })}`
    setIsLoading(true)
    void api
      .get<Overview | Summary | Report | Compliance>(query)
      .then((result) => {
        if (!isCurrent) return
        setData(result)
        setError('')
      })
      .catch(() => {
        if (isCurrent) setError(t.failed)
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })
    return () => {
      isCurrent = false
    }
  }, [api, id, month, range])
  return (
    <>
      {id === 'reports' ? (
        <LeaderMonthPicker value={month} onChange={setMonth} />
      ) : (
        <LeaderDatePicker
          value={range}
          onChange={(value) => setRanges((previous) => ({ ...previous, [rangeKey]: value }))}
        />
      )}
      {isLoading ? (
        <div className={styles.message}>{t.loading}</div>
      ) : error || !data ? (
        <div role="alert" className={styles.message}>
          {error || t.failed}
        </div>
      ) : (
        <>
          <p className={`${styles.panelNote} ${id === 'reports' ? '' : styles.leaderAsOf}`}>
            {t.asOf} · {new Date(data.as_of).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </p>
          {data.period && (
            <p className={`${styles.panelNote} ${id === 'reports' ? '' : styles.leaderPeriod}`}>
              {t.period} · {data.period.from} ~ {data.period.to}
            </p>
          )}
          {id === 'overview' ? (
            <OverviewPage data={data as Overview} />
          ) : id === 'summary' ? (
            <SummaryPage data={data as Summary} />
          ) : id === 'reports' ? (
            <ReportPage data={data as Report} />
          ) : (
            <CompliancePage data={data as Compliance} />
          )}
        </>
      )}
    </>
  )
}

interface IPeriodNoteProps {
  data: StatisticsMeta
}
interface IEvidenceCountProps {
  value: number
  missing?: number
}
interface IQuestionListProps {
  rows: Overview['popular_questions']
  samples: Overview['question_samples']
}
