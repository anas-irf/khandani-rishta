import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Privacy } from '~/lib/api-types'
import { db, resetDb } from '~/mocks/db'
import { apiError, apiUrl, readJson } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { PrivacyScreen } from './PrivacyScreen'

function renderScreen() {
  return renderWithProviders(() => <PrivacyScreen />, {
    path: '/settings/privacy',
    me: structuredClone(db.me),
  })
}

/** Records the bodies of `PATCH /v1/me/privacy` and lets the mock API answer. */
function recordPatches() {
  const bodies: Partial<Privacy>[] = []
  server.use(
    http.patch(apiUrl('/v1/me/privacy'), async ({ request }) => {
      bodies.push(await readJson<Partial<Privacy>>(request.clone()))
      return undefined
    }),
  )
  return bodies
}

describe('PrivacyScreen (SET-PRIVACY)', () => {
  it('shows skeleton groups while loading', async () => {
    server.use(
      http.get(apiUrl('/v1/me/privacy'), async () => {
        await delay(150)
      }),
    )
    const { container } = renderScreen()
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await screen.findByText('Who can find me')
  })

  it('shows the error state with a reference, and retries', async () => {
    let failing = true
    server.use(
      http.get(apiUrl('/v1/me/privacy'), () => {
        if (failing) return apiError(500, 'internal_error', 'Boom')
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/Reference: mock-/)).toBeInTheDocument()
    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Who can find me')).toBeInTheDocument()
  })

  it('shows the four groups with the labels and helper texts of 09 section 3', async () => {
    renderScreen()

    for (const title of ['Who can find me', 'Name and photos', 'Details I share', 'Activity']) {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(
      screen.getByText('Your profile appears in matches and search for all members.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Nobody can find you. Only people you send an interest to, and your connections, can open your profile.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Verified members only')).toBeInTheDocument()
    expect(screen.getByText('Your connections always see your full name.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No app can fully stop someone from photographing their screen. Share clear photos only with people you trust.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Let members ask to see my photos')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Age, height, marital status, religion, sect, mother tongue, city, education level and profession are always visible to members who can open your profile. To hide the whole profile, change 'Profile visibility' or pause the profile.",
      ),
    ).toBeInTheDocument()
    for (const title of [
      'Caste and sub-caste',
      'Income',
      'Family details',
      'Job title, employer and institute',
      'Home details',
      'Neighbourhood',
      'Health details',
    ]) {
      expect(screen.getByLabelText(title)).toBeInstanceOf(HTMLSelectElement)
    }
    for (const title of [
      'Show when I was last active',
      'Show when I am online',
      'Let members see that I viewed their profile',
      'Read receipts',
    ]) {
      expect(screen.getByRole('switch', { name: title })).toBeInTheDocument()
    }
  })

  it('selects the saved value in every control', async () => {
    db.privacy = {
      ...db.privacy,
      discovery_visibility: 'preference_match',
      photo_visibility: 'connections',
      income_visibility: 'nobody',
      record_my_visits: false,
    }
    renderScreen()

    expect(
      await screen.findByRole('radio', {
        name: 'Only people who fit my must-haves',
        // The help is the radio's description (RadioCard); two groups share the same title.
        description: /Only members who meet every preference you marked as a must-have can find/,
      }),
    ).toBeChecked()
    expect(screen.getByRole('radio', { name: /Connections only/ })).toBeChecked()
    expect(screen.getByLabelText('Income')).toHaveValue('nobody')
    expect(
      screen.getByRole('switch', { name: 'Let members see that I viewed their profile' }),
    ).not.toBeChecked()
  })

  it('renders the name examples with the own name and profile code', async () => {
    renderScreen()
    await screen.findByText('Name shown to members')
    // The last name comes from the own profile; the examples update once it has loaded.
    expect(await screen.findByText('Example: Ayesha Khan')).toBeInTheDocument()
    expect(screen.getByText('Example: Ayesha K.')).toBeInTheDocument()
    expect(screen.getByText('Example: Ayesha')).toBeInTheDocument()
    expect(screen.getByText('Example: A. K.')).toBeInTheDocument()
    expect(screen.getByText('Example: KR7Q2M')).toBeInTheDocument()
  })

  it('links "Review my must-haves" under both must-have options, and to photo requests', async () => {
    renderScreen()
    const links = await screen.findAllByRole('link', { name: 'Review my must-haves' })
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', '/me/preferences')
    expect(screen.getByRole('link', { name: 'Photo requests' })).toHaveAttribute(
      'href',
      '/photo-requests?box=received',
    )
    expect(
      screen.getByRole('link', { name: 'Preview how others see the profile' }),
    ).toBeInTheDocument()
  })

  it('does not link to photo requests while the profile is in review (not open under that gate)', async () => {
    resetDb('pending_review')
    renderScreen()
    await screen.findByText('Name and photos')
    expect(screen.queryByRole('link', { name: 'Photo requests' })).not.toBeInTheDocument()
  })

  it('saves a radio choice with only its key, shows "Saved", and then the new value', async () => {
    const bodies = recordPatches()
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('radio', { name: /Verified members only/ }))

    await waitFor(() => expect(bodies).toEqual([{ interest_permission: 'verified_only' }]))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Verified members only/ })).toBeChecked()
    expect(db.privacy.interest_permission).toBe('verified_only')
  })

  it('is not optimistic: the control keeps the old value and is disabled until the server answers', async () => {
    server.use(
      http.patch(apiUrl('/v1/me/privacy'), async () => {
        await delay(250)
      }),
    )
    const user = userEvent.setup()
    renderScreen()

    const everyone = await screen.findAllByRole('radio', { name: /^Anyone/ })
    const verified = screen.getByRole('radio', { name: /Verified members only/ })
    await user.click(verified)

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Verified members only/ })).toBeDisabled(),
    )
    expect(everyone[0]).toBeChecked()
    expect(screen.getByRole('radio', { name: /Verified members only/ })).not.toBeChecked()
    expect(screen.getByText('Saving')).toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Verified members only/ })).toBeChecked(),
    )
    expect(screen.getByRole('radio', { name: /Verified members only/ })).toBeEnabled()
  })

  it('asks before hiding the profile, and saves nothing when cancelled', async () => {
    const bodies = recordPatches()
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('radio', { name: /^Hidden/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('Hide the profile from matches and search?'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('You will receive no new interests unless you send one first.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(bodies).toEqual([])
    expect(db.privacy.discovery_visibility).toBe('everyone')
  })

  it('hides the profile after confirming', async () => {
    const bodies = recordPatches()
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('radio', { name: /^Hidden/ }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hide' }),
    )

    await waitFor(() => expect(bodies).toEqual([{ discovery_visibility: 'hidden' }]))
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Hidden/ })).toBeChecked())
  })

  it('saves a switch and a three-way select by their own key', async () => {
    const bodies = recordPatches()
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('switch', { name: 'Show when I am online' }))
    await waitFor(() => expect(bodies).toContainEqual({ show_online_status: false }))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Show when I am online' })).not.toBeChecked(),
    )

    await user.selectOptions(screen.getByLabelText('Family details'), 'connections')
    await waitFor(() => expect(bodies).toContainEqual({ family_visibility: 'connections' }))
    expect(db.privacy.family_visibility).toBe('connections')

    await user.click(screen.getByRole('switch', { name: 'Let members ask to see my photos' }))
    await waitFor(() => expect(bodies).toContainEqual({ allow_photo_requests: false }))
  })

  it('keeps the old value and shows "Could not save. Please try again." when saving fails', async () => {
    server.use(http.patch(apiUrl('/v1/me/privacy'), () => apiError(500, 'internal_error', 'Boom')))
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('switch', { name: 'Read receipts' }))

    expect(await screen.findByText('Could not save. Please try again.')).toBeInTheDocument()
    // The global handler did not add its own toast on top of it.
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Read receipts' })).toBeEnabled())
    expect(screen.getByRole('switch', { name: 'Read receipts' })).toBeChecked()
    expect(db.privacy.send_read_receipts).toBe(true)
  })

  it('leaves the rate limit message to the global handler', async () => {
    server.use(
      http.patch(apiUrl('/v1/me/privacy'), () =>
        apiError(429, 'rate_limited', 'Slow down', { details: { retry_after_seconds: 12 } }),
      ),
    )
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('switch', { name: 'Read receipts' }))

    expect(
      await screen.findByText('You are going a little fast. Please try again in 12 seconds.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Could not save. Please try again.')).not.toBeInTheDocument()
  })
})
