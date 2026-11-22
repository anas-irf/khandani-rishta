import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { Me } from '~/lib/api-types'
import { makeMe, makePhotoView, makeProfileCard } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ProfileCard } from './ProfileCard'

const fullCard = makeProfileCard({
  id: '10000000-0000-4000-8000-000000000010',
  display_name: 'Ayesha K.',
  age: 26,
  gender: 'female',
  managed_by: 'parent',
  height_cm: 163,
  marital_status: 'divorced',
  sect_code: 'sunni',
  caste_label: 'Arain',
  city_name: 'Dubai',
  country_code: 'AE',
  education_level_code: 'masters',
  employment_type: 'private_job',
  profession_code: 'software_it',
  photo: makePhotoView({ medium_url: 'https://r2.test/m.jpg', thumb_url: 'https://r2.test/t.jpg' }),
  photo_count: 3,
  badges: ['new', 'phone_verified', 'id_verified'],
  last_active: 'this_week',
  compat: 87,
  reasons: ['some_future_code', 'verified', 'same_sect', 'new_member', 'age_fits'],
  relation: { interest_direction: 'received', interest_status: 'pending' },
})

/** The age is joined to the comma with a no-break space, so it never starts a line. */
const NAME = /^Ayesha K\.,\s26$/

function renderCard(ui: () => ReactNode, me: Me = makeMe({ profile: { managed_by: 'self' } })) {
  return renderWithProviders(ui, { me })
}

function photoElement() {
  return document.querySelector('img[data-member-photo]')
}

function matchPill() {
  return document.querySelector('[data-slot="compat-badge"]')
}

describe('ProfileCard (full)', () => {
  it('shows every element of 16 section 1.5 and links to the profile', async () => {
    renderCard(() => <ProfileCard card={fullCard} viewerCountryCode="PK" />)

    const link = await screen.findByRole('link', { name: NAME })
    expect(link).toHaveAttribute('href', `/profiles/${fullCard.id}`)
    expect(screen.getByRole('article', { name: NAME })).toContainElement(link)

    // The photo is decoration: its state is read out after the name (DESIGN.md 8.3).
    expect(photoElement()).toHaveAttribute('src', 'https://r2.test/m.jpg')
    expect(photoElement()).toHaveAttribute('alt', '')
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('New, 3 photos')
    expect(screen.getByText('3 photos')).toBeInTheDocument()
    expect(document.querySelector('[data-badge="new"]')).toHaveTextContent('New')

    const badges = within(screen.getByRole('list', { name: 'Badges' })).getAllByRole('listitem')
    expect(badges.map((badge) => badge.textContent)).toEqual(['ID verified', 'Phone verified'])

    expect(
      screen.getByText('Dubai, United Arab Emirates, Software and IT, Divorced'),
    ).toBeInTheDocument()
    expect(screen.getByText('Profile managed by Parent')).toBeInTheDocument()
    expect(matchPill()).toHaveTextContent('87% match')

    const reasons = within(screen.getByRole('list', { name: 'Why this match' }))
    expect(reasons.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Same sect',
      'Age suits you both',
    ])
    expect(screen.getByText('Interested in you')).toBeInTheDocument()

    const shortlist = screen.getByRole('button', { name: 'Shortlist' })
    expect(shortlist).toHaveAttribute('aria-pressed', 'false')
    expect(shortlist).toHaveAttribute('aria-describedby', link.id)
  })

  it('leaves to the profile what does not help decide whether to open it', async () => {
    renderCard(() => <ProfileCard card={fullCard} viewerCountryCode="PK" />)

    const card = await screen.findByRole('article', { name: NAME })
    for (const detail of [/Master's/, /5 ft 4 in/, /Sunni/, /Islam/, /Arain/, /Active this week/]) {
      expect(card).not.toHaveTextContent(detail)
    }
  })

  it('ignores the reason codes that left the list of 10 section 7', async () => {
    const card = makeProfileCard({ reasons: ['verified', 'new_member'] })
    renderCard(() => <ProfileCard card={card} />)

    await screen.findByRole('article')
    expect(screen.queryByRole('list', { name: 'Why this match' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Verified profile|New member/)).not.toBeInTheDocument()
  })

  it('talks about the candidate of a managed profile in the third person', async () => {
    const card = makeProfileCard({
      reasons: ['meets_your_must_haves'],
      relation: { interest_direction: 'received', interest_status: 'pending' },
    })
    renderCard(
      () => <ProfileCard card={card} />,
      makeMe({ profile: { managed_by: 'parent', gender: 'female', first_name: 'Sana' } }),
    )

    expect(await screen.findByText('Meets all her must-haves')).toBeInTheDocument()
    expect(screen.getByText('Interested in her')).toBeInTheDocument()
  })

  it('keeps Shortlist, More and other actions out of the link', async () => {
    renderCard(() => (
      <ProfileCard
        card={fullCard}
        more={<button type="button">More</button>}
        actions={<button type="button">Withdraw</button>}
      />
    ))

    const link = await screen.findByRole('link', { name: NAME })
    expect(screen.getAllByRole('link')).toEqual([link])
    expect(within(link).queryByRole('button')).not.toBeInTheDocument()
    for (const name of ['Shortlist', 'More', 'Withdraw']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('shows a blurred photo with the lock', async () => {
    const card = makeProfileCard({ photo: makePhotoView({ is_blurred: true }) })
    renderCard(() => <ProfileCard card={card} />)

    expect(await screen.findByText('Photo is private')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Photo is private')
  })

  it('shows the monogram and says it when there is no photo', async () => {
    const card = makeProfileCard({
      display_name: 'Ayesha K.',
      gender: 'female',
      photo: null,
      photo_count: 0,
    })
    renderCard(() => <ProfileCard card={card} />)

    expect(await screen.findByText('No photo added yet')).toBeInTheDocument()
    expect(screen.getByText('AK')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('No photo added yet')
    expect(screen.queryByText(/photos$/)).not.toBeInTheDocument()
  })

  it('leaves out hidden and unstated values: no status, no manager, no score', async () => {
    const card = makeProfileCard({
      height_cm: 178,
      marital_status: 'never_married',
      sect_code: null,
      caste_label: null,
      last_active: null,
      compat: null,
      reasons: [],
      managed_by: 'self',
      profession_code: null,
      employment_type: 'government_job',
    })
    renderCard(() => <ProfileCard card={card} />)

    // The city alone when the country is the viewer's own, and nothing after the work.
    expect(await screen.findByText('Lahore, Government job')).toBeInTheDocument()
    expect(matchPill()).toBeNull()
    expect(screen.queryByText(/Never married/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Profile managed by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Active/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Why this match' })).not.toBeInTheDocument()
  })
})

describe('ProfileCard (compact)', () => {
  it('shows the compact subset: thumb, one line, percentage only, no Shortlist', async () => {
    renderCard(() => <ProfileCard card={fullCard} size="compact" viewerCountryCode="PK" />)

    expect(await screen.findByRole('link', { name: NAME })).toBeInTheDocument()
    expect(photoElement()).toHaveAttribute('src', 'https://r2.test/t.jpg')
    expect(screen.getByText('Dubai, United Arab Emirates, Software and IT')).toBeInTheDocument()
    expect(matchPill()).toHaveTextContent('87% match')
    expect(screen.getByText('Interested in you')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Badges' })).toHaveTextContent('ID verified')

    expect(screen.queryByText('3 photos')).not.toBeInTheDocument()
    expect(screen.queryByText('Same sect')).not.toBeInTheDocument()
    expect(screen.queryByText(/Divorced/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Profile managed by/)).not.toBeInTheDocument()
    expect(screen.queryByText('Active this week')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /shortlist/i })).not.toBeInTheDocument()
  })
})

describe('ProfileCard (tile)', () => {
  it('shows the photo with New, the name, the percentage, location and work, and nothing else', async () => {
    renderCard(() => <ProfileCard card={fullCard} size="tile" viewerCountryCode="PK" />)

    expect(await screen.findByRole('link', { name: NAME })).toBeInTheDocument()
    expect(photoElement()).toHaveAttribute('src', 'https://r2.test/m.jpg')
    expect(document.querySelector('[data-badge="new"]')).toHaveTextContent('New')
    expect(matchPill()).toHaveTextContent('87% match')
    expect(screen.getByText('Dubai, United Arab Emirates')).toBeInTheDocument()
    expect(screen.getByText('Software and IT')).toBeInTheDocument()

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Interested in you')).not.toBeInTheDocument()
    expect(screen.queryByText('3 photos')).not.toBeInTheDocument()
  })
})

describe('ProfileCard Shortlist toggle', () => {
  it('fills at once and reverts with a toast when the request fails', async () => {
    server.use(
      http.put(apiUrl('/v1/shortlist/:profileId'), async () => {
        await delay(50)
        return apiError(500, 'internal_error', 'Boom')
      }),
    )
    const user = userEvent.setup()
    renderCard(() => <ProfileCard card={fullCard} />)

    await user.click(await screen.findByRole('button', { name: 'Shortlist' }))

    expect(await screen.findByRole('button', { name: 'Shortlisted' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    expect(await screen.findByText('Could not update the shortlist.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Shortlist' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    )
  })
})
