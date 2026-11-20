import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Me, OwnProfile } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makeMe, makeOwnPhoto } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { MeProfileScreen } from './MeProfileScreen'
import { completenessHints, excerpt, mustHaveCount, sectionIsEmpty } from './summaries'

function renderProfile(me: Me = makeMe({ counters: { pending_photo_requests: 2 } })) {
  return renderWithProviders(() => <MeProfileScreen />, { me, path: '/me' })
}

function setStatus(status: Me['profile']['status'], reason: string | null = null) {
  db.me.profile.status = status
  db.me.profile.status_reason = reason
  db.ownProfile.status = status
  db.ownProfile.status_reason = reason
}

describe('ME-PROFILE helpers', () => {
  it('turns the first three missing items into hint rows (08 section 6.4 example A)', () => {
    const hints = completenessHints({
      onboarding_step: 'done',
      missing: ['photo', 'about_me', 'family', 'education_details', 'religious_practice'],
    })
    expect(hints).toEqual([
      { key: 'photo', to: '/me/photos' },
      { key: 'about_me', to: '/me/edit/lifestyle' },
      { key: 'family', to: '/me/edit/family' },
    ])
  })

  it('links the verification items and skips unknown keys', () => {
    // A key a newer API may send (15 section 1: clients ignore unknown enum values).
    const newerKey: string = 'something_new'
    expect(
      completenessHints({
        onboarding_step: 'done',
        missing: [
          newerKey as OwnProfile['missing'][number],
          'more_photos',
          'id_verified',
          'photo_verified',
        ],
      }).map((hint) => hint.to),
    ).toEqual(['/me/photos', '/me/verification/identity', '/me/verification/selfie'])
    expect(completenessHints({ onboarding_step: 'family', missing: ['core'] })).toEqual([
      { key: 'core', to: '/onboarding/family' },
    ])
  })

  it('counts must-haves, empty sections and excerpts', () => {
    expect(
      mustHaveCount({
        age_importance: 'must',
        religion_importance: 'must',
        sect_importance: 'high',
      } as never),
    ).toBe(2)
    expect(sectionIsEmpty({ a: null, b: [] })).toBe(true)
    expect(sectionIsEmpty({ a: null, b: ['x'] })).toBe(false)
    expect(excerpt('a'.repeat(130))).toBe(`${'a'.repeat(120)}...`)
    expect(excerpt('short')).toBe('short')
  })
})

describe('MeProfileScreen', () => {
  it('shows the skeleton, then the header, code and section cards', async () => {
    server.use(
      http.get(apiUrl('/v1/me/profile'), async () => {
        await delay(100)
        return undefined
      }),
    )
    renderProfile()
    expect(await screen.findByText('Loading your profile')).toBeInTheDocument()
    expect(await screen.findByText('Ayesha Khan')).toBeInTheDocument()
    expect(screen.getByText('27 years, Lahore')).toBeInTheDocument()
    expect(screen.getByText('KR7Q2M')).toBeInTheDocument()
    expect(
      screen.getByText('Your profile code. Give it to a family so they can find this profile.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit: Basics' })).toHaveAttribute(
      'href',
      '/me/edit/basics',
    )
    expect(screen.getByRole('link', { name: 'Edit: Education and career' })).toHaveAttribute(
      'href',
      '/me/edit/education-career',
    )
    expect(screen.getByRole('link', { name: 'Edit: Profile managed by' })).toHaveAttribute(
      'href',
      '/me/edit/account-for',
    )
    expect(screen.getByRole('link', { name: 'Manage: Photos' })).toHaveAttribute(
      'href',
      '/me/photos',
    )
    expect(screen.getByRole('link', { name: 'Add: Family' })).toHaveAttribute(
      'href',
      '/me/edit/family',
    )
    expect(screen.getByRole('link', { name: 'Add: Contact details' })).toHaveAttribute(
      'href',
      '/settings/contacts',
    )
    expect(screen.getByRole('link', { name: 'Open: Verification' })).toHaveAttribute(
      'href',
      '/me/verification',
    )
    expect(screen.getByRole('link', { name: 'Open: Privacy' })).toHaveAttribute(
      'href',
      '/settings/privacy',
    )
    expect(await screen.findByText('Age 25 to 32')).toBeInTheDocument()
    expect(screen.getByText('Female, 27 years')).toBeInTheDocument()
    expect(screen.getByText('Islam, Sunni')).toBeInTheDocument()
    expect(screen.getByText('Lahore, Punjab, Pakistan')).toBeInTheDocument()
  })

  it('never shows the contact values, only that they were added', async () => {
    db.ownProfile.contacts = { ...db.ownProfile.contacts, phone_e164: '+923001234567' }
    renderProfile()
    expect(await screen.findByText('Added')).toBeInTheDocument()
    expect(screen.queryByText(/300/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit: Contact details' })).toBeInTheDocument()
  })

  it('copies the profile link', async () => {
    const user = userEvent.setup()
    renderProfile()
    await user.click(await screen.findByRole('button', { name: 'Copy the link to profile KR7Q2M' }))
    expect(await screen.findByText('Profile link copied.')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('http://localhost:3000/p/KR7Q2M')
  })

  it('shows the completeness ring with the first three hints', async () => {
    db.ownProfile.completeness = 32
    db.ownProfile.missing = ['photo', 'about_me', 'family', 'income']
    renderProfile()
    expect(await screen.findByText('The profile is 32% complete')).toBeInTheDocument()
    const hints = screen.getByRole('navigation', { name: 'What to add next' })
    expect(
      within(hints)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/me/photos', '/me/edit/lifestyle', '/me/edit/family'])
    expect(within(hints).getByRole('link', { name: 'Add a photo' })).toBeInTheDocument()
  })

  it('hides the completeness card at 100', async () => {
    db.ownProfile.completeness = 100
    renderProfile()
    await screen.findByText('Ayesha Khan')
    expect(screen.queryByText(/% complete/)).not.toBeInTheDocument()
  })

  it('shows the Me menu with the photo request badge and the gear icon', async () => {
    renderProfile()
    const menu = await screen.findByRole('navigation', { name: 'More' })
    expect(within(menu).getByRole('link', { name: 'Shortlist' })).toHaveAttribute(
      'href',
      '/shortlist',
    )
    expect(within(menu).getByRole('link', { name: 'Who viewed me' })).toHaveAttribute(
      'href',
      '/visitors',
    )
    expect(within(menu).getByRole('link', { name: 'Photo requests, 2 new' })).toHaveAttribute(
      'href',
      '/photo-requests',
    )
    expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    )
    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(2)
  })

  it('keeps only Settings in the menu while the profile is in review', async () => {
    setStatus('pending_review')
    renderProfile(makeMe({ gate: 'pending_review', profile: { status: 'pending_review' } }))
    expect(
      await screen.findByText(
        'The profile is being reviewed. This usually takes less than a day. You can keep improving it in the meantime.',
      ),
    ).toBeInTheDocument()
    const menu = screen.getByRole('navigation', { name: 'More' })
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Settings'])
  })

  it('resumes a paused profile from the banner', async () => {
    const user = userEvent.setup()
    setStatus('paused')
    renderProfile(makeMe({ profile: { status: 'paused' } }))
    expect(
      await screen.findByText(
        'The profile is paused. Members cannot find it. Your connections can still chat with you.',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText('The profile is live again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull())
  })

  it('links a closed profile to the account settings to reopen it', async () => {
    setStatus('closed')
    renderProfile(makeMe({ profile: { status: 'closed' } }))
    expect(
      await screen.findByText(
        'The profile is closed. Members cannot find it and new messages cannot be sent.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reopen' })).toHaveAttribute(
      'href',
      '/settings/account',
    )
  })

  it('resubmits a profile with requested changes and routes by the new gate', async () => {
    const user = userEvent.setup()
    setStatus('changes_requested', 'Please add a clearer description in About me.')
    const { router } = renderProfile(
      makeMe({ gate: 'changes_requested', profile: { status: 'changes_requested' } }),
    )
    expect(
      await screen.findByText('Changes are needed before the profile can go live:'),
    ).toBeInTheDocument()
    expect(screen.getByText('Please add a clearer description in About me.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resubmit for review' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/account/review'))
    expect(db.me.profile.status).toBe('pending_review')
  })

  it('labels moderated texts and links to fix them', async () => {
    db.ownProfile.text_status = {
      about_me: 'rejected',
      about_family: 'pending',
      partner_notes: 'approved',
    }
    renderProfile()
    expect(
      await screen.findAllByText(
        'Not approved. This text is hidden from other members. Please edit it.',
      ),
    ).not.toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Edit About me' })).toHaveAttribute(
      'href',
      '/me/edit/lifestyle',
    )
    expect(screen.getByRole('link', { name: 'Edit About the family' })).toHaveAttribute(
      'href',
      '/me/edit/family',
    )
    expect(
      screen.getAllByText('Under review. Other members will see this text once it is approved.'),
    ).not.toHaveLength(0)
    expect(screen.queryByRole('link', { name: 'Edit Partner notes' })).not.toBeInTheDocument()
  })

  it('shows the main photo in the header', async () => {
    db.ownPhotos = [makeOwnPhoto({ id: 'main', is_primary: true })]
    renderProfile()
    const link = await screen.findByRole('link', { name: 'Manage photos' })
    expect(link).toHaveAttribute('href', '/me/photos')
    expect(link.querySelector('img')).not.toBeNull()
  })

  it('shows the screen error when the profile cannot be loaded', async () => {
    server.use(http.get(apiUrl('/v1/me/profile'), () => apiError(500, 'internal_error', 'Boom')))
    renderProfile()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('previews the profile as a member and as a connection', async () => {
    const user = userEvent.setup()
    const tiers: string[] = []
    server.use(
      http.get(apiUrl('/v1/me/profile/preview'), ({ request }) => {
        tiers.push(new URL(request.url).searchParams.get('as') ?? '')
        return undefined
      }),
    )
    db.ownProfile.text_status = { ...db.ownProfile.text_status, about_me: 'pending' }
    renderProfile()
    await user.click(await screen.findByRole('button', { name: 'See how others see this profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Preview' })
    expect(within(dialog).getByText('Preview as: A member')).toBeInTheDocument()
    expect(
      await within(dialog).findByText(
        'This is a preview. Other members see the buttons to send an interest here.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('About me: hidden until approved')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'A connection' }))
    expect(await within(dialog).findByText('Preview as: A connection')).toBeInTheDocument()
    await waitFor(() => expect(tiers).toEqual(['member', 'connection']))
  })
})
