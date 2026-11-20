import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { ContactsSection } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { db } from '~/mocks/db'
import { makeConnection, makeMe } from '~/mocks/factories'
import { apiError, apiUrl, validationError } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ContactsScreen } from './ContactsScreen'
import {
  type ContactsValues,
  contactsFromProfile,
  contactsToBody,
  isEmail,
  phoneIssue,
  validateContacts,
} from './contacts'

const EMPTY: ContactsSection = {
  phone_e164: null,
  whatsapp_e164: null,
  contact_email: null,
  guardian_name: null,
  guardian_relation: null,
  guardian_phone_e164: null,
  preferred_contact: 'self',
  best_time_to_call: null,
}

function values(overrides: Partial<ContactsValues> = {}): ContactsValues {
  return { ...contactsFromProfile(EMPTY), ...overrides }
}

function renderContacts(path = '/settings/contacts', me = makeMe()) {
  return renderWithProviders(() => <ContactsScreen />, { path, me })
}

describe('contacts rules (08 section 3)', () => {
  it('accepts E.164 numbers and the Pakistani mobile rule', () => {
    expect(phoneIssue('phone_e164', '+923001234567')).toBeNull()
    expect(phoneIssue('phone_e164', '+447911123456')).toBeNull()
    expect(phoneIssue('phone_e164', '923001234567')).toBe('me:errors.phone_e164.invalid')
    expect(phoneIssue('phone_e164', '+92421234567')).toBe('me:errors.phone.pk_mobile')
    expect(phoneIssue('phone_e164', '+9230012345')).toBe('me:errors.phone.pk_mobile')
    expect(phoneIssue('phone_e164', null)).toBeNull()
  })

  it('checks the email format', () => {
    expect(isEmail('ayesha@example.com')).toBe(true)
    expect(isEmail('a@b.co.uk')).toBe(true)
    expect(isEmail('ayesha@example')).toBe(false)
    expect(isEmail('@example.com')).toBe(false)
    expect(isEmail('a b@example.com')).toBe(false)
    expect(isEmail('a@@example.com')).toBe(false)
  })

  it('requires the guardian fields together and for a guardian preference', () => {
    expect(validateContacts(values())).toEqual([])
    const partial = validateContacts(values({ guardian_name: 'Khalid Mehmood' }))
    expect(partial.map((issue) => issue.path)).toEqual(['guardian_relation', 'guardian_phone_e164'])
    const preferred = validateContacts(values({ preferred_contact: 'guardian' }))
    expect(preferred.map((issue) => issue.path)).toEqual([
      'guardian_name',
      'guardian_relation',
      'guardian_phone_e164',
    ])
    expect(
      validateContacts(
        values({
          guardian_name: 'K',
          guardian_relation: 'father',
          guardian_phone_e164: '+923001234567',
        }),
      ),
    ).toEqual([{ path: 'guardian_name', message: 'me:errors.guardian_name.invalid' }])
  })

  it('limits the best time to call to 80 characters', () => {
    expect(validateContacts(values({ best_time_to_call: 'x'.repeat(81) }))).toEqual([
      { path: 'best_time_to_call', message: 'me:errors.best_time_to_call.too_long' },
    ])
  })

  it('sends the mobile number as WhatsApp when "Same as mobile number" is ticked', () => {
    const body = contactsToBody(
      values({ phone_e164: '+923001234567', whatsapp_same: true, whatsapp_e164: '+447' }),
    )
    expect(body.whatsapp_e164).toBe('+923001234567')
    expect(
      contactsFromProfile({ ...EMPTY, phone_e164: '+1', whatsapp_e164: '+1' }).whatsapp_same,
    ).toBe(true)
  })
})

describe('ContactsScreen', () => {
  it('shows a form skeleton, then the explanation and the fields', async () => {
    renderContacts()
    expect(await screen.findByLabelText('Loading your contact details')).toBeInTheDocument()
    expect(
      await screen.findByText(/These details are private. No member can see them/),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Mobile number/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Same as mobile number' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Email address/ })).toBeInTheDocument()
    // The guardian group is collapsed while it is empty and the member is the first contact.
    expect(screen.getByRole('button', { name: "Add a guardian's contact" })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Guardian's name/ })).not.toBeInTheDocument()
  })

  it('shows the screen error when the profile cannot be loaded', async () => {
    server.use(http.get(apiUrl('/v1/me/profile'), () => apiError(500, 'internal_error', 'Boom')))
    renderContacts()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })

  it('saves the details and goes back to the connection it came from', async () => {
    const user = userEvent.setup()
    const { router } = renderContacts(
      '/settings/contacts?focus=contact_email&return_connection_id=conn-1',
    )
    const email = await screen.findByRole('textbox', { name: /Email address/ })
    await waitFor(() => expect(email).toHaveFocus())
    await user.type(email, 'ayesha@example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/conn-1/details'))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(db.ownProfile.contacts.contact_email).toBe('ayesha@example.com')
  })

  it('shows the messages of the client rules and does not call the API', async () => {
    const user = userEvent.setup()
    let calls = 0
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/contacts'), () => {
        calls += 1
        return undefined
      }),
    )
    renderContacts()
    await user.type(await screen.findByRole('textbox', { name: /Email address/ }), 'ayesha@')
    await user.click(screen.getByRole('radio', { name: 'My guardian' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(
      screen.getAllByText("Enter the guardian's name, relation and mobile number."),
    ).toHaveLength(3)
    expect(screen.getByText('Please check the highlighted fields.')).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it('shows the API field errors under the fields', async () => {
    const user = userEvent.setup()
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/contacts'), () =>
        validationError([
          { field: 'best_time_to_call', code: 'contains_contact_info', message: 'No contacts.' },
        ]),
      ),
    )
    renderContacts()
    await user.type(
      await screen.findByRole('textbox', { name: /Best time to call/ }),
      'call 0300 1234567',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(/Please remove phone numbers, email addresses and links/),
    ).toBeInTheDocument()
  })

  it('keeps the input and offers "Try again" after a server failure', async () => {
    const user = userEvent.setup()
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/contacts'), () =>
        apiError(503, 'service_unavailable', 'Down'),
      ),
    )
    renderContacts()
    const email = await screen.findByRole('textbox', { name: /Email address/ })
    await user.type(email, 'ayesha@example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Could not save. Check your connection and try again.'),
    ).toBeInTheDocument()
    expect(email).toHaveValue('ayesha@example.com')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('offers the verified phone number in one tap', async () => {
    const user = userEvent.setup()
    renderContacts(
      '/settings/contacts',
      makeMe({ user: { phone_verified: true, phone_e164: '+923001234567' } }),
    )
    await user.click(await screen.findByRole('button', { name: 'Use +92 300 1234567' }))
    const mobile = screen.getByRole('group', { name: /Mobile number/ })
    expect(within(mobile).getByRole('textbox')).toHaveValue('300 1234567')
    expect(screen.queryByRole('button', { name: /Use \+92/ })).not.toBeInTheDocument()
  })

  it('opens the guardian group and shows the hint for a managed profile', async () => {
    const user = userEvent.setup()
    db.ownProfile.account_for = { managed_by: 'parent', manager_name: 'Khalid' }
    renderContacts('/settings/contacts?focus=guardian_name')
    const name = await screen.findByRole('textbox', { name: /Guardian's name/ })
    await waitFor(() => expect(name).toHaveFocus())
    expect(
      screen.getByText(
        'You are managing this profile. You can enter your own details as the guardian.',
      ),
    ).toBeInTheDocument()
    await user.type(name, 'Khalid Mehmood')
    expect(name).toHaveValue('Khalid Mehmood')
  })

  it('warns that shared details change for connections', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderContacts()
    queryClient.setQueryData(qk.connections('active'), {
      pages: [
        {
          items: [
            makeConnection({
              my_contact_share: {
                share_phone: true,
                share_whatsapp: false,
                share_email: false,
                share_guardian: false,
                status: 'active',
                created_at: '2026-11-18T10:00:00Z',
              },
            }),
          ],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    })
    await user.type(await screen.findByRole('textbox', { name: /Email address/ }), 'a@b.co')
    expect(
      screen.getByText(
        'Connections you are sharing your contact details with will see the updated details.',
      ),
    ).toBeInTheDocument()
  })

  it('asks before discarding unsaved changes', async () => {
    const user = userEvent.setup()
    const { router } = renderContacts()
    await user.type(await screen.findByRole('textbox', { name: /Email address/ }), 'x')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/settings/contacts')
  })
})
