import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { parkLabels as t } from './labels'
import styles from './park.module.css'

export interface LeaderDateRange {
  from: string
  to: string
}

export function leadershipToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function defaultLeaderRange(isSummary: boolean): LeaderDateRange {
  const to = leadershipToday()
  const [year, month, day] = to.split('-').map(Number)
  if (isSummary) {
    const target = new Date(Date.UTC(year!, month! - 4, 1))
    const last = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate()
    return {
      from: `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day!, last)).padStart(2, '0')}`,
      to,
    }
  }
  return {
    from: new Date(Date.parse(`${to}T00:00:00Z`) - 13 * 86400000).toISOString().slice(0, 10),
    to,
  }
}

export function LeaderDatePicker({ value, onChange }: ILeaderDatePickerProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const isValid = Boolean(
    draft.from && draft.to && draft.from <= draft.to && draft.to <= leadershipToday(),
  )
  const onDateChange = (key: keyof LeaderDateRange, date: string) => {
    const next = { ...draft, [key]: date }
    setDraft(next)
    if (next.from && next.to && next.from <= next.to && next.to <= leadershipToday()) onChange(next)
  }
  const onDateClick = (event: ReactMouseEvent<HTMLInputElement>) => {
    event.currentTarget.showPicker()
  }
  return (
    <div className={styles.leaderTime}>
      <label className={styles.field}>
        {t.startDate}
        <input
          className={styles.input}
          type="date"
          value={draft.from}
          max={leadershipToday()}
          onClick={onDateClick}
          onChange={(event) => onDateChange('from', event.target.value)}
        />
      </label>
      <label className={styles.field}>
        {t.endDate}
        <input
          className={styles.input}
          type="date"
          value={draft.to}
          max={leadershipToday()}
          onClick={onDateClick}
          onChange={(event) => onDateChange('to', event.target.value)}
        />
      </label>
      {!isValid && <span role="alert">{t.invalidRange}</span>}
    </div>
  )
}

export function LeaderMonthPicker({ value, onChange }: ILeaderMonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [year, setYear] = useState(Number(value.slice(0, 4)))
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const today = leadershipToday()
  useEffect(() => {
    if (!isOpen) return
    const onOutsideClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [isOpen])
  return (
    <div
      ref={root}
      className={styles.leaderMonth}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setIsOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.buttonSecondary}
        aria-label={t.chooseMonth}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => {
          setYear(Number(value.slice(0, 4)))
          setIsOpen(!isOpen)
        }}
      >
        {value.slice(0, 4)}
        {t.yearSuffix}
        {Number(value.slice(5))}
        {t.monthSuffix}
      </button>
      {isOpen && (
        <div role="dialog" aria-label={t.chooseMonth} className={styles.monthPanel}>
          <div className={styles.monthYear}>
            <button
              type="button"
              aria-label={t.previousYear}
              disabled={year <= 1}
              onClick={() => setYear(year - 1)}
            >
              ‹
            </button>
            <label>
              {t.year}
              <input
                type="number"
                value={year}
                min={1}
                max={Number(today.slice(0, 4))}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (next >= 1 && next <= Number(today.slice(0, 4))) setYear(next)
                }}
              />
            </label>
            <button
              type="button"
              aria-label={t.nextYear}
              disabled={year >= Number(today.slice(0, 4))}
              onClick={() => setYear(year + 1)}
            >
              ›
            </button>
          </div>
          <div className={styles.monthGrid}>
            {Array.from({ length: 12 }, (_, index) => {
              const month = `${String(year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`
              return (
                <button
                  type="button"
                  key={month}
                  disabled={month > today.slice(0, 7)}
                  aria-pressed={month === value}
                  onClick={() => {
                    onChange(month)
                    setIsOpen(false)
                    trigger.current?.focus()
                  }}
                >
                  {index + 1}
                  {t.monthSuffix}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface ILeaderDatePickerProps {
  value: LeaderDateRange
  onChange: (value: LeaderDateRange) => void
}
interface ILeaderMonthPickerProps {
  value: string
  onChange: (value: string) => void
}
