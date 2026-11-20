import { describe, expect, it } from 'vitest'
import type { Connection, Message, MessagePage, Page } from '~/lib/api-types'
import { db } from '../db'
import { makeMessage } from '../factories'
import { apiUrl } from '../http'
import { chatState, detectSafetyFlag, recordDeclinedProposal } from './connections'

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

const ID = '40000000-0000-4000-8000-000000000001'
const OTHER = '40000000-0000-4000-8000-000000000002'
const base = `/v1/connections/${ID}`

function connection(id = ID): Connection {
  const found = db.connections.find((item) => item.id === id)
  if (!found) throw new Error('No connection')
  return found
}

describe('mock: connection lists', () => {
  it('filters and orders by the last message', async () => {
    connection(OTHER).last_message_at = '2026-11-20T09:00:00Z'
    const active = await call<Page<Connection>>('GET', '/v1/connections?filter=active')
    expect(active.json?.items.map((item) => item.id)).toEqual([OTHER, ID])
    connection(OTHER).is_archived = true
    const after = await call<Page<Connection>>('GET', '/v1/connections?filter=active')
    expect(after.json?.items.map((item) => item.id)).toEqual([ID])
    const archived = await call<Page<Connection>>('GET', '/v1/connections?filter=archived')
    expect(archived.json?.items.map((item) => item.id)).toEqual([OTHER])
  })

  it('answers 404 for a connection of someone else and rejects unknown PATCH keys', async () => {
    expect((await call('GET', '/v1/connections/nope')).status).toBe(404)
    const patch = await call<ErrorBody>('PATCH', base, { is_pinned: true })
    expect(patch.json?.error.code).toBe('bad_request')
    const ok = await call<Connection>('PATCH', base, { is_muted: true })
    expect(ok.json?.is_muted).toBe(true)
  })

  it('renders other as null when the account is unavailable', async () => {
    chatState().unavailable.add(connection().other?.id ?? '')
    const result = await call<Connection>('GET', base)
    expect(result.json?.other).toBeNull()
  })
})

describe('mock: messages', () => {
  function seed(count: number) {
    db.messages.set(
      ID,
      Array.from({ length: count }, (_, index) =>
        makeMessage({
          id: `m${String(index).padStart(3, '0')}`,
          connection_id: ID,
          sender: 'them',
        }),
      ),
    )
  }

  it('pages newest first with before, and oldest first with after', async () => {
    seed(45)
    const first = await call<MessagePage>('GET', `${base}/messages?limit=30`)
    expect(first.json?.items[0]?.id).toBe('m044')
    expect(first.json?.items).toHaveLength(30)
    expect(first.json?.has_more).toBe(true)
    const older = await call<MessagePage>('GET', `${base}/messages?before=m015&limit=30`)
    expect(older.json?.items.map((item) => item.id).slice(0, 2)).toEqual(['m014', 'm013'])
    expect(older.json?.has_more).toBe(false)
    const newer = await call<MessagePage>('GET', `${base}/messages?after=m040&limit=3`)
    expect(newer.json?.items.map((item) => item.id)).toEqual(['m041', 'm042', 'm043'])
    expect(newer.json?.has_more).toBe(true)
  })

  it('sends once per client_message_id and updates the preview', async () => {
    const body = { body: '  Assalam o Alaikum  ', client_message_id: 'client-1' }
    const first = await call<Message>('POST', `${base}/messages`, body)
    expect(first.status).toBe(201)
    expect(first.json).toMatchObject({
      body: 'Assalam o Alaikum',
      sender: 'me',
      safety_notice: null,
    })
    const again = await call<Message>('POST', `${base}/messages`, body)
    expect(again.status).toBe(200)
    expect(again.json?.id).toBe(first.json?.id)
    expect(connection().last_message_preview).toBe('Assalam o Alaikum')
    expect((first.json?.id ?? '') > '50000000-0000-4000-8000-000000000004').toBe(true)
  })

  it('refuses ended connections, unavailable members and empty bodies', async () => {
    const empty = await call<ErrorBody>('POST', `${base}/messages`, {
      body: '  ',
      client_message_id: 'a',
    })
    expect(empty.json?.error.fields?.[0]).toMatchObject({ field: 'body', code: 'required' })
    chatState().unavailable.add(connection().other?.id ?? '')
    const unavailable = await call<ErrorBody>('POST', `${base}/messages`, {
      body: 'Hi',
      client_message_id: 'b',
    })
    expect(unavailable.json?.error).toMatchObject({
      code: 'invalid_state',
      details: { status: 'other_unavailable' },
    })
    connection().status = 'ended'
    const ended = await call<ErrorBody>('POST', `${base}/messages`, {
      body: 'Hi',
      client_message_id: 'c',
    })
    expect(ended.json?.error.code).toBe('connection_ended')
  })

  it('removes own messages only within 15 minutes', async () => {
    const sent = await call<Message>('POST', `${base}/messages`, {
      body: 'Oops',
      client_message_id: 'd',
    })
    const removed = await call<Message>('DELETE', `${base}/messages/${sent.json?.id}`)
    expect(removed.json).toMatchObject({ body: null, is_deleted: true })
    expect(connection().last_message_preview).toBeNull()
    const old = await call<ErrorBody>(
      'DELETE',
      `${base}/messages/50000000-0000-4000-8000-000000000003`,
    )
    expect(old.json?.error.code).toBe('invalid_state')
    const theirs = await call('DELETE', `${base}/messages/50000000-0000-4000-8000-000000000004`)
    expect(theirs.status).toBe(404)
  })

  it('read recomputes the unread count and never moves backwards', async () => {
    expect(connection().unread_count).toBe(1)
    await call('POST', `${base}/read`, { up_to_message_id: '50000000-0000-4000-8000-000000000004' })
    expect(connection().unread_count).toBe(0)
    expect(db.me.counters.unread_chats).toBe(0)
    await call('POST', `${base}/read`, { up_to_message_id: '50000000-0000-4000-8000-000000000002' })
    expect(chatState().lastRead[ID]).toBe('50000000-0000-4000-8000-000000000004')
  })

  it('flags money first, then off-platform, then contact details', () => {
    expect(detectSafetyFlag('Please send money to my jazzcash 03001234567')).toBe('money')
    expect(detectSafetyFlag('Add me on WhatsApp')).toBe('off_platform')
    expect(detectSafetyFlag('My email is a.b@example.com')).toBe('contact_info')
    expect(detectSafetyFlag('How is your family?')).toBeNull()
  })
})

describe('mock: contact sharing', () => {
  it('requires a value for each shared item', async () => {
    const result = await call<ErrorBody>('PUT', `${base}/contact-share`, {
      share_phone: true,
      share_whatsapp: false,
      share_email: true,
      share_guardian: false,
    })
    expect(result.status).toBe(400)
    expect(result.json?.error.fields).toEqual([
      expect.objectContaining({ field: 'share_phone', code: 'required' }),
      expect.objectContaining({ field: 'share_email', code: 'required' }),
    ])
  })

  it('shares and stops sharing with system messages', async () => {
    db.ownProfile.contacts.phone_e164 = '+923001234567'
    const shared = await call<Connection>('PUT', `${base}/contact-share`, {
      share_phone: true,
      share_whatsapp: false,
      share_email: false,
      share_guardian: false,
    })
    expect(shared.json?.my_contact_share).toMatchObject({ share_phone: true, status: 'active' })
    expect(db.messages.get(ID)?.at(-1)).toMatchObject({
      system_event: 'contact_shared',
      system_data: { items: ['phone'] },
    })
    const stopped = await call<Connection>('DELETE', `${base}/contact-share`)
    expect(stopped.json?.my_contact_share?.status).toBe('revoked')
    expect(db.messages.get(ID)?.at(-1)?.system_event).toBe('contact_share_revoked')
  })
})

describe('mock: stages and ending', () => {
  it('validates proposals: later stage, one pending, cooldown', async () => {
    const proposed = await call<Connection>('POST', `${base}/stage-proposals`, { stage: 'engaged' })
    expect(proposed.json?.pending_stage_proposal).toMatchObject({
      stage: 'engaged',
      proposed_by: 'me',
    })
    const second = await call<ErrorBody>('POST', `${base}/stage-proposals`, { stage: 'nikah_done' })
    expect(second.json?.error.code).toBe('already_exists')
    await call('DELETE', `${base}/stage-proposals/${proposed.json?.pending_stage_proposal?.id}`)
    expect(db.messages.get(ID)?.at(-1)?.system_data).toMatchObject({ cancelled: true })

    connection().stage = 'engaged'
    const earlier = await call<ErrorBody>('POST', `${base}/stage-proposals`, {
      stage: 'families_talking',
    })
    expect(earlier.json?.error.code).toBe('invalid_state')

    recordDeclinedProposal(ID, 'nikah_done')
    const cooldown = await call<ErrorBody>('POST', `${base}/stage-proposals`, {
      stage: 'nikah_done',
    })
    expect(cooldown.json?.error.code).toBe('cooldown_active')
    expect(cooldown.json?.error.details.retry_after_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('confirming nikah_done closes the profile and ends the other connections', async () => {
    connection().pending_stage_proposal = {
      id: 'p1',
      stage: 'nikah_done',
      proposed_by: 'them',
      created_at: '2026-11-19T10:00:00Z',
    }
    const result = await call<Connection>('POST', `${base}/stage-proposals/p1/confirm`)
    expect(result.json).toMatchObject({ stage: 'nikah_done', pending_stage_proposal: null })
    expect(db.me.profile.status).toBe('closed')
    expect(connection(OTHER)).toMatchObject({ status: 'ended' })
    expect(connection()).toMatchObject({ status: 'active' })
  })

  it('only the other member may answer a proposal', async () => {
    connection().pending_stage_proposal = {
      id: 'p2',
      stage: 'engaged',
      proposed_by: 'me',
      created_at: '2026-11-19T10:00:00Z',
    }
    const result = await call<ErrorBody>('POST', `${base}/stage-proposals/p2/decline`)
    expect(result.status).toBe(403)
  })

  it('ends with a reason: shares revoked, proposal cancelled, system message, optional block', async () => {
    const missing = await call<ErrorBody>('POST', `${base}/end`, {})
    expect(missing.json?.error.fields?.[0]).toMatchObject({ field: 'reason', code: 'required' })
    connection().my_contact_share = {
      share_phone: true,
      share_whatsapp: false,
      share_email: false,
      share_guardian: false,
      status: 'active',
      created_at: '2026-11-18T10:00:00Z',
    }
    connection().pending_stage_proposal = {
      id: 'p3',
      stage: 'engaged',
      proposed_by: 'them',
      created_at: '2026-11-19T10:00:00Z',
    }
    const ended = await call<Connection>('POST', `${base}/end`, {
      reason: 'not_compatible',
      also_block: true,
    })
    expect(ended.json).toMatchObject({
      status: 'ended',
      ended_by: 'me',
      ended_reason: 'not_compatible',
      pending_stage_proposal: null,
      my_contact_share: { status: 'revoked' },
    })
    expect(db.messages.get(ID)?.at(-1)?.system_event).toBe('connection_ended')
    expect(db.blocks).toHaveLength(1)
    const again = await call<ErrorBody>('POST', `${base}/end`, { reason: 'other' })
    expect(again.json?.error.code).toBe('connection_ended')
  })
})
