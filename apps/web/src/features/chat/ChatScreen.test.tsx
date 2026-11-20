import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Me, Message } from '~/lib/api-types'
import { handleRealtimeEvent, presenceStore, typingStore } from '~/lib/realtime'
import { db } from '~/mocks/db'
import { makeMe, makeMessage } from '~/mocks/factories'
import { chatState } from '~/mocks/handlers/connections'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ChatScreen } from './ChatScreen'

const ID = '40000000-0000-4000-8000-000000000001'
const NEWEST_THEIRS = '50000000-0000-4000-8000-000000000004'
const OWN = '50000000-0000-4000-8000-000000000003'

function connection() {
  const found = db.connections.find((item) => item.id === ID)
  if (!found) throw new Error('No seeded connection')
  return found
}

function otherNameOf(): string {
  return connection().other?.display_name ?? ''
}

function render(me: Me = structuredClone(db.me)) {
  return renderWithProviders(() => <ChatScreen connectionId={ID} />, { path: `/chats/${ID}`, me })
}

async function opened() {
  return screen.findByText('Could you tell me a little about your family?')
}

function setMessages(messages: Message[]) {
  db.messages.set(ID, messages)
  const last = messages.at(-1)
  connection().last_message_at = last?.created_at ?? null
  connection().last_message_preview = last?.kind === 'text' ? last.body : null
  connection().unread_count = 0
}

function text(id: string, sender: 'me' | 'them', body: string, extra: Partial<Message> = {}) {
  return makeMessage({
    id,
    connection_id: ID,
    sender,
    body,
    created_at: '2026-11-19T10:00:00Z',
    ...extra,
  })
}

/** `event` may also be one a newer API sends (15 section 1: clients ignore unknown enum values). */
function system(id: string, event: string, data: Record<string, unknown> = {}) {
  return makeMessage({
    id,
    connection_id: ID,
    sender: 'system',
    kind: 'system',
    body: null,
    system_event: event as Message['system_event'],
    system_data: data,
    created_at: '2026-11-19T09:00:00Z',
  })
}

describe('APP-CHAT loading and content', () => {
  it('shows skeleton bubbles, then the conversation with a day separator, times and the system line', async () => {
    render()
    expect(await screen.findAllByRole('status', { busy: true })).not.toHaveLength(0)
    await opened()
    expect(screen.getByText('Your interest was accepted. You can now chat.')).toBeInTheDocument()
    expect(screen.getByText('Walaikum Assalam. Happy to talk.')).toBeInTheDocument()
    const log = screen.getByRole('log', { name: 'Messages' })
    // Day separators come from the message dates (more than a day ago: the long date).
    expect(within(log).getAllByText(/2026/).length).toBeGreaterThan(0)
    expect(log.querySelectorAll('time').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('link', { name: `Connection details with ${otherNameOf()}` }),
    ).toBeInTheDocument()
  })

  it('opens with the unread divider above the first unread message and marks it read', async () => {
    const reads: unknown[] = []
    server.use(
      http.post(apiUrl('/v1/connections/:id/read'), async ({ request }) => {
        reads.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render()
    await opened()
    expect(screen.getByText('Unread messages')).toBeInTheDocument()
    await waitFor(() => expect(reads).toEqual([{ up_to_message_id: NEWEST_THEIRS }]))
  })

  it('shows "No longer available" when the connection is gone', async () => {
    server.use(http.get(apiUrl('/v1/connections/:id'), () => apiError(404, 'not_found', 'Gone')))
    render()
    expect(await screen.findByText('This is no longer available.')).toBeInTheDocument()
  })

  it('shows the error state when the connection fails to load', async () => {
    server.use(
      http.get(apiUrl('/v1/connections/:id'), () => apiError(500, 'internal_error', 'Boom')),
    )
    render()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders every system message from system_event and system_data', async () => {
    const own = db.me.profile.id
    const other = connection().other?.id ?? 'x'
    const name = otherNameOf()
    setMessages([
      system('a1', 'connected', { actor_profile_id: own }),
      system('a2', 'contact_shared', { actor_profile_id: other, items: ['phone'] }),
      system('a3', 'contact_share_revoked', { actor_profile_id: own }),
      system('a4', 'stage_proposed', { actor_profile_id: own, stage: 'families_talking' }),
      system('a5', 'stage_confirmed', { actor_profile_id: other, stage: 'engaged' }),
      system('a6', 'stage_declined', {
        actor_profile_id: other,
        stage: 'engaged',
        cancelled: false,
      }),
      system('a7', 'stage_declined', { actor_profile_id: own, stage: 'engaged', cancelled: true }),
      system('a8', 'something_new', { actor_profile_id: own }),
      system('a9', 'connection_ended'),
    ])
    render()
    expect(
      await screen.findByText('You accepted the interest. You can now chat.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: `${name} shared contact details with you.` }),
    ).toHaveAttribute('href', `/chats/${ID}/details`)
    expect(screen.getByText('You stopped sharing your contact details.')).toBeInTheDocument()
    expect(screen.getByText('You suggested: Our families are in touch.')).toBeInTheDocument()
    expect(screen.getByText(`${name} confirmed: Rishta confirmed.`)).toBeInTheDocument()
    expect(screen.getByText(`${name} did not confirm the suggestion.`)).toBeInTheDocument()
    expect(screen.getByText('You withdrew your suggestion.')).toBeInTheDocument()
    expect(screen.getByText('This conversation has ended.')).toBeInTheDocument()
    expect(document.querySelector('[data-system-event="something_new"]')).toBeNull()
  })

  it('shows removed messages as "Message removed"', async () => {
    setMessages([
      text('b1', 'them', 'Hello'),
      text('b2', 'them', '', { body: null, is_deleted: true }),
    ])
    render()
    expect(await screen.findByText('Message removed')).toBeInTheDocument()
  })

  it('shows a safety notice once per flag per day, with Report on the money notice', async () => {
    const user = userEvent.setup()
    setMessages([
      text('c1', 'them', 'Please send money for the visa', { safety_notice: 'money' }),
      text('c2', 'them', 'My bank account is ready', { safety_notice: 'money' }),
      text('c3', 'them', 'Add me on telegram', { safety_notice: 'off_platform' }),
    ])
    render()
    await screen.findByText('Please send money for the visa')
    expect(document.querySelectorAll('[data-safety-notice="money"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-safety-notice="off_platform"]')).toHaveLength(1)
    expect(screen.getByText(/Never send money or share bank details/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Report' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(`Report ${otherNameOf()}`)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Asking for money' })).toBeChecked()
  })

  it('shows "Read" under the newest own message when the receipt reached it, otherwise "Sent"', async () => {
    db.privacy.send_read_receipts = true
    connection().their_last_read_message_id = OWN
    db.messages.set(ID, (db.messages.get(ID) ?? []).slice(0, 3))
    render()
    await screen.findByText('Walaikum Assalam. Happy to talk.')
    expect(document.querySelector('[data-delivery]')).toHaveTextContent('Read')
  })

  it('shows "Sent" when read receipts are off', async () => {
    db.privacy.send_read_receipts = false
    connection().their_last_read_message_id = OWN
    render()
    await opened()
    expect(document.querySelector('[data-delivery]')).toHaveTextContent('Sent')
  })

  it('shows typing and online in the header', async () => {
    render()
    await opened()
    act(() => {
      presenceStore.set({ [connection().other?.id ?? '']: true })
    })
    expect(await screen.findByText('Online now')).toBeInTheDocument()
    act(() => {
      typingStore.set({ [ID]: Date.now() + 5000 })
    })
    expect(await screen.findByText('typing...')).toBeInTheDocument()
    act(() => {
      typingStore.set({})
      presenceStore.set({})
    })
  })

  it('shows the first-chat tips once and remembers the dismissal', async () => {
    const user = userEvent.setup()
    const first = render()
    await opened()
    expect(screen.getByText('Before you start')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Before you start')).toBeNull()
    first.unmount()
    render()
    await opened()
    expect(screen.queryByText('Before you start')).toBeNull()
  })

  it('offers the conversation starters when there are no text messages yet', async () => {
    const user = userEvent.setup()
    setMessages([system('d1', 'connected', { actor_profile_id: db.me.profile.id })])
    render()
    await screen.findByText('You accepted the interest. You can now chat.')
    await user.click(screen.getByRole('button', { name: 'Assalam-o-Alaikum' }))
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Assalam-o-Alaikum')
  })

  it('virtualises the list beyond 200 messages', async () => {
    const many = Array.from({ length: 250 }, (_, index) =>
      text(
        `v${String(index).padStart(4, '0')}`,
        index % 2 ? 'me' : 'them',
        `Message number ${index}`,
      ),
    )
    setMessages(many)
    server.use(
      http.get(apiUrl('/v1/connections/:id/messages'), () =>
        HttpResponse.json({ items: [...many].reverse(), has_more: false }),
      ),
    )
    render()
    await waitFor(() => expect(document.querySelector('[data-virtualized]')).not.toBeNull())
    expect(document.querySelectorAll('[data-message-id]').length).toBeLessThan(250)
  })
})

describe('APP-CHAT history', () => {
  it('loads older messages with before= while has_more', async () => {
    const user = userEvent.setup()
    const all = Array.from({ length: 45 }, (_, index) =>
      text(`h${String(index).padStart(3, '0')}`, 'them', `History ${index}`, {
        created_at: new Date(Date.UTC(2026, 10, 18, 8, index)).toISOString(),
      }),
    )
    setMessages(all)
    const befores: (string | null)[] = []
    server.use(
      http.get(apiUrl('/v1/connections/:id/messages'), ({ request }) => {
        befores.push(new URL(request.url).searchParams.get('before'))
        return undefined
      }),
    )
    render()
    expect(await screen.findByText('History 44')).toBeInTheDocument()
    expect(screen.queryByText('History 0')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Load older messages' }))
    expect(await screen.findByText('History 0')).toBeInTheDocument()
    expect(befores).toEqual([null, 'h015'])
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull()
  })
})

describe('APP-CHAT sending', () => {
  it('sends with Enter: sending state, then the server message; Shift+Enter makes a new line', async () => {
    const user = userEvent.setup()
    const { queryClient } = render()
    await opened()
    const field = screen.getByRole('textbox', { name: 'Message' })
    await user.type(field, 'Line one{Shift>}{Enter}{/Shift}Line two')
    expect(field).toHaveValue('Line one\nLine two')
    await user.clear(field)
    await user.type(field, 'Assalam o Alaikum, my parents say salaam.{Enter}')
    expect(field).toHaveValue('')
    expect(await screen.findByText('Assalam o Alaikum, my parents say salaam.')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-delivery]')).toHaveTextContent('Sent'))
    const stored = (db.messages.get(ID) ?? []).find(
      (message) => message.body === 'Assalam o Alaikum, my parents say salaam.',
    )
    expect(stored?.client_message_id).toBeTruthy()

    // The later `message.new` for the same message is ignored (deduplication).
    act(() => {
      handleRealtimeEvent(queryClient, {
        type: 'message.new',
        data: { message: { ...stored, sender: 'me' } },
      })
    })
    expect(screen.getAllByText('Assalam o Alaikum, my parents say salaam.')).toHaveLength(1)
  })

  it('marks a failed message "Not sent. Tap to retry" and retries with the same id', async () => {
    const user = userEvent.setup()
    const ids: string[] = []
    let fail = true
    server.use(
      http.post(apiUrl('/v1/connections/:id/messages'), async ({ request }) => {
        const body = (await request.clone().json()) as { client_message_id: string }
        ids.push(body.client_message_id)
        if (fail) {
          fail = false
          return HttpResponse.error()
        }
        return undefined
      }),
    )
    render()
    await opened()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Are you there?{Enter}')
    const retry = await screen.findByRole('button', { name: 'Not sent. Tap to retry' })
    await user.click(retry)
    await waitFor(() => expect(screen.queryByRole('button', { name: /Not sent/ })).toBeNull())
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
    expect(
      (db.messages.get(ID) ?? []).filter((message) => message.body === 'Are you there?'),
    ).toHaveLength(1)
  })

  it('a failed message can be deleted locally', async () => {
    const user = userEvent.setup()
    server.use(http.post(apiUrl('/v1/connections/:id/messages'), () => HttpResponse.error()))
    render()
    await opened()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Draft{Enter}')
    await screen.findByRole('button', { name: 'Not sent. Tap to retry' })
    const bubble = screen.getByText('Draft').closest('[data-message-id]') as HTMLElement
    await user.click(within(bubble).getByRole('button', { name: 'Message options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Draft')).toBeNull())
  })

  it('shows the daily limit banner on limit_reached', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/connections/:id/messages'), () =>
        apiError(429, 'limit_reached', 'Limit', {
          details: { limit: 'limits.messages_per_day', used: 200, resets_at: null },
        }),
      ),
    )
    render()
    await opened()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'One more{Enter}')
    expect(
      await screen.findByText(
        "You have reached today's message limit. It resets at midnight, Pakistan time.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not sent. Tap to retry' })).toBeInTheDocument()
  })

  it('disables the composer after connection_ended', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/connections/:id/messages'), () => {
        connection().status = 'ended'
        connection().ended_at = new Date().toISOString()
        return apiError(409, 'connection_ended', 'Ended')
      }),
    )
    render()
    await opened()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello?{Enter}')
    expect(
      await screen.findByText('This conversation has ended. You can still read the messages.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull()
  })

  it('disables the composer when the other member became unavailable', async () => {
    const user = userEvent.setup()
    render()
    await opened()
    chatState().unavailable.add(connection().other?.id ?? '')
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello?{Enter}')
    expect(await screen.findByText('This member is currently unavailable.')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Connection details with Member no longer available' }),
    ).toBeInTheDocument()
  })

  it('removes an own message within 15 minutes after confirmation', async () => {
    const user = userEvent.setup()
    const recent = text('60000000-0000-4000-8000-000000000001', 'me', 'Sent by mistake', {
      created_at: new Date().toISOString(),
    })
    setMessages([...(db.messages.get(ID) ?? []), recent])
    render()
    await screen.findByText('Sent by mistake')
    const bubble = screen.getByText('Sent by mistake').closest('[data-message-id]') as HTMLElement
    await user.click(within(bubble).getByRole('button', { name: 'Message options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove message' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Remove this message for both of you?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Sent by mistake')).toBeNull())
    expect(screen.getByText('Message removed')).toBeInTheDocument()
  })

  it('does not offer removal for messages older than 15 minutes', async () => {
    const user = userEvent.setup()
    render()
    await opened()
    const bubble = screen
      .getByText('Walaikum Assalam. Happy to talk.')
      .closest('[data-message-id]') as HTMLElement
    await user.click(within(bubble).getByRole('button', { name: 'Message options' }))
    expect(await screen.findByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Remove message' })).toBeNull()
  })
})

describe('APP-CHAT states', () => {
  it('an ended connection shows the read-only bar and no composer', async () => {
    connection().status = 'ended'
    connection().ended_at = '2026-11-19T20:00:00Z'
    render()
    await opened()
    expect(
      screen.getByText('This conversation has ended. You can still read the messages.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull()
  })

  it('a closed own profile cannot write and is offered Reopen', async () => {
    render(makeMe({ profile: { status: 'closed' } }))
    await opened()
    expect(
      screen.getByText(/Your profile is closed. Reopen it to send messages./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reopen' })).toHaveAttribute(
      'href',
      '/settings/account',
    )
  })

  it('shows the suggestion banner for a proposal from them and confirms it', async () => {
    const user = userEvent.setup()
    connection().pending_stage_proposal = {
      id: 'p1',
      stage: 'families_talking',
      proposed_by: 'them',
      created_at: '2026-11-19T10:00:00Z',
    }
    render()
    await opened()
    expect(
      screen.getByText(`${otherNameOf()} suggests: Our families are in touch.`),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Marked: Our families are in touch.')).toBeInTheDocument()
    expect(connection().stage).toBe('families_talking')
  })
})
