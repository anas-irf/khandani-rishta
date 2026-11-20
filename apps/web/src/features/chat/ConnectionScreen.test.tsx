import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Connection, Me } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makeMe } from '~/mocks/factories'
import { chatState, recordDeclinedProposal } from '~/mocks/handlers/connections'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ConnectionScreen } from './ConnectionScreen'

const ID = '40000000-0000-4000-8000-000000000001'

function connection(): Connection {
  const found = db.connections.find((item) => item.id === ID)
  if (!found) throw new Error('No seeded connection')
  return found
}

function name(): string {
  return connection().other?.display_name ?? ''
}

function render(me: Me = structuredClone(db.me)) {
  return renderWithProviders(() => <ConnectionScreen connectionId={ID} />, {
    path: `/chats/${ID}/details`,
    me,
  })
}

async function opened() {
  return screen.findByRole('heading', { name: 'Your contact details' })
}

function withContacts() {
  db.ownProfile.contacts = {
    ...db.ownProfile.contacts,
    phone_e164: '+923001234567',
    contact_email: 'family@example.com',
  }
}

describe('APP-CONNECTION', () => {
  it('shows skeleton blocks, then the member, the stage tracker and the blocks', async () => {
    render()
    expect(await screen.findByRole('status', { busy: true })).toBeInTheDocument()
    await opened()
    expect(screen.getByText(/^Connected since /)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      `/profiles/${connection().other?.id}`,
    )
    const tracker = screen.getByRole('list', { name: 'Stages of the rishta' })
    expect(within(tracker).getByText('Getting to know each other, reached')).toBeInTheDocument()
    expect(within(tracker).getByText('Nikah completed, not reached yet')).toBeInTheDocument()
    expect(
      screen.getByText(`You have not shared your contact details with ${name()}.`),
    ).toBeInTheDocument()
    expect(
      screen.getByText(`${name()} has not shared contact details with you.`),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Mute notifications' })).not.toBeChecked()
    expect(screen.getByRole('link', { name: 'Nikah guide' })).toHaveAttribute(
      'href',
      '/nikah-guide',
    )
  })

  it('shows the error state and "No longer available"', async () => {
    server.use(http.get(apiUrl('/v1/connections/:id'), () => apiError(500, 'internal_error', 'x')))
    const first = render()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    first.unmount()
    server.use(http.get(apiUrl('/v1/connections/:id'), () => apiError(404, 'not_found', 'x')))
    render()
    expect(await screen.findByText('This is no longer available.')).toBeInTheDocument()
  })

  it('suggests the next step and withdraws the suggestion', async () => {
    const user = userEvent.setup()
    render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'Suggest the next step' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Both families have agreed (baat pakki or mangni).'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: /Rishta confirmed/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }))
    expect(
      await screen.findByText(`You suggested: Rishta confirmed. Waiting for ${name()} to confirm.`),
    ).toBeInTheDocument()
    expect(connection().pending_stage_proposal?.stage).toBe('engaged')
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByRole('button', { name: 'Suggest the next step' })).toBeInTheDocument()
    expect(connection().pending_stage_proposal).toBeNull()
  })

  it('shows the cooldown date when the same suggestion was declined less than 7 days ago', async () => {
    recordDeclinedProposal(ID, 'families_talking')
    const user = userEvent.setup()
    render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'Suggest the next step' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Our families are in touch/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }))
    expect(await screen.findByText(/^You can suggest this again on /)).toBeInTheDocument()
  })

  it('answers a suggestion from them: Not yet, and Confirm with the engaged follow-up', async () => {
    const user = userEvent.setup()
    connection().pending_stage_proposal = {
      id: 'p1',
      stage: 'families_talking',
      proposed_by: 'them',
      created_at: '2026-11-19T10:00:00Z',
    }
    const first = render()
    await opened()
    expect(screen.getByText(`${name()} suggests: Our families are in touch.`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Not yet' }))
    expect(await screen.findByRole('button', { name: 'Suggest the next step' })).toBeInTheDocument()
    first.unmount()

    connection().pending_stage_proposal = {
      id: 'p2',
      stage: 'engaged',
      proposed_by: 'them',
      created_at: '2026-11-19T11:00:00Z',
    }
    render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(
        'Would you like to pause your profile so you stop receiving new interests?',
      ),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }))
    expect(connection().stage).toBe('engaged')
  })

  it('refetches the connection on already_exists', async () => {
    let gets = 0
    server.use(
      http.get(apiUrl('/v1/connections/:id'), () => {
        gets += 1
        return undefined
      }),
      http.post(apiUrl('/v1/connections/:id/stage-proposals'), () =>
        apiError(409, 'already_exists', 'Pending'),
      ),
    )
    const user = userEvent.setup()
    render()
    await opened()
    const before = gets
    await user.click(screen.getByRole('button', { name: 'Suggest the next step' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Suggest' }),
    )
    await waitFor(() => expect(gets).toBeGreaterThan(before))
  })

  it('shares contact details: mobile ticked by default, missing items offer Add', async () => {
    withContacts()
    const user = userEvent.setup()
    render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'Share contact details' }))
    const dialog = await screen.findByRole('dialog', {
      name: `Share contact details with ${name()}`,
    })
    expect(await within(dialog).findByRole('checkbox', { name: /Mobile number/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Email address/ })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /WhatsApp number/ })).toBeDisabled()
    expect(
      within(dialog).getByRole('button', { name: 'Add your WhatsApp number' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Once shared, the other person may have saved your details/),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /Email address/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('Contact details shared.')).toBeInTheDocument()
    expect(await screen.findByText('You are sharing:')).toBeInTheDocument()
    expect(screen.getByText('+92 300 1234567')).toBeInTheDocument()
    expect(connection().my_contact_share).toMatchObject({ share_phone: true, share_email: true })
    const last = db.messages.get(ID)?.at(-1)
    expect(last).toMatchObject({ system_event: 'contact_shared' })
  })

  it('preselects the guardian when the profile is managed by a parent', async () => {
    db.ownProfile.account_for = { managed_by: 'parent', manager_name: 'Abbu' }
    db.ownProfile.contacts = {
      ...db.ownProfile.contacts,
      phone_e164: '+923001234567',
      guardian_name: 'Tariq Khan',
      guardian_relation: 'father',
      guardian_phone_e164: '+923331234567',
    }
    const user = userEvent.setup()
    render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'Share contact details' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByRole('checkbox', { name: /Guardian's contact/ }),
    ).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Mobile number/ })).not.toBeChecked()
    expect(
      within(dialog).getByText(
        'Many families prefer that first contact goes through a parent or guardian.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Tariq Khan (Father), +92 333 1234567')).toBeInTheDocument()
  })

  it('sends the member to SET-CONTACTS when the API says a shared item is required', async () => {
    withContacts()
    server.use(
      http.put(apiUrl('/v1/connections/:id/contact-share'), () =>
        apiError(400, 'validation_failed', 'Missing', {
          fields: [{ field: 'share_phone', code: 'required', message: 'Add this first.' }],
        }),
      ),
    )
    const user = userEvent.setup()
    const { router } = render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'Share contact details' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('button', { name: 'Share' }))
    expect(await within(dialog).findByText('Add your mobile number first.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add now' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/contacts'))
    expect(router.state.location.search).toEqual({ focus: 'phone_e164', return_connection_id: ID })
    expect(window.sessionStorage.getItem(`kr.chat.share_selection.${ID}`)).toContain('share_phone')
  })

  it('reopens the share dialog with the earlier selection after adding a detail', async () => {
    withContacts()
    window.sessionStorage.setItem(
      `kr.chat.share_selection.${ID}`,
      JSON.stringify({
        share_phone: false,
        share_whatsapp: false,
        share_email: true,
        share_guardian: false,
      }),
    )
    render()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('checkbox', { name: /Email address/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Mobile number/ })).not.toBeChecked()
  })

  it('stops sharing after confirmation', async () => {
    withContacts()
    connection().my_contact_share = {
      share_phone: true,
      share_whatsapp: false,
      share_email: false,
      share_guardian: false,
      status: 'active',
      created_at: '2026-11-18T10:00:00Z',
    }
    const user = userEvent.setup()
    render()
    await screen.findByText('You are sharing:')
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(`Stop sharing your contact details with ${name()}?`),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Stop sharing' }))
    expect(await screen.findByText('You stopped sharing.')).toBeInTheDocument()
    expect(connection().my_contact_share?.status).toBe('revoked')
  })

  it('shows their shared details with tap-to-call, WhatsApp and the guardian line', async () => {
    connection().their_contact = {
      phone_e164: '+923001112223',
      whatsapp_e164: '+923004445556',
      contact_email: null,
      guardian: { name: 'Rashid', relation: 'father', phone_e164: '+923217778889' },
      preferred_contact: 'guardian',
      best_time_to_call: 'After Maghrib',
    }
    render()
    await opened()
    expect(screen.getByText('Please contact the guardian first.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call +92 300 1112223' })).toHaveAttribute(
      'href',
      'tel:+923001112223',
    )
    expect(screen.getByRole('link', { name: 'Open WhatsApp for +92 300 4445556' })).toHaveAttribute(
      'href',
      'https://wa.me/923004445556',
    )
    expect(screen.getByText('Rashid (Father) +92 321 7778889')).toBeInTheDocument()
    expect(screen.getByText('Best time to call: After Maghrib')).toBeInTheDocument()
    expect(
      screen.getByText('Shared with you privately. Please do not pass these details on.'),
    ).toBeInTheDocument()
  })

  it('mutes with the switch (optimistic)', async () => {
    const user = userEvent.setup()
    render()
    await opened()
    await user.click(screen.getByRole('switch', { name: 'Mute notifications' }))
    expect(screen.getByRole('switch', { name: 'Mute notifications' })).toBeChecked()
    await waitFor(() => expect(connection().is_muted).toBe(true))
  })

  it('ends the connection with a reason and returns to the chat list', async () => {
    const user = userEvent.setup()
    const { router } = render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'End connection' }))
    const dialog = await screen.findByRole('dialog', { name: 'End this connection?' })
    expect(within(dialog).queryByRole('radio', { name: /block/i })).toBeNull()
    expect(within(dialog).queryByRole('radio', { name: /account was closed/i })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'End connection' }))
    expect(within(dialog).getByText('Please choose a reason.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'The families did not agree' }))
    await user.click(within(dialog).getByRole('button', { name: 'End connection' }))
    expect(await screen.findByText('The conversation has ended.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'))
    expect(connection()).toMatchObject({
      status: 'ended',
      ended_reason: 'family_declined',
      ended_by: 'me',
    })
  })

  it('ticks "Also block" for inappropriate behaviour and offers a report afterwards', async () => {
    const user = userEvent.setup()
    render()
    await opened()
    await user.click(screen.getByRole('button', { name: 'End connection' }))
    const dialog = await screen.findByRole('dialog', { name: 'End this connection?' })
    await user.click(within(dialog).getByRole('radio', { name: 'Inappropriate behaviour' }))
    expect(within(dialog).getByRole('checkbox', { name: `Also block ${name()}` })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'End connection' }))
    const offer = await screen.findByRole('alertdialog', {
      name: `Would you like to report ${name()}?`,
    })
    expect(within(offer).getByRole('button', { name: 'Report' })).toBeInTheDocument()
    expect(db.blocks).toHaveLength(1)
  })

  it('an ended connection shows the end line, my reason, and keeps Report and Block', async () => {
    Object.assign(connection(), {
      status: 'ended',
      ended_by: 'me',
      ended_reason: 'not_compatible',
      ended_at: '2026-11-19T10:00:00Z',
    })
    render()
    expect(await screen.findByText(/^This conversation ended on /)).toBeInTheDocument()
    expect(screen.getByText('Reason you gave: We are not compatible')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your contact details' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'End connection' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Report' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
  })

  it('shows "Member no longer available" without Report and Block', async () => {
    chatState().unavailable.add(connection().other?.id ?? '')
    render()
    await opened()
    expect(screen.getByRole('heading', { name: 'Member no longer available' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull()
  })

  it('a closed profile keeps mute, stop sharing and ending, but not the stage controls', async () => {
    render(makeMe({ profile: { status: 'closed' } }))
    await opened()
    expect(screen.queryByRole('button', { name: 'Suggest the next step' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share contact details' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Mute notifications' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'End connection' })).toBeInTheDocument()
  })
})
