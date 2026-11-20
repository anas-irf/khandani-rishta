import { describe, expect, it } from 'vitest'
import type { Connection, Interest, Page } from '~/lib/api-types'
import { db } from '../db'
import { apiUrl } from '../http'
import { interestsState } from './interests'

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const response = await fetch(apiUrl(path), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = response.status === 204 ? null : ((await response.json()) as T)
  return { status: response.status, json }
}

type ErrorBody = {
  error: {
    code: string
    details: Record<string, unknown>
    fields?: { field: string; code: string }[]
  }
}

const profiles = () => [...db.profiles.values()]
const RECEIVED = '30000000-0000-4000-8000-000000000001'
const SENT = '30000000-0000-4000-8000-000000000003'

function interest(id: string): Interest {
  const found = db.interests.find((item) => item.id === id)
  if (!found) throw new Error(`No interest ${id}`)
  return found
}

describe('mock: GET /v1/interests', () => {
  it('lists by box and status, newest first, with the quiet decline for senders', async () => {
    const sent = interest(SENT)
    sent.status = 'declined'
    sent.responded_at = new Date().toISOString()
    const waiting = await call<Page<Interest>>('GET', '/v1/interests?box=sent&status=pending')
    expect(waiting.json?.items.map((item) => [item.id, item.status, item.display_status])).toEqual([
      [SENT, 'pending', 'no_response'],
    ])

    sent.expires_at = '2026-01-01T00:00:00Z'
    const closed = await call<Page<Interest>>('GET', '/v1/interests?box=sent&status=closed')
    expect(closed.json?.items[0]).toMatchObject({
      id: SENT,
      status: 'expired',
      display_status: 'closed',
    })
  })

  it('shows a receiver their own decline as "declined"', async () => {
    interest(RECEIVED).status = 'declined'
    const closed = await call<Page<Interest>>('GET', '/v1/interests?box=received&status=closed')
    expect(closed.json?.items[0]).toMatchObject({ id: RECEIVED, display_status: 'declined' })
  })

  it('needs engage: a closed profile gets profile_not_active', async () => {
    db.me.profile.status = 'closed'
    const result = await call<ErrorBody>('GET', '/v1/interests?box=received')
    expect(result.status).toBe(403)
    expect(result.json?.error.code).toBe('profile_not_active')
  })
})

describe('mock: POST /v1/interests', () => {
  const send = (receiver: string, message?: string) =>
    call<ErrorBody & { interest: Interest; connection: Connection | null }>(
      'POST',
      '/v1/interests',
      {
        receiver_profile_id: receiver,
        ...(message === undefined ? {} : { message }),
      },
    )

  it('runs the checks in order', async () => {
    expect((await send('unknown')).json?.error.code).toBe('not_found')

    // Connected and over the daily limit: check 2 comes before check 8.
    db.me.usage.interests_sent_today = db.me.usage.interests_per_day
    const connected = await send(profiles()[0]?.card.id ?? '')
    expect(connected.json?.error).toMatchObject({
      code: 'already_connected',
      details: { connection_id: '40000000-0000-4000-8000-000000000001' },
    })
    const pending = await send(profiles()[4]?.card.id ?? '')
    expect(pending.json?.error).toMatchObject({
      code: 'interest_already_pending',
      details: { interest_id: SENT },
    })

    const daily = await send(profiles()[10]?.card.id ?? '')
    expect(daily.status).toBe(429)
    expect(daily.json?.error.details).toMatchObject({ limit: 'limits.interests_per_day' })
    expect(daily.json?.error.details.resets_at).toEqual(expect.any(String))

    db.me.usage.interests_sent_today = 0
    interestsState().permission[profiles()[11]?.card.id ?? ''] = 'verified_only'
    const permission = await send(profiles()[11]?.card.id ?? '')
    expect(permission.json?.error).toMatchObject({
      code: 'not_permitted_by_member',
      details: { reason: 'verified_only' },
    })

    const contact = await send(profiles()[12]?.card.id ?? '', 'Call me on 0300 1234567')
    expect(contact.json?.error.fields?.[0]).toMatchObject({
      field: 'message',
      code: 'contains_contact_info',
    })
  })

  it('applies the withdraw waiting period', async () => {
    await call('POST', `/v1/interests/${SENT}/withdraw`)
    const again = await send(profiles()[4]?.card.id ?? '')
    expect(again.json?.error.code).toBe('cooldown_active')
    expect(again.json?.error.details.retry_after_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('creates a pending interest, counts it and updates the relation', async () => {
    const target = profiles()[10]
    const before = db.me.usage.interests_sent_today
    const result = await send(target?.card.id ?? '', 'Assalam-o-Alaikum.')
    expect(result.status).toBe(201)
    expect(result.json?.connection).toBeNull()
    expect(result.json?.interest).toMatchObject({
      direction: 'sent',
      status: 'pending',
      message: 'Assalam-o-Alaikum.',
    })
    expect(db.me.usage.interests_sent_today).toBe(before + 1)
    expect(target?.relation).toMatchObject({
      tier: 'interest_to_owner',
      cannot_send_reason: 'already_pending',
    })
  })

  it('turns a mutual interest into a connection without counting it', async () => {
    const sender = interest(RECEIVED).profile?.id ?? ''
    const before = db.me.usage.interests_sent_today
    const result = await send(sender, 'ignored')
    expect(result.status).toBe(201)
    expect(result.json?.interest).toMatchObject({
      id: RECEIVED,
      direction: 'received',
      status: 'accepted',
    })
    expect(result.json?.connection?.other?.id).toBe(sender)
    expect(db.me.usage.interests_sent_today).toBe(before)
  })
})

describe('mock: answering interests', () => {
  it('accept creates the connection with a connected system message and updates counters', async () => {
    expect(db.me.counters.pending_interests).toBe(2)
    const result = await call<{ interest: Interest; connection: Connection }>(
      'POST',
      `/v1/interests/${RECEIVED}/accept`,
    )
    expect(result.status).toBe(200)
    const connection = result.json?.connection
    expect(connection).toMatchObject({ status: 'active', stage: 'chatting' })
    const messages = db.messages.get(connection?.id ?? '') ?? []
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      system_event: 'connected',
      system_data: { actor_profile_id: db.me.profile.id },
    })
    expect(db.me.counters.pending_interests).toBe(1)
    const again = await call<ErrorBody>('POST', `/v1/interests/${RECEIVED}/accept`)
    expect(again.json?.error.code).toBe('invalid_state')
  })

  it('accept answers limit_reached with the side whose cap is full', async () => {
    interestsState().atCapacity.add(interest(RECEIVED).profile?.id ?? '')
    const result = await call<ErrorBody>('POST', `/v1/interests/${RECEIVED}/accept`)
    expect(result.status).toBe(429)
    expect(result.json?.error.details).toMatchObject({ side: 'them' })
  })

  it('decline with also_block blocks the sender', async () => {
    const result = await call<Interest>('POST', `/v1/interests/${RECEIVED}/decline`, {
      also_block: true,
    })
    expect(result.json).toMatchObject({
      status: 'declined',
      display_status: 'declined',
      profile: null,
    })
    expect(db.blocks).toHaveLength(1)
    expect(db.me.counters.pending_interests).toBe(1)
  })

  it('withdrawing a hidden decline succeeds and the row stays declined', async () => {
    interest(SENT).status = 'declined'
    interest(SENT).responded_at = new Date().toISOString()
    const result = await call<Interest>('POST', `/v1/interests/${SENT}/withdraw`)
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ status: 'withdrawn', display_status: 'withdrawn' })
    expect(interest(SENT).status).toBe('declined')
  })

  it('seen sets the flag on received interests', async () => {
    const result = await call('POST', '/v1/interests/seen', { interest_ids: [RECEIVED] })
    expect(result.status).toBe(204)
    expect(interest(RECEIVED).seen).toBe(true)
  })
})
