import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRelative } from '~/lib/format'

// One interval for every RelativeTime on the page, running only while one is mounted.
const listeners = new Set<() => void>()
let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const notify of listeners) notify()
    }, 60_000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getNow() {
  return now
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * "5 min ago", "Yesterday", then the date (16 rule G11), updated once a minute. The full date
 * and time are in `title` and the machine-readable instant in `dateTime`.
 */
export function RelativeTime({ value, className }: { value: string | Date; className?: string }) {
  const { i18n } = useTranslation()
  const current = useSyncExternalStore(subscribe, getNow, getNow)
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return null

  const full = new Intl.DateTimeFormat(i18n.language || 'en', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date)

  return (
    <time dateTime={date.toISOString()} title={full} className={className}>
      {formatRelative(date, new Date(Math.max(current, Date.now())))}
    </time>
  )
}
