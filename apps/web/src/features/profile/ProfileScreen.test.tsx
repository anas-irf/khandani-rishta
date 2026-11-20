import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { LimitDialog } from '~/components/common/LimitDialog'
import type { Home, ProfileDetail } from '~/lib/api-types'
import { closeLimitDialog } from '~/lib/dialogs'
import { qk } from '~/lib/query'
import { db } from '~/mocks/db'
import {
  makeConnection,
  makeInterest,
  makePhotoView,
  makeProfileCard,
  makeProfileDetail,
} from '~/mocks/factories'
import { apiError, apiUrl, noContent } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ProfileDetailView } from './ProfileDetailView'
import { ProfileScreen } from './ProfileScreen'

const ID = '10000000-0000-4000-8000-0000000000aa'

// The limit dialog's store outlives a test.
afterEach(() => closeLimitDialog())

function detailWith(
  overrides: Parameters<typeof makeProfileDetail>[0] = {},
  card: Parameters<typeof makeProfileCard>[0] = {},
): ProfileDetail {
  return makeProfileDetail({
    card: makeProfileCard({ id: ID, display_name: 'Ahmed R.', age: 29, ...card }),
    ...overrides,
  })
}

function renderProfile(detail: ProfileDetail, options: { withLimitDialog?: boolean } = {}) {
  server.use(http.get(apiUrl('/v1/profiles/:id'), () => HttpResponse.json(detail)))
  return renderWithProviders(
    () => (
      <>
        <ProfileScreen profileId={detail.card.id} />
        {options.withLimitDialog ? <LimitDialog /> : null}
      </>
    ),
    { me: db.me, path: `/profiles/${detail.card.id}` },
  )
}

function actionBar() {
  return screen.getByRole('region', { name: 'Actions' })
}

const pendingInterest = (direction: 'sent' | 'received', message: string | null = null) => ({
  id: '30000000-0000-4000-8000-0000000000aa',
  direction,
  status: 'pending' as const,
  message,
  created_at: '2026-11-18T09:00:00Z',
  expires_at: '2026-12-09T09:00:00Z',
})

describe('APP-PROFILE content', () => {
  it('shows a skeleton, then the header, blocks and the looking-for summary', async () => {
    const detail = detailWith({
      about_me: 'I value honesty and family.',
      basics: {
        marital_status: 'never_married',
        children_status: null,
        children_count: null,
        current_wives_count: null,
        height_cm: 178,
        weight_kg: 72,
        complexion: null,
        body_type: null,
      },
      looking_for: {
        lines: [
          {
            dimension: 'age',
            summary_values: ['24', '30'],
            importance: 'high',
            viewer_matches: true,
          },
          {
            dimension: 'religion',
            summary_values: ['islam'],
            importance: 'must',
            viewer_matches: true,
          },
          {
            dimension: 'education',
            summary_values: ['masters'],
            importance: 'medium',
            viewer_matches: false,
          },
        ],
        matched: 2,
        total: 3,
      },
    })
    renderProfile(detail)
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')

    expect(
      await screen.findByRole('heading', { level: 1, name: /Ahmed R\., 29/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('About Ahmed R.')).toBeInTheDocument()
    expect(screen.getByText('I value honesty and family.')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('5 ft 10 in (178 cm)')).toBeInTheDocument()
    expect(screen.getByText('72 kg')).toBeInTheDocument()
    expect(screen.getByText('Profile code KR4X9P')).toBeInTheDocument()

    const lookingFor = screen.getByRole('region', { name: 'What Ahmed R. is looking for' })
    expect(within(lookingFor).getByText('24 to 30 years')).toBeInTheDocument()
    expect(within(lookingFor).getByText('Must have')).toBeInTheDocument()
    expect(within(lookingFor).getByRole('img', { name: 'You do not match' })).toBeInTheDocument()
    expect(within(lookingFor).getByText('You match 2 of 3.')).toBeInTheDocument()
  })

  it('says when the member has not set any preferences', async () => {
    renderProfile(detailWith())
    expect(await screen.findByText('Ahmed R. has not set any preferences.')).toBeInTheDocument()
  })

  it('shows the compatibility ring, both fits and the dimension details', async () => {
    const user = userEvent.setup()
    renderProfile(
      detailWith({
        compatibility: {
          compat: 92,
          reasons: ['same_sect', 'age_fits'],
          viewer_fit: 97,
          owner_fit: 96,
          dimensions: [
            { dimension: 'religion', importance: 'must', score: 1, matched: true },
            { dimension: 'location', importance: 'medium', score: 0.7, matched: false },
          ],
        },
      }),
    )
    expect(await screen.findByText('92% match')).toBeInTheDocument()
    expect(screen.getByText('Ahmed R. fits 97% of what you are looking for')).toBeInTheDocument()
    expect(screen.getByText('You fit 96% of what Ahmed R. is looking for')).toBeInTheDocument()
    expect(screen.getByText('Same sect')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'See details' }))
    const list = screen.getByText('Location', { selector: 'span' }).closest('ul') as HTMLElement
    expect(within(list).getByRole('img', { name: 'Matches' })).toBeInTheDocument()
    expect(within(list).getByRole('img', { name: 'Does not match' })).toBeInTheDocument()
    expect(within(list).getByText('Must have')).toBeInTheDocument()
  })

  it('replaces locked groups with one placeholder row', async () => {
    renderProfile(
      detailWith(
        {
          locked: ['caste', 'income', 'family', 'career_details', 'health'],
          family: null,
        },
        { caste_label: null },
      ),
    )
    await screen.findByRole('heading', { level: 1 })
    const caste = document.querySelector('[data-locked="caste"]') as HTMLElement
    expect(within(caste).getByText('Caste')).toBeInTheDocument()
    expect(within(caste).getByText('Visible after you connect')).toBeInTheDocument()
    expect(document.querySelector('[data-locked="income"]')).toHaveTextContent('Monthly income')
    expect(document.querySelector('[data-locked="career_details"]')).toHaveTextContent(
      'Workplace and institute',
    )
    expect(document.querySelector('[data-locked="health"]')).toHaveTextContent('Health details')
    const family = screen.getByRole('region', { name: 'Family' })
    expect(within(family).getByText('Visible after you connect')).toBeInTheDocument()
  })

  it('shows "Hidden by this member" for a locked group at the tier connection', async () => {
    renderProfile(
      detailWith(
        { locked: ['caste'], relation: { tier: 'connection', connection_id: 'c1' } },
        { relation: { tier: 'connection', connection_id: 'c1' } },
      ),
    )
    expect(await screen.findByText('Hidden by this member')).toBeInTheDocument()
  })

  it('lists the earned verification checks with the disclaimer', async () => {
    renderProfile(detailWith({}, { badges: ['id_verified', 'new'] }))
    expect(await screen.findByText('Identity document checked by our team')).toBeInTheDocument()
    expect(screen.queryByText('Phone number confirmed')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Verification confirms identity details only. Always take your own care and involve your family.',
      ),
    ).toBeInTheDocument()
  })
})

describe('APP-PROFILE photo access', () => {
  const blurred = makePhotoView({ id: 'ph-1', is_blurred: true, large_url: null })

  it.each([
    ['can_request', "Ahmed R.'s photos are private", true],
    ['requested', 'Photo request sent. You will be notified when it is approved.', false],
    ['denied', "Ahmed R.'s photos are private", false],
    ['requests_off', "Ahmed R.'s photos are private", false],
  ] as const)('%s: shows the overlay text', async (state, text, button) => {
    renderProfile(
      detailWith(
        { photos: [blurred], locked: ['photos'], relation: { photo_access: state } },
        { photo: blurred },
      ),
    )
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(Boolean(screen.queryByRole('button', { name: 'Request photos' }))).toBe(button)
  })

  it('visible: no overlay', async () => {
    renderProfile(detailWith())
    await screen.findByRole('heading', { level: 1 })
    expect(document.querySelector('[data-photo-access]')).toBeNull()
  })

  it('"Request photos" posts the request and confirms', async () => {
    const user = userEvent.setup()
    let requested = false
    server.use(
      http.post(apiUrl('/v1/profiles/:id/photo-access'), () => {
        requested = true
        return HttpResponse.json({ status: 'pending' }, { status: 201 })
      }),
    )
    renderProfile(
      detailWith(
        { photos: [blurred], locked: ['photos'], relation: { photo_access: 'can_request' } },
        { photo: blurred },
      ),
    )
    await user.click(await screen.findByRole('button', { name: 'Request photos' }))
    expect(await screen.findByText('Request sent.')).toBeInTheDocument()
    expect(requested).toBe(true)
  })

  it('shows the placeholder and caption without photos, and links photos to the viewer', async () => {
    renderProfile(detailWith({ photos: [] }, { photo: null }))
    expect(
      await screen.findByText('No photo added yet', { selector: 'figcaption' }),
    ).toBeInTheDocument()
  })

  it('opens APP-PHOTOS at the tapped photo', async () => {
    const photos = [makePhotoView({ id: 'a' }), makePhotoView({ id: 'b', is_primary: false })]
    renderProfile(detailWith({ photos }, { photo: photos[0] ?? null }))
    const second = await screen.findByRole('link', { name: 'Open photo 2 of 2' })
    expect(second).toHaveAttribute('href', `/profiles/${ID}/photos?index=1`)
    expect(screen.getByText('1 of 2', { selector: '[data-gallery-position]' })).toBeInTheDocument()
  })
})

describe('APP-PROFILE action bar', () => {
  it('connection: "Open chat" and the connection details', async () => {
    const user = userEvent.setup()
    renderProfile(
      detailWith(
        { relation: { tier: 'connection', connection_id: 'conn-1' } },
        { relation: { tier: 'connection', connection_id: 'conn-1' } },
      ),
    )
    const chat = await screen.findByRole('link', { name: 'Open chat' })
    expect(chat).toHaveAttribute('href', '/chats/conn-1')
    expect(within(actionBar()).queryByRole('button', { name: 'Not interested' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'More actions for Ahmed R.' }))
    expect(await screen.findByRole('menuitem', { name: 'Connection details' })).toHaveAttribute(
      'href',
      '/chats/conn-1/details',
    )
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Block' })).toBeInTheDocument()
  })

  it('offers "Let {name} see my photos" when the own photos are not visible to all', async () => {
    const user = userEvent.setup()
    db.privacy.photo_visibility = 'connections'
    let granted = false
    server.use(
      http.put(apiUrl('/v1/me/photo-access/grants/:id'), () => {
        granted = true
        return noContent()
      }),
    )
    renderProfile(
      detailWith(
        { relation: { tier: 'connection', connection_id: 'conn-1' } },
        { relation: { tier: 'connection', connection_id: 'conn-1' } },
      ),
    )
    await user.click(await screen.findByRole('button', { name: 'More actions for Ahmed R.' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Let Ahmed R. see my photos' }))
    expect(await screen.findByText('Ahmed R. can now see your photos.')).toBeInTheDocument()
    expect(granted).toBe(true)
  })

  it('received: the interest with its message and expiry, "Accept" opens the chat', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/interests/:id/accept'), () =>
        HttpResponse.json({
          interest: makeInterest({ status: 'accepted' }),
          connection: makeConnection({ id: 'new-conn' }),
        }),
      ),
    )
    const { router } = renderProfile(
      detailWith({
        relation: { tier: 'interest_from_owner', interest: pendingInterest('received', 'Salam!') },
      }),
    )
    expect(await screen.findByText('Ahmed R. is interested in you')).toBeInTheDocument()
    expect(screen.getByText('Salam!')).toBeInTheDocument()
    expect(screen.getByText(/^Expires /)).toBeInTheDocument()
    expect(within(actionBar()).getByRole('button', { name: 'Decline' })).toBeInTheDocument()

    await user.click(within(actionBar()).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('You are now connected.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/new-conn'))
  })

  it('received: a full connection cap on their side has its own text', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/interests/:id/accept'), () =>
        apiError(429, 'limit_reached', 'Cap', { details: { limit: 30, used: 30, side: 'them' } }),
      ),
    )
    renderProfile(
      detailWith({
        relation: { tier: 'interest_from_owner', interest: pendingInterest('received') },
      }),
      { withLimitDialog: true },
    )
    await user.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(
      await screen.findByText(
        'This member cannot take new connections right now. Please try again later.',
      ),
    ).toBeInTheDocument()
  })

  it('received: "Decline" confirms, can also block, then goes back', async () => {
    const user = userEvent.setup()
    let body: unknown = null
    server.use(
      http.post(apiUrl('/v1/interests/:id/decline'), async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(makeInterest({ status: 'declined' }))
      }),
    )
    const { router } = renderProfile(
      detailWith({
        relation: { tier: 'interest_from_owner', interest: pendingInterest('received') },
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Decline this interest?')).toBeInTheDocument()
    expect(within(dialog).getByText('Ahmed R. will not be notified.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Also block Ahmed R.' }))
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Interest declined.')).toBeInTheDocument()
    expect(body).toEqual({ also_block: true })
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('sent: a disabled "Interest sent" and "Withdraw" with its confirmation', async () => {
    const user = userEvent.setup()
    let withdrawn = false
    server.use(
      http.post(apiUrl('/v1/interests/:id/withdraw'), () => {
        withdrawn = true
        return HttpResponse.json(makeInterest({ status: 'withdrawn' }))
      }),
    )
    renderProfile(
      detailWith({ relation: { tier: 'interest_to_owner', interest: pendingInterest('sent') } }),
    )
    expect(await screen.findByRole('button', { name: 'Interest sent' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('You can send a new one after 7 days.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Interest withdrawn.')).toBeInTheDocument()
    expect(withdrawn).toBe(true)
  })

  it.each([
    ['already_pending', 'Interest sent', null],
    ['already_connected', 'Connected', null],
    ['cooldown', 'Send interest', /^You can send an interest again on /],
    ['daily_limit', 'Send interest', "You have used today's interests. More tomorrow."],
    [
      'pending_limit',
      'Send interest',
      'You have many unanswered interests. Withdraw some to send more.',
    ],
    [
      'connection_limit',
      'Send interest',
      'You have reached the maximum number of connections. End one to connect with someone new.',
    ],
    ['own_profile_not_active', 'Send interest', 'Resume your profile to send interests.'],
  ] as const)('cannot send (%s): disabled "%s" and its line', async (reason, button, line) => {
    renderProfile(
      detailWith(
        {
          relation: {
            can_send_interest: false,
            cannot_send_reason: reason,
            can_send_interest_after: reason === 'cooldown' ? '2026-12-20' : null,
          },
        },
        { relation: { can_send_interest: false } },
      ),
    )
    const primary = await screen.findByRole('button', { name: button })
    expect(primary).toBeDisabled()
    const lineNode = document.querySelector('[data-cannot-send-line]')
    if (line === null) expect(lineNode).toBeNull()
    else expect(lineNode?.querySelector('p')?.textContent).toMatch(line)
  })

  it('cannot send: the links of the daily and pending limits', async () => {
    renderProfile(
      detailWith(
        { relation: { can_send_interest: false, cannot_send_reason: 'pending_limit' } },
        { relation: { can_send_interest: false } },
      ),
    )
    expect(await screen.findByRole('link', { name: 'View sent interests' })).toHaveAttribute(
      'href',
      '/interests?box=sent&status=pending',
    )
  })

  it('cannot send: "Verify to send more" only for an unverified viewer', async () => {
    db.me.profile.badges = []
    renderProfile(
      detailWith(
        { relation: { can_send_interest: false, cannot_send_reason: 'daily_limit' } },
        { relation: { can_send_interest: false } },
      ),
    )
    expect(await screen.findByRole('link', { name: 'Verify to send more' })).toHaveAttribute(
      'href',
      '/me/verification',
    )
  })

  it.each([
    ['verified_only', 'This member accepts interests only from verified members.', true],
    [
      'preference_match',
      'This member accepts interests only from people who fit their preferences.',
      false,
    ],
  ] as const)('cannot send (not_permitted_by_member, %s)', async (detail, text, link) => {
    renderProfile(
      detailWith(
        {
          relation: {
            can_send_interest: false,
            cannot_send_reason: 'not_permitted_by_member',
            cannot_send_detail: detail,
          },
        },
        { relation: { can_send_interest: false } },
      ),
    )
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(Boolean(screen.queryByRole('link', { name: 'Get verified' }))).toBe(link)
  })
})

describe('APP-PROFILE send interest', () => {
  async function openDialog() {
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Send interest' }))
    return { user, dialog: await screen.findByRole('dialog') }
  }

  it('sends with a template and confirms', async () => {
    let body: unknown = null
    server.use(
      http.post(apiUrl('/v1/interests'), async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ interest: makeInterest(), connection: null }, { status: 201 })
      }),
    )
    renderProfile(detailWith())
    const { user, dialog } = await openDialog()
    expect(within(dialog).getByText('Send an interest to Ahmed R.')).toBeInTheDocument()
    expect(within(dialog).getByText('8 of 10 interests left today.')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Do not include phone numbers or social media names.'),
    ).toBeInTheDocument()
    // The third template is for profiles managed by someone else.
    expect(within(dialog).queryByText(/writing on behalf of my family/)).toBeNull()

    const template =
      'Assalam-o-Alaikum. Our preferences seem to match well. Please have a look at my profile.'
    await user.click(within(dialog).getByRole('button', { name: template }))
    expect(within(dialog).getByRole('textbox', { name: /Message/ })).toHaveValue(template)
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))

    expect(await screen.findByText('Interest sent')).toBeInTheDocument()
    expect(body).toEqual({ receiver_profile_id: ID, message: template })
  })

  it('offers the third template to a managed profile and sends no message by default', async () => {
    db.me.profile.managed_by = 'parent'
    let body: unknown = null
    server.use(
      http.post(apiUrl('/v1/interests'), async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ interest: makeInterest(), connection: null }, { status: 201 })
      }),
    )
    renderProfile(detailWith())
    const { user, dialog } = await openDialog()
    expect(within(dialog).getByText(/writing on behalf of my family/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))
    await screen.findByText('Interest sent')
    expect(body).toEqual({ receiver_profile_id: ID })
  })

  it('a mutual interest offers "Start chatting"', async () => {
    server.use(
      http.post(apiUrl('/v1/interests'), () =>
        HttpResponse.json(
          { interest: makeInterest(), connection: makeConnection({ id: 'mutual-1' }) },
          { status: 201 },
        ),
      ),
    )
    const { router } = renderProfile(detailWith())
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))
    expect(await screen.findByText('You are both interested!')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start chatting' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/mutual-1'))
  })

  it('cooldown_active names the date', async () => {
    server.use(
      http.post(apiUrl('/v1/interests'), () =>
        apiError(409, 'cooldown_active', 'Wait', { details: { retry_after_date: '2026-12-20' } }),
      ),
    )
    renderProfile(detailWith())
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))
    expect(await screen.findByText(/^You can send an interest again on .*2026/)).toBeInTheDocument()
  })

  it('not_permitted_by_member (verified_only) offers "Verify now"', async () => {
    server.use(
      http.post(apiUrl('/v1/interests'), () =>
        apiError(409, 'not_permitted_by_member', 'No', { details: { reason: 'verified_only' } }),
      ),
    )
    const { router } = renderProfile(detailWith())
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))
    const alert = await screen.findByRole('alertdialog')
    expect(
      within(alert).getAllByText('This member accepts interests only from verified members.')[0],
    ).toBeInTheDocument()
    await user.click(within(alert).getByRole('button', { name: 'Verify now' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/verification'))
  })

  it('validation_failed shows the message under the field', async () => {
    server.use(
      http.post(apiUrl('/v1/interests'), () =>
        apiError(400, 'validation_failed', 'Fix', {
          fields: [{ field: 'message', code: 'contains_contact_info', message: 'No numbers' }],
        }),
      ),
    )
    renderProfile(detailWith())
    const { user, dialog } = await openDialog()
    await user.type(within(dialog).getByRole('textbox', { name: /Message/ }), 'Call 0300')
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))
    expect(
      await within(dialog).findByText(/Please remove phone numbers, email addresses and links/),
    ).toBeInTheDocument()
  })

  it('limit_reached shows the text of the limit that was hit', async () => {
    server.use(
      http.post(apiUrl('/v1/interests'), () =>
        apiError(429, 'limit_reached', 'Limit', {
          details: { limit: 'limits.pending_interests_max', used: 50, resets_at: null },
        }),
      ),
    )
    renderProfile(detailWith(), { withLimitDialog: true })
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))
    expect(
      await screen.findByText('You have many unanswered interests. Withdraw some to send more.'),
    ).toBeInTheDocument()
  })

  it('interest_already_pending refetches the profile', async () => {
    let loads = 0
    server.use(
      http.post(apiUrl('/v1/interests'), () =>
        apiError(409, 'interest_already_pending', 'Pending', { details: { interest_id: 'x' } }),
      ),
    )
    const detail = detailWith()
    server.use(
      http.get(apiUrl('/v1/profiles/:id'), () => {
        loads += 1
        return HttpResponse.json(detail)
      }),
    )
    renderWithProviders(() => <ProfileScreen profileId={ID} />, { me: db.me })
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Send interest' }))
    await waitFor(() => expect(loads).toBe(2))
  })
})

describe('APP-PROFILE other actions', () => {
  it('"Not interested" passes with an undo for 5 seconds and goes back', async () => {
    const user = userEvent.setup()
    let passed = false
    let undone = false
    server.use(
      http.put(apiUrl('/v1/passes/:id'), () => {
        passed = true
        return noContent()
      }),
      http.delete(apiUrl('/v1/passes/:id'), () => {
        undone = true
        return noContent()
      }),
    )
    const { router } = renderProfile(detailWith())
    await user.click(await screen.findByRole('button', { name: 'Not interested' }))
    expect(
      await screen.findByText('You will not see this profile for 6 months.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    await waitFor(() => expect(passed).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undone).toBe(true))
  })

  it('the heart adds to the shortlist and offers "Add a note"', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    server.use(
      http.put(apiUrl('/v1/shortlist/:id'), async ({ request }) => {
        bodies.push(await request.json())
        return noContent()
      }),
    )
    renderProfile(detailWith())
    await user.click(await screen.findByRole('button', { name: 'Add Ahmed R. to shortlist' }))
    expect(await screen.findByText('Added to your shortlist.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a note' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Ask about family')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bodies).toEqual([{}, { note: 'Ask about family' }]))
  })

  it('"Block" from the safety footer confirms, blocks and goes back', async () => {
    const user = userEvent.setup()
    let blocked = false
    server.use(
      http.put(apiUrl('/v1/blocks/:id'), () => {
        blocked = true
        return noContent()
      }),
    )
    const { router } = renderProfile(detailWith())
    await user.click(await screen.findByRole('button', { name: 'Block' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Block Ahmed R.?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Block' }))
    expect(await screen.findByText('Blocked.')).toBeInTheDocument()
    expect(blocked).toBe(true)
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })
})

describe('APP-PROFILE load errors', () => {
  it('not_found: "This profile is not available." and the card leaves cached lists', async () => {
    server.use(http.get(apiUrl('/v1/profiles/:id'), () => apiError(404, 'not_found', 'Gone')))
    const card = makeProfileCard({ id: ID })
    const other = makeProfileCard({ id: 'other' })
    const { queryClient } = renderWithProviders(() => <ProfileScreen profileId={ID} />, {
      me: db.me,
    })
    queryClient.setQueryData<Partial<Home>>(qk.home(), {
      recommendations: [card, other],
      new_members: [card],
      nearby: [],
      recent_visitors: [],
    })
    queryClient.setQueryData(qk.recommendations(), {
      pages: [{ items: [card, other], next_cursor: null }],
      pageParams: [undefined],
    })
    expect(await screen.findByText('This profile is not available.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    await waitFor(() =>
      expect(queryClient.getQueryData<Home>(qk.home())?.recommendations.map((c) => c.id)).toEqual([
        'other',
      ]),
    )
    expect(
      queryClient
        .getQueryData<{ pages: { items: { id: string }[] }[] }>(qk.recommendations())
        ?.pages[0]?.items.map((c) => c.id),
    ).toEqual(['other'])
  })

  it('limit_reached: the daily views dialog, then back', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiUrl('/v1/profiles/:id'), () =>
        apiError(429, 'limit_reached', 'Limit', { details: { limit: 50, used: 50 } }),
      ),
    )
    const { router } = renderWithProviders(() => <ProfileScreen profileId={ID} />, {
      me: db.me,
      path: `/profiles/${ID}`,
    })
    expect(
      await screen.findByText(
        'You have viewed the maximum number of profiles for today. The count resets at midnight, Pakistan time.',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('profile_not_active: the status panel of a paused profile', async () => {
    db.me.profile.status = 'paused'
    const member = [...db.profiles.values()].find((p) => p.relation.tier === 'member')
    renderWithProviders(() => <ProfileScreen profileId={member?.card.id ?? ''} />, { me: db.me })
    expect(await screen.findByText('The profile is paused')).toBeInTheDocument()
  })

  it('a server error shows the screen error with its reference', async () => {
    server.use(http.get(apiUrl('/v1/profiles/:id'), () => apiError(500, 'internal_error', 'Boom')))
    renderWithProviders(() => <ProfileScreen profileId={ID} />, { me: db.me })
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/^Reference: mock-/)).toBeInTheDocument()
  })

  it('loads a seeded member from the mock API', async () => {
    const seeded = [...db.profiles.values()].find((p) => p.relation.tier === 'member')
    renderWithProviders(() => <ProfileScreen profileId={seeded?.card.id ?? ''} />, { me: db.me })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: new RegExp(`${seeded?.card.display_name}`),
      }),
    ).toBeInTheDocument()
  })
})

describe('ProfileDetailView preview', () => {
  it('shows no compatibility, no request button and no actions', async () => {
    const blurred = makePhotoView({ is_blurred: true, large_url: null })
    const detail = detailWith(
      {
        photos: [blurred],
        locked: ['photos'],
        relation: { photo_access: 'can_request' },
        compatibility: {
          compat: 90,
          reasons: [],
          viewer_fit: 90,
          owner_fit: 90,
          dimensions: [],
        },
      },
      { photo: blurred },
    )
    renderWithProviders(() => <ProfileDetailView detail={detail} preview />, { me: db.me })
    expect(await screen.findByText("Ahmed R.'s photos are private")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request photos' })).toBeNull()
    expect(screen.queryByText('90% match')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Actions' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Open photo/ })).toBeNull()
  })
})
