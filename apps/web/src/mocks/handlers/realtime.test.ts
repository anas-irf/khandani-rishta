import { afterEach, describe, expect, it } from 'vitest'
import type { Connection, Me, Page } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { realtimeStatus, startRealtime, stopRealtime } from '~/lib/realtime'
import { createTestQueryClient } from '~/test/render'
import { db } from '../db'
import { apiUrl } from '../http'

const ID = '40000000-0000-4000-8000-000000000001'

afterEach(() => {
  stopRealtime()
})

describe('mock: WebSocket', () => {
  it('answers auth with ready and counters, and pushes message.new after a REST send', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData<Me>(qk.me(), {
      ...structuredClone(db.me),
      counters: {
        unread_chats: 0,
        pending_interests: 0,
        pending_photo_requests: 0,
        unread_notifications: 0,
      },
    })
    const connection = db.connections.find((item) => item.id === ID) as Connection
    queryClient.setQueryData(qk.connections('active'), {
      pages: [{ items: [structuredClone(connection)], next_cursor: null }],
      pageParams: [undefined],
    })

    startRealtime({ queryClient, getToken: async () => 'mock-token' })
    await expect.poll(() => realtimeStatus.get(), { timeout: 5000 }).toBe('open')
    expect(queryClient.getQueryData<Me>(qk.me())?.counters).toEqual(db.me.counters)

    await fetch(apiUrl(`/v1/connections/${ID}/messages`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Pushed over the socket', client_message_id: 'ws-1' }),
    })
    await expect
      .poll(
        () =>
          queryClient.getQueryData<{ pages: Page<Connection>[] }>(qk.connections('active'))
            ?.pages[0]?.items[0]?.last_message_preview,
        { timeout: 5000 },
      )
      .toBe('Pushed over the socket')
  })
})
