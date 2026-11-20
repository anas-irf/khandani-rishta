import { apiBaseUrl } from './api'

/**
 * Client events (20 section 8.3, 17 section 6.5). Buffered in memory and sent to
 * `POST /v1/events` when 20 have collected, every 30 seconds, and when the tab is hidden.
 * Failures are dropped: never retried, never shown, never blocking. Nothing is sent while
 * signed out. Only events named in the specs may be tracked (07 section 17 at launch).
 * Properties never carry names, dates of birth, identity numbers, contact details, free text,
 * photo URLs, profile ids or profile codes.
 */

type ClientEvent = {
  name: string
  properties?: Record<string, string | number | boolean>
  occurred_at: string
}

const MAX_BUFFER = 20
const FLUSH_INTERVAL_MS = 30_000
const NAME_PATTERN = /^[a-z][a-z0-9_]{2,49}$/

let buffer: ClientEvent[] = []
let tokenGetter: (() => Promise<string | null>) | null = null
let timer: ReturnType<typeof setInterval> | null = null

/** Starts tracking for a signed-in session; pass null on sign-out (drops the buffer). */
export function setTrackingSession(getToken: (() => Promise<string | null>) | null) {
  tokenGetter = getToken
  if (!getToken) {
    buffer = []
    if (timer) clearInterval(timer)
    timer = null
    return
  }
  if (typeof window === 'undefined' || timer) return
  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true)
  })
}

function sanitize(properties?: Record<string, unknown>) {
  if (!properties) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(properties).slice(0, 10)) {
    if (typeof value === 'string') out[key] = value.slice(0, 100)
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

export function track(name: string, properties?: Record<string, unknown>) {
  if (!tokenGetter || !NAME_PATTERN.test(name)) return
  buffer.push({ name, properties: sanitize(properties), occurred_at: new Date().toISOString() })
  if (buffer.length >= MAX_BUFFER) void flush()
}

export async function flush(keepalive = false): Promise<void> {
  if (!tokenGetter || buffer.length === 0) return
  const events = buffer.splice(0, MAX_BUFFER)
  try {
    const token = await tokenGetter()
    if (!token) return
    await fetch(`${apiBaseUrl}/v1/events`, {
      method: 'POST',
      keepalive,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events }),
    })
  } catch {
    // Dropped on failure by design.
  }
}

/** Test helper. */
export function pendingEvents(): readonly ClientEvent[] {
  return buffer
}
