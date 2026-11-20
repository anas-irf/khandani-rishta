import { HttpResponse, http } from 'msw'
import { isOneOf } from '~/lib/api-enums'
import type {
  ApiFieldError,
  Connection,
  ContactShareBody,
  EndConnectionReason,
  Message,
  ProfileDetail,
  SafetyNotice,
  Stage,
} from '~/lib/api-types'
import { db } from '../db'
import { apiError, apiUrl, noContent, notFound, nowIso, paginate, readJson } from '../http'
import { gateErrorFor } from './account'
import { pushCounters, pushToMember } from './realtime'

/**
 * 15 section 12: connections, messages, contact sharing and stage proposals, with the rules of
 * 11 sections 5 to 9. Waiting periods and limits are the defaults of 03 section 8.
 */

const MESSAGE_MAX = 2000
const PREVIEW_LENGTH = 80
const DELETE_WINDOW_MS = 15 * 60_000
const PROPOSAL_COOLDOWN_DAYS = 7
const END_COOLDOWN_DAYS = 90
const DAY_MS = 86_400_000

export const STAGE_ORDER: readonly Stage[] = [
  'chatting',
  'families_talking',
  'engaged',
  'nikah_done',
]

export const END_REASONS: readonly EndConnectionReason[] = [
  'not_compatible',
  'family_declined',
  'no_response',
  'found_someone_else',
  'inappropriate_behaviour',
  'other',
]

type DeclinedProposal = { connectionId: string; stage: Stage; by: 'me' | 'them'; at: number }

type ChatState = {
  /** The member's own `last_read_message_id` per connection. */
  lastRead: Record<string, string | null>
  declinedProposals: DeclinedProposal[]
  /** Profiles whose accounts are unavailable (suspended): `other` is null (11 section 13 #10). */
  unavailable: Set<string>
}

/** This area's state in `db.extra` (reset with the db). */
export function chatState(): ChatState {
  let state = db.extra.chat as ChatState | undefined
  if (!state) {
    state = { lastRead: {}, declinedProposals: [], unavailable: new Set() }
    db.extra.chat = state
  }
  return state
}

let sequence = 0

/**
 * Message ids that sort in creation order, like the API's UUIDv7 (11 section 6.2), and after
 * every seeded id.
 */
export function nextMessageId(): string {
  sequence += 1
  const hex = `6${Date.now().toString(16).padStart(12, '0')}${sequence.toString(16).padStart(12, '0')}0000000`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function isBlocked(profileId: string): boolean {
  return db.blocks.some((entry) => entry.profile_id === profileId)
}

function findConnection(connectionId: string): Connection | undefined {
  return db.connections.find((connection) => connection.id === connectionId)
}

function messagesOf(connectionId: string): Message[] {
  let list = db.messages.get(connectionId)
  if (!list) {
    list = []
    db.messages.set(connectionId, list)
  }
  return list
}

function otherProfile(connection: Connection): ProfileDetail | undefined {
  return connection.other ? db.profiles.get(connection.other.id) : undefined
}

function isOtherUnavailable(connection: Connection): boolean {
  const id = connection.other?.id
  return !id || chatState().unavailable.has(id)
}

/** The connection as the member sees it (15 section 4.7). */
export function renderConnection(connection: Connection): Connection {
  const profile = otherProfile(connection)
  return {
    ...connection,
    other: isOtherUnavailable(connection) ? null : (profile?.card ?? connection.other),
    their_last_read_message_id: db.privacy.send_read_receipts
      ? connection.their_last_read_message_id
      : null,
  }
}

/** The message as the member sees it: safety notices only on messages from them. */
function renderMessage(message: Message): Message {
  return {
    ...message,
    body: message.is_deleted ? null : message.body,
    safety_notice: message.sender === 'them' ? message.safety_notice : null,
  }
}

/** Recomputes `Me.counters` that this area owns (14 section 8.2) and pushes them. */
export function recomputeCounters() {
  const now = Date.now()
  db.me.counters.pending_interests = db.interests.filter(
    (interest) =>
      interest.direction === 'received' &&
      interest.status === 'pending' &&
      new Date(interest.expires_at).getTime() > now,
  ).length
  db.me.counters.unread_chats = db.connections.filter(
    (connection) =>
      connection.status === 'active' && !connection.is_muted && connection.unread_count > 0,
  ).length
  pushCounters()
}

// ---------------------------------------------------------------------------
// Safety detector (13 section 5.2), a small subset of the patterns for mock mode
// ---------------------------------------------------------------------------

const MONEY = [
  'send money',
  'send me money',
  'transfer money',
  'need money',
  'easypaisa',
  'jazzcash',
  'bank account',
  'account number',
  'western union',
  'gift card',
  'hospital bill',
  'paise bhej',
]
const OFF_PLATFORM = ['whatsapp', 'telegram', 'snapchat', 'instagram', 'call me on', 'number do']

export function detectSafetyFlag(body: string): SafetyNotice | null {
  const text = ` ${body.toLowerCase().replace(/\s+/g, ' ')} `
  const has = (phrase: string) =>
    new RegExp(`(^|[^a-z])${phrase.replace(/ /g, '\\s')}([^a-z]|$)`).test(text)
  if (MONEY.some(has)) return 'money'
  if (OFF_PLATFORM.some(has)) return 'off_platform'
  if (/(\+?\d[\d\s-]{9,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)|(https?:\/\/|www\.)/i.test(body)) {
    return 'contact_info'
  }
  return null
}

// ---------------------------------------------------------------------------
// Writing messages
// ---------------------------------------------------------------------------

/**
 * Inserts a message, updates the connection's preview, time and unread count (11 section 6.2
 * step 6 and 6.8) and pushes `message.new`.
 */
export function appendMessage(
  connection: Connection,
  fields: Pick<Message, 'sender' | 'kind'> & Partial<Message>,
): Message {
  const message: Message = {
    id: nextMessageId(),
    connection_id: connection.id,
    body: null,
    is_deleted: false,
    system_event: null,
    system_data: null,
    client_message_id: null,
    safety_notice: null,
    created_at: nowIso(),
    ...fields,
  }
  messagesOf(connection.id).push(message)
  connection.last_message_at = message.created_at
  if (message.kind === 'text') {
    connection.last_message_preview = (message.body ?? '').slice(0, PREVIEW_LENGTH)
    connection.is_archived = false
    if (message.sender === 'them') connection.unread_count += 1
  } else {
    connection.last_message_preview = null
  }
  pushToMember('message.new', { message: renderMessage(message) })
  return message
}

/** A system message (11 section 6.8). */
export function appendSystemMessage(
  connection: Connection,
  event: NonNullable<Message['system_event']>,
  data: Record<string, unknown> = {},
): Message {
  return appendMessage(connection, {
    sender: 'system',
    kind: 'system',
    system_event: event,
    system_data: data,
  })
}

function pushConnectionUpdated(connection: Connection) {
  pushToMember('connection.updated', { connection: renderConnection(connection) })
}

function relationAfterEnd(profile: ProfileDetail | undefined, endedAt: string) {
  if (!profile) return
  const retry = new Date(new Date(endedAt).getTime() + END_COOLDOWN_DAYS * DAY_MS)
  profile.card.relation.tier = 'member'
  profile.card.relation.connection_id = null
  profile.card.relation.can_send_interest = false
  profile.relation.tier = 'member'
  profile.relation.connection_id = null
  profile.relation.can_send_interest = false
  profile.relation.cannot_send_reason = 'cooldown'
  profile.relation.can_send_interest_after = retry.toISOString().slice(0, 10)
}

/** Ends a connection (11 section 5.4): shares revoked, proposal cancelled, system message. */
export function endConnection(
  connection: Connection,
  reason: NonNullable<Connection['ended_reason']>,
  endedBy: 'me' | 'them' | 'system' = 'me',
) {
  const endedAt = nowIso()
  connection.status = 'ended'
  connection.ended_by = endedBy
  connection.ended_reason = endedBy === 'me' ? reason : null
  connection.ended_at = endedAt
  if (connection.my_contact_share) {
    connection.my_contact_share = { ...connection.my_contact_share, status: 'revoked' }
  }
  connection.their_contact = null
  connection.pending_stage_proposal = null
  appendSystemMessage(connection, 'connection_ended')
  relationAfterEnd(otherProfile(connection), endedAt)
  pushConnectionUpdated(connection)
}

/** The block effects of 15 section 13, for decline and end with `also_block`. */
export function applyBlock(profileId: string) {
  const profile = db.profiles.get(profileId)
  if (!profile || isBlocked(profileId)) return
  db.blocks.unshift({
    profile_id: profileId,
    display_name: profile.card.display_name,
    public_code: profile.card.public_code,
    created_at: nowIso(),
  })
  for (const connection of db.connections) {
    if (connection.other?.id === profileId && connection.status === 'active') {
      endConnection(connection, 'blocked')
      connection.ended_reason = 'blocked'
    }
  }
  const now = nowIso()
  for (const interest of db.interests) {
    if (interest.profile?.id !== profileId || interest.status !== 'pending') continue
    interest.status = interest.direction === 'sent' ? 'withdrawn' : 'declined'
    interest.responded_at = now
  }
  for (const entry of [...db.photoAccess.received, ...db.photoAccess.sent]) {
    if (entry.profile_id !== profileId) continue
    if (entry.status === 'granted') entry.status = 'revoked'
    if (entry.status === 'pending') entry.status = 'denied'
  }
  db.shortlist = db.shortlist.filter((entry) => entry.profile_id !== profileId)
  profile.card.relation.is_shortlisted = false
  profile.relation.is_shortlisted = false
  profile.card.relation.tier = 'member'
  profile.card.relation.connection_id = null
  profile.card.relation.interest_status = null
  profile.card.relation.interest_direction = null
  profile.relation.tier = 'member'
  profile.relation.connection_id = null
  profile.relation.interest = null
  recomputeCounters()
}

/** Ordering of 15 section 12: `last_message_at` descending, else `created_at`. */
function orderKey(connection: Connection): string {
  return connection.last_message_at ?? connection.created_at
}

function badRequest(message: string) {
  return apiError(400, 'bad_request', message)
}

function validation(fields: ApiFieldError[]) {
  return apiError(400, 'validation_failed', 'Some fields need your attention.', { fields })
}

function connectionEnded() {
  return apiError(409, 'connection_ended', 'This connection has ended.')
}

/** The member's contacts as 09 section 10.2 requires them for each share flag. */
const SHARE_FIELDS: Record<keyof ContactShareBody, () => boolean> = {
  share_phone: () => Boolean(db.ownProfile.contacts.phone_e164),
  share_whatsapp: () => Boolean(db.ownProfile.contacts.whatsapp_e164),
  share_email: () => Boolean(db.ownProfile.contacts.contact_email),
  share_guardian: () =>
    Boolean(db.ownProfile.contacts.guardian_name && db.ownProfile.contacts.guardian_phone_e164),
}

function isLaterStage(stage: string, current: Stage): stage is Stage {
  const index = STAGE_ORDER.indexOf(stage as Stage)
  return index > STAGE_ORDER.indexOf(current)
}

/** 11 section 9.4: the effects of `nikah_done` for the member. */
function applyNikahDone(connection: Connection) {
  db.me.profile.status = 'closed'
  db.ownProfile.status = 'closed'
  const now = nowIso()
  for (const interest of db.interests) {
    if (interest.status === 'pending') {
      interest.status = 'expired'
      interest.responded_at = now
    }
  }
  for (const other of db.connections) {
    if (other.id !== connection.id && other.status === 'active') {
      endConnection(other, 'found_someone_else')
    }
  }
  recomputeCounters()
}

// ---------------------------------------------------------------------------
// A simulated reply in mock mode, so live updates can be seen without a second member
// ---------------------------------------------------------------------------

const REPLIES = [
  'Walaikum Assalam. Thank you for your message.',
  'That sounds good. My family would like to know more as well.',
  'JazakAllah. I will discuss this with my parents and get back to you.',
]
let replyIndex = 0

function simulateReply(connectionId: string, readUpTo: string) {
  if (import.meta.env.MODE !== 'mock') return
  setTimeout(() => {
    const connection = findConnection(connectionId)
    if (connection?.status !== 'active') return
    if (db.privacy.send_read_receipts) {
      connection.their_last_read_message_id = readUpTo
      pushToMember('message.read', {
        connection_id: connectionId,
        reader: 'them',
        up_to_message_id: readUpTo,
      })
    }
    pushToMember('typing', { connection_id: connectionId })
    setTimeout(() => {
      const current = findConnection(connectionId)
      if (current?.status !== 'active') return
      const body = REPLIES[replyIndex % REPLIES.length] ?? 'Thank you.'
      replyIndex += 1
      appendMessage(current, { sender: 'them', kind: 'text', body })
      recomputeCounters()
    }, 2500)
  }, 2000)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handlers = [
  http.get(apiUrl('/v1/connections'), ({ request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const filter = new URL(request.url).searchParams.get('filter') ?? 'active'
    if (!['active', 'archived', 'ended'].includes(filter)) return badRequest('Unknown filter')
    const items = db.connections
      .filter((connection) => {
        if (filter === 'ended') return connection.status === 'ended'
        if (connection.status !== 'active') return false
        return filter === 'archived' ? connection.is_archived : !connection.is_archived
      })
      .sort((a, b) => (orderKey(a) < orderKey(b) ? 1 : -1))
      .map(renderConnection)
    return HttpResponse.json(paginate(items, request))
  }),

  http.get(apiUrl('/v1/connections/:connectionId'), ({ params }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    return HttpResponse.json(renderConnection(connection))
  }),

  http.patch(apiUrl('/v1/connections/:connectionId'), async ({ params, request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    const body = await readJson<Record<string, unknown>>(request)
    for (const key of Object.keys(body)) {
      if (key !== 'is_muted' && key !== 'is_archived') return badRequest(`Unknown key ${key}`)
    }
    if (typeof body.is_muted === 'boolean') connection.is_muted = body.is_muted
    if (typeof body.is_archived === 'boolean') connection.is_archived = body.is_archived
    recomputeCounters()
    return HttpResponse.json(renderConnection(connection))
  }),

  http.post(apiUrl('/v1/connections/:connectionId/end'), async ({ params, request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    if (connection.status !== 'active') return connectionEnded()
    const body = await readJson<{ reason?: string; also_block?: boolean }>(request)
    if (!body.reason || !isOneOf(END_REASONS, body.reason)) {
      return validation([
        {
          field: 'reason',
          code: body.reason ? 'unknown_code' : 'required',
          message: 'Choose a reason.',
        },
      ])
    }
    const otherId = connection.other?.id
    endConnection(connection, body.reason)
    if (body.also_block && otherId) applyBlock(otherId)
    recomputeCounters()
    return HttpResponse.json(renderConnection(connection))
  }),

  http.get(apiUrl('/v1/connections/:connectionId/messages'), ({ params, request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    const url = new URL(request.url)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 30) || 30, 1), 100)
    const before = url.searchParams.get('before')
    const after = url.searchParams.get('after')
    const all = [...messagesOf(connection.id)].sort((a, b) => (a.id < b.id ? -1 : 1))
    if (after) {
      const newer = all.filter((message) => message.id > after)
      return HttpResponse.json({
        items: newer.slice(0, limit).map(renderMessage),
        has_more: newer.length > limit,
      })
    }
    const older = before ? all.filter((message) => message.id < before) : all
    const newestFirst = older.reverse()
    return HttpResponse.json({
      items: newestFirst.slice(0, limit).map(renderMessage),
      has_more: newestFirst.length > limit,
    })
  }),

  http.post(apiUrl('/v1/connections/:connectionId/messages'), async ({ params, request }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    const body = await readJson<{ body?: unknown; client_message_id?: unknown }>(request)
    if (typeof body.client_message_id !== 'string' || !body.client_message_id) {
      return validation([
        { field: 'client_message_id', code: 'required', message: 'A message id is required.' },
      ])
    }
    // Idempotency: the same client_message_id returns the original with 200 (11 section 6.2).
    const existing = messagesOf(connection.id).find(
      (message) => message.sender === 'me' && message.client_message_id === body.client_message_id,
    )
    if (existing) return HttpResponse.json(renderMessage(existing), { status: 200 })
    if (connection.status !== 'active') return connectionEnded()
    if (isOtherUnavailable(connection)) {
      return apiError(409, 'invalid_state', 'This member is currently unavailable.', {
        details: { status: 'other_unavailable' },
      })
    }
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (!text) {
      return validation([{ field: 'body', code: 'required', message: 'Write a message first.' }])
    }
    if (text.length > MESSAGE_MAX) {
      return validation([
        { field: 'body', code: 'too_long', message: 'A message can have at most 2000 characters.' },
      ])
    }
    const message = appendMessage(connection, {
      sender: 'me',
      kind: 'text',
      body: text,
      client_message_id: body.client_message_id,
      // The detector's result is stored; only the receiver ever sees it (13 section 5.1).
      safety_notice: detectSafetyFlag(text),
    })
    simulateReply(connection.id, message.id)
    return HttpResponse.json(renderMessage(message), { status: 201 })
  }),

  http.delete(apiUrl('/v1/connections/:connectionId/messages/:messageId'), ({ params }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    const list = messagesOf(connection.id)
    const message = list.find((item) => item.id === String(params.messageId))
    if (message?.sender !== 'me') return notFound()
    if (
      message.kind !== 'text' ||
      message.is_deleted ||
      Date.now() - new Date(message.created_at).getTime() > DELETE_WINDOW_MS
    ) {
      return apiError(409, 'invalid_state', 'Messages can be removed only within 15 minutes.', {
        details: { status: message.is_deleted ? 'deleted' : 'too_late' },
      })
    }
    message.body = null
    message.is_deleted = true
    const newest = [...list].sort((a, b) => (a.id < b.id ? 1 : -1))[0]
    if (newest?.id === message.id) connection.last_message_preview = null
    pushToMember('message.deleted', { connection_id: connection.id, message_id: message.id })
    return HttpResponse.json(renderMessage(message))
  }),

  http.post(apiUrl('/v1/connections/:connectionId/read'), async ({ params, request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    const body = await readJson<{ up_to_message_id?: unknown }>(request)
    if (typeof body.up_to_message_id !== 'string') {
      return validation([{ field: 'up_to_message_id', code: 'required', message: 'Required.' }])
    }
    const state = chatState()
    const stored = state.lastRead[connection.id] ?? null
    // The stored id never moves backwards (11 section 6.5).
    const lastRead = stored && stored > body.up_to_message_id ? stored : body.up_to_message_id
    state.lastRead[connection.id] = lastRead
    connection.unread_count = messagesOf(connection.id).filter(
      (message) => message.sender === 'them' && message.kind === 'text' && message.id > lastRead,
    ).length
    recomputeCounters()
    return noContent()
  }),

  http.put(apiUrl('/v1/connections/:connectionId/contact-share'), async ({ params, request }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    if (connection.status !== 'active') return connectionEnded()
    const body = await readJson<Partial<ContactShareBody>>(request)
    const keys = Object.keys(SHARE_FIELDS) as (keyof ContactShareBody)[]
    for (const key of Object.keys(body)) {
      if (!keys.includes(key as keyof ContactShareBody)) return badRequest(`Unknown key ${key}`)
    }
    const selected = keys.filter((key) => body[key] === true)
    if (selected.length === 0) {
      return validation([
        { field: 'share_phone', code: 'invalid', message: 'Choose at least one item to share.' },
      ])
    }
    const missing = selected.filter((key) => !SHARE_FIELDS[key]())
    if (missing.length > 0) {
      return validation(
        missing.map((field) => ({ field, code: 'required', message: 'Add this detail first.' })),
      )
    }
    connection.my_contact_share = {
      share_phone: body.share_phone === true,
      share_whatsapp: body.share_whatsapp === true,
      share_email: body.share_email === true,
      share_guardian: body.share_guardian === true,
      status: 'active',
      created_at: connection.my_contact_share?.created_at ?? nowIso(),
    }
    const items = selected.map((key) => key.replace('share_', ''))
    appendSystemMessage(connection, 'contact_shared', {
      actor_profile_id: db.me.profile.id,
      items,
    })
    pushConnectionUpdated(connection)
    return HttpResponse.json(renderConnection(connection))
  }),

  http.delete(apiUrl('/v1/connections/:connectionId/contact-share'), ({ params }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    if (connection.my_contact_share?.status === 'active') {
      connection.my_contact_share = { ...connection.my_contact_share, status: 'revoked' }
      appendSystemMessage(connection, 'contact_share_revoked', {
        actor_profile_id: db.me.profile.id,
      })
      pushConnectionUpdated(connection)
    }
    return HttpResponse.json(renderConnection(connection))
  }),

  http.post(
    apiUrl('/v1/connections/:connectionId/stage-proposals'),
    async ({ params, request }) => {
      const blocked = gateErrorFor('engage')
      if (blocked) return blocked
      const connection = findConnection(String(params.connectionId))
      if (!connection) return notFound()
      if (connection.status !== 'active') return connectionEnded()
      const body = await readJson<{ stage?: string }>(request)
      if (!body.stage || !STAGE_ORDER.includes(body.stage as Stage) || body.stage === 'chatting') {
        return validation([{ field: 'stage', code: 'unknown_code', message: 'Unknown stage.' }])
      }
      if (!isLaterStage(body.stage, connection.stage)) {
        return apiError(409, 'invalid_state', 'The stage must be later than the current one.', {
          details: { status: connection.stage },
        })
      }
      if (connection.pending_stage_proposal) {
        return apiError(409, 'already_exists', 'A suggestion is already waiting for an answer.')
      }
      const stage = body.stage
      const declined = chatState().declinedProposals.find(
        (entry) =>
          entry.connectionId === connection.id &&
          entry.stage === stage &&
          entry.by === 'me' &&
          Date.now() - entry.at < PROPOSAL_COOLDOWN_DAYS * DAY_MS,
      )
      if (declined) {
        const retry = new Date(declined.at + PROPOSAL_COOLDOWN_DAYS * DAY_MS)
        return apiError(409, 'cooldown_active', 'Please wait before suggesting this again.', {
          details: { retry_after_date: retry.toISOString().slice(0, 10) },
        })
      }
      const proposalId = crypto.randomUUID()
      connection.pending_stage_proposal = {
        id: proposalId,
        stage,
        proposed_by: 'me',
        created_at: nowIso(),
      }
      appendSystemMessage(connection, 'stage_proposed', {
        actor_profile_id: db.me.profile.id,
        proposal_id: proposalId,
        stage,
      })
      pushConnectionUpdated(connection)
      return HttpResponse.json(renderConnection(connection))
    },
  ),

  http.post(
    apiUrl('/v1/connections/:connectionId/stage-proposals/:proposalId/:answer'),
    ({ params }) => {
      const blocked = gateErrorFor('engage')
      if (blocked) return blocked
      const answer = String(params.answer)
      if (answer !== 'confirm' && answer !== 'decline') return notFound()
      const connection = findConnection(String(params.connectionId))
      if (!connection) return notFound()
      if (connection.status !== 'active') return connectionEnded()
      const proposal = connection.pending_stage_proposal
      if (!proposal || proposal.id !== String(params.proposalId)) {
        return apiError(409, 'invalid_state', 'This suggestion is no longer waiting.', {
          details: { status: 'not_pending' },
        })
      }
      // Only the member who did not propose may answer (11 section 9.3).
      if (proposal.proposed_by !== 'them') {
        return apiError(403, 'forbidden', 'Only the other member can answer this suggestion.')
      }
      const data = {
        actor_profile_id: db.me.profile.id,
        proposal_id: proposal.id,
        stage: proposal.stage,
      }
      connection.pending_stage_proposal = null
      if (answer === 'confirm') {
        connection.stage = proposal.stage as Stage
        appendSystemMessage(connection, 'stage_confirmed', data)
        if (connection.stage === 'nikah_done') applyNikahDone(connection)
      } else {
        chatState().declinedProposals.push({
          connectionId: connection.id,
          stage: proposal.stage as Stage,
          by: 'them',
          at: Date.now(),
        })
        appendSystemMessage(connection, 'stage_declined', { ...data, cancelled: false })
      }
      pushConnectionUpdated(connection)
      return HttpResponse.json(renderConnection(connection))
    },
  ),

  http.delete(apiUrl('/v1/connections/:connectionId/stage-proposals/:proposalId'), ({ params }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const connection = findConnection(String(params.connectionId))
    if (!connection) return notFound()
    if (connection.status !== 'active') return connectionEnded()
    const proposal = connection.pending_stage_proposal
    if (!proposal || proposal.id !== String(params.proposalId)) {
      return apiError(409, 'invalid_state', 'This suggestion is no longer waiting.', {
        details: { status: 'not_pending' },
      })
    }
    if (proposal.proposed_by !== 'me') {
      return apiError(403, 'forbidden', 'Only the member who suggested it can withdraw it.')
    }
    connection.pending_stage_proposal = null
    appendSystemMessage(connection, 'stage_declined', {
      actor_profile_id: db.me.profile.id,
      proposal_id: proposal.id,
      stage: proposal.stage,
      cancelled: true,
    })
    pushConnectionUpdated(connection)
    return HttpResponse.json(renderConnection(connection))
  }),
]

/** For the proposal cooldown in tests: records that the member's own proposal was declined. */
export function recordDeclinedProposal(connectionId: string, stage: Stage, at = Date.now()) {
  chatState().declinedProposals.push({ connectionId, stage, by: 'me', at })
}
