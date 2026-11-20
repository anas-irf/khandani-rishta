import { ws } from 'msw'
import { apiBaseUrl } from '~/lib/api'
import { db } from '../db'
import { currentMe } from './account'

/**
 * The WebSocket of 19 section 4 in mock mode: answers `auth` with `ready` (counters included),
 * `ping` with `pong`, and lets the HTTP handlers push events (`message.new`, `counters`, ...)
 * to the signed-in member's sockets.
 */
const socketUrl = `${apiBaseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/ws`

const link = ws.link(socketUrl)

/** Client ids that sent a valid `auth` frame. */
const authenticated = new Set<string>()

/** Sends a server frame (19 section 4.6) to every authenticated socket of the member. */
export function pushToMember(type: string, data?: unknown) {
  const frame = JSON.stringify(data === undefined ? { type } : { type, data })
  for (const client of link.clients) {
    if (authenticated.has(client.id)) client.send(frame)
  }
}

/** Pushes the current `Me.counters` (14 section 8.2). */
export function pushCounters() {
  pushToMember('counters', { ...db.me.counters })
}

export const handlers = [
  link.addEventListener('connection', ({ client }) => {
    client.addEventListener('message', (event) => {
      let frame: { type?: unknown; token?: unknown } | null = null
      try {
        frame = JSON.parse(String(event.data)) as { type?: unknown; token?: unknown }
      } catch {
        client.close(4400, 'Bad frame')
        return
      }
      if (!frame || typeof frame.type !== 'string') {
        client.close(4400, 'Bad frame')
        return
      }
      if (!authenticated.has(client.id)) {
        if (frame.type !== 'auth' || typeof frame.token !== 'string' || !frame.token) {
          client.close(4401, 'Not authenticated')
          return
        }
        const me = currentMe()
        if (['banned', 'suspended', 'deletion_scheduled'].includes(me.gate)) {
          client.close(4403, 'Account may not connect')
          return
        }
        authenticated.add(client.id)
        client.send(
          JSON.stringify({
            type: 'ready',
            data: {
              profile_id: me.profile.id,
              server_time: new Date().toISOString(),
              heartbeat_seconds: 30,
              counters: { ...me.counters },
            },
          }),
        )
        return
      }
      if (frame.type === 'ping') {
        client.send(JSON.stringify({ type: 'pong' }))
      }
      // `typing` frames have no one to be relayed to in mock mode; a second `auth` is ignored.
    })
    client.addEventListener('close', () => {
      authenticated.delete(client.id)
    })
  }),
]
