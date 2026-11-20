import { createHash } from 'node:crypto'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, apiUrl, noContent } from '~/mocks/http'
import { server } from '~/mocks/server'
import { PhotosScreen } from './PhotosScreen'
import { ProfileScreen } from './ProfileScreen'
import { TextsScreen } from './TextsScreen'
import { ids, renderAdmin } from './test-utils'
import { VerificationScreen } from './VerificationScreen'

/** Records the JSON bodies a route receives and answers 204. */
function capture(method: 'post', path: string) {
  const calls: { params: Record<string, unknown>; body: Record<string, unknown> }[] = []
  server.use(
    http[method](apiUrl(path), async ({ request, params }) => {
      calls.push({
        params,
        body: (await request.json().catch(() => ({}))) as Record<string, unknown>,
      })
      return noContent()
    }),
  )
  return calls
}

describe('ADM-PHOTOS', () => {
  it('shows the flagged photo first with its automatic scores and approves it', async () => {
    const approve = capture('post', '/v1/admin/photos/:id/approve')
    const user = userEvent.setup()
    renderAdmin(() => <PhotosScreen />)

    const review = await screen.findByRole('region', { name: 'Photo under review' })
    expect(within(review).getByText('result')).toBeInTheDocument()
    expect(within(review).getByText('flag')).toBeInTheDocument()
    expect(within(review).getByText('First photo of this profile.')).toBeInTheDocument()

    await user.click(within(review).getByRole('button', { name: /^Approve/ }))

    await waitFor(() => expect(approve).toHaveLength(1))
    expect(approve[0]?.params.id).toBe(ids.photo(12))
  })

  it('rejects with the reason of the number key and removes the photo from the queue', async () => {
    const reject = capture('post', '/v1/admin/photos/:id/reject')
    const user = userEvent.setup()
    renderAdmin(() => <PhotosScreen />)
    await screen.findByRole('region', { name: 'Photo under review' })
    const queue = screen.getByRole('list', { name: 'Photo queue' })
    const before = within(queue).getAllByRole('button').length

    await user.keyboard('1')

    await waitFor(() => expect(reject).toHaveLength(1))
    expect(reject[0]?.body).toEqual({ reason: 'not_a_person' })
    await waitFor(() => expect(within(queue).getAllByRole('button')).toHaveLength(before - 1))
  })
})

describe('ADM-TEXTS', () => {
  it('approves with the SHA-256 of the text that was read', async () => {
    const approve = capture('post', '/v1/admin/texts/:profileId/:field/approve')
    const user = userEvent.setup()
    renderAdmin(() => <TextsScreen />)

    const review = await screen.findByRole('region', { name: 'Text under review' })
    const text = 'I value honesty, family and faith. I enjoy reading and travelling with family.'
    expect(within(review).getByText(text)).toBeInTheDocument()

    await user.click(within(review).getByRole('button', { name: /^Approve/ }))

    await waitFor(() => expect(approve).toHaveLength(1))
    expect(approve[0]?.params).toMatchObject({ profileId: ids.profile(1), field: 'about_me' })
    expect(approve[0]?.body).toEqual({
      text_sha256: createHash('sha256').update(text).digest('hex'),
    })
  })

  it('rejects with a note for the member and the same hash', async () => {
    const reject = capture('post', '/v1/admin/texts/:profileId/:field/reject')
    const user = userEvent.setup()
    renderAdmin(() => <TextsScreen />)
    await screen.findByRole('region', { name: 'Text under review' })

    await user.keyboard('r')
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Please keep the wording respectful.' }),
    )
    expect(within(dialog).getByLabelText('Note to the member (they will see this)')).toHaveValue(
      'Please keep the wording respectful.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(reject).toHaveLength(1))
    expect(reject[0]?.body).toMatchObject({ note: 'Please keep the wording respectful.' })
    expect(String(reject[0]?.body.text_sha256)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reloads the queue and explains when the text changed (409)', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/admin/texts/:profileId/:field/approve'), () =>
        apiError(409, 'invalid_state', 'The text changed.'),
      ),
    )
    renderAdmin(() => <TextsScreen />)
    const review = await screen.findByRole('region', { name: 'Text under review' })

    await user.click(within(review).getByRole('button', { name: /^Approve/ }))

    expect(await screen.findByText(/already handled by someone else/)).toBeInTheDocument()
  })
})

describe('ADM-PROFILE', () => {
  const path = `/admin/profiles/${ids.profile(1)}`

  it('approves a profile under review', async () => {
    const approve = capture('post', '/v1/admin/profiles/:profileId/approve')
    const user = userEvent.setup()
    renderAdmin(() => <ProfileScreen />, 'moderator', path)

    expect(await screen.findByRole('heading', { name: 'Ayesha Khan' })).toBeInTheDocument()
    // Moderators do not see contact details and cannot correct locked fields.
    expect(screen.getByText('Contact details are not shown to moderators.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct locked fields' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Approve/ }))

    await waitFor(() => expect(approve).toHaveLength(1))
    expect(approve[0]?.params.profileId).toBe(ids.profile(1))
  })

  it('requests changes with a reason of 10 to 500 characters', async () => {
    const request = capture('post', '/v1/admin/profiles/:profileId/request-changes')
    const user = userEvent.setup()
    renderAdmin(() => <ProfileScreen />, 'moderator', path)
    await screen.findByRole('heading', { name: 'Ayesha Khan' })

    await user.click(screen.getByRole('button', { name: /^Request changes/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Too short')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    expect(await within(dialog).findByText('Write at least 10 characters.')).toBeInTheDocument()
    expect(request).toHaveLength(0)

    await user.click(
      within(dialog).getByRole('button', {
        name: "Please enter the candidate's real first and last name.",
      }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))

    await waitFor(() => expect(request).toHaveLength(1))
    expect(request[0]?.body).toEqual({
      reason: "Please enter the candidate's real first and last name.",
    })
  })

  it('lets an admin correct locked fields', async () => {
    renderAdmin(() => <ProfileScreen />, 'admin', path)
    expect(await screen.findByRole('button', { name: 'Correct locked fields' })).toBeInTheDocument()
  })
})

describe('ADM-VERIFICATION', () => {
  const path = `/admin/verifications/${ids.verification(1)}`

  it('keeps Approve disabled until every box is ticked, then sends photos_match', async () => {
    const approve = capture('post', '/v1/admin/verifications/:requestId/approve')
    const user = userEvent.setup()
    renderAdmin(() => <VerificationScreen />, 'moderator', path)

    expect(await screen.findByText('35200-1234560-2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Front of the card' })).toBeInTheDocument()
    const approveButton = screen.getByRole('button', { name: /^Approve/ })
    expect(approveButton).toBeDisabled()

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(10)
    for (const box of boxes) await user.click(box)
    expect(approveButton).toBeEnabled()

    await user.click(approveButton)

    await waitFor(() => expect(approve).toHaveLength(1))
    expect(approve[0]?.body).toEqual({ photos_match: true })
  })

  it('rejects with a reason from the list and a staff note', async () => {
    const reject = capture('post', '/v1/admin/verifications/:requestId/reject')
    const user = userEvent.setup()
    renderAdmin(() => <VerificationScreen />, 'moderator', path)
    await screen.findByText('35200-1234560-2')

    await user.keyboard('r')
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(await within(dialog).findByText('This field is required.')).toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'document_mismatch')
    await user.type(within(dialog).getByLabelText(/Note for staff/), 'Card says 1998-02-01')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(reject).toHaveLength(1))
    expect(reject[0]?.body).toEqual({ reason: 'document_mismatch', note: 'Card says 1998-02-01' })
  })
})
