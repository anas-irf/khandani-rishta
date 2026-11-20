import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
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
  reasons: ['same_sect', 'some_future_code', 'age_fits', 'verified', 'new_member'],
  relation: { interest_direction: 'received', interest_status: 'pending' },
})

function renderCard(ui: () => ReactNode) {
  return renderWithProviders(ui, { me: makeMe() })
}

describe('ProfileCard (full)', () => {
  it('shows every element of 16 section 1.5 and links to the profile', async () => {
    renderCard(() => <ProfileCard card={fullCard} viewerCountryCode="PK" />)

    const link = await screen.findByRole('link', { name: 'Ayesha K., 26' })
    expect(link).toHaveAttribute('href', `/profiles/${fullCard.id}`)
    expect(screen.getByRole('img', { name: 'Photo of Ayesha K.' })).toHaveAttribute(
      'src',
      'https://r2.test/m.jpg',
    )
    expect(screen.getByText('3 photos')).toBeInTheDocument()

    const badges = within(screen.getByRole('list', { name: 'Badges' })).getAllByRole('img')
    expect(badges.map((badge) => badge.getAttribute('aria-label'))).toEqual([
      'ID verified',
      'Phone verified',
      'New',
    ])

    expect(screen.getByText('Dubai, United Arab Emirates')).toBeInTheDocument()
    expect(screen.getByText("Master's (MA, MSc, MBA)")).toBeInTheDocument()
    expect(screen.getByText('Software and IT')).toBeInTheDocument()
    expect(screen.getByText('5 ft 4 in (163 cm) · Divorced · Sunni · Arain')).toBeInTheDocument()
    expect(screen.getByText('Profile managed by Parent')).toBeInTheDocument()
    expect(screen.getByText('87% match')).toBeInTheDocument()

    const chips = within(screen.getByRole('list', { name: 'Why this profile is suggested' }))
    expect(chips.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Same sect',
      'Age suits you both',
      'Verified profile',
    ])
    expect(screen.getByText('Active this week')).toBeInTheDocument()
    expect(screen.getByText('Interested in you')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Ayesha K. to shortlist' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('keeps the heart and actions out of the link', async () => {
    renderCard(() => (
      <ProfileCard card={fullCard} actions={<button type="button">Withdraw</button>} />
    ))

    const link = await screen.findByRole('link', { name: 'Ayesha K., 26' })
    expect(within(link).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
  })

  it('shows a blurred photo with the lock', async () => {
    const card = makeProfileCard({ photo: makePhotoView({ is_blurred: true }) })
    renderCard(() => <ProfileCard card={card} />)

    expect(await screen.findByText('Photo is private')).toBeInTheDocument()
  })

  it('shows the silhouette of the profile gender when there is no photo', async () => {
    const card = makeProfileCard({ gender: 'female', photo: null, photo_count: 0 })
    renderCard(() => <ProfileCard card={card} />)

    const placeholder = await screen.findByRole('img', { name: 'No photo added yet' })
    expect(placeholder).toHaveAttribute('data-silhouette', 'female')
    expect(screen.queryByText(/photos$/)).not.toBeInTheDocument()
  })

  it('leaves out hidden and unstated values: no caste, no sect, no activity, no score', async () => {
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

    const facts = await screen.findByText('5 ft 10 in (178 cm) · Islam')
    expect(facts).toBeInTheDocument()
    expect(screen.getByText('Government job')).toBeInTheDocument()
    expect(screen.queryByText(/% match/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Profile managed by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Active/)).not.toBeInTheDocument()
    // The city alone when the country is the viewer's own.
    expect(screen.getByText('Lahore')).toBeInTheDocument()
  })
})

describe('ProfileCard (compact)', () => {
  it('shows the compact subset: thumb, one work line, percentage only, no heart', async () => {
    renderCard(() => <ProfileCard card={fullCard} size="compact" viewerCountryCode="PK" />)

    expect(await screen.findByRole('link', { name: 'Ayesha K., 26' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Photo of Ayesha K.' })).toHaveAttribute(
      'src',
      'https://r2.test/t.jpg',
    )
    expect(screen.getByText("Master's (MA, MSc, MBA) · Software and IT")).toBeInTheDocument()
    expect(screen.getByText('87% match')).toBeInTheDocument()
    expect(screen.getByText('Interested in you')).toBeInTheDocument()

    expect(screen.queryByText('3 photos')).not.toBeInTheDocument()
    expect(screen.queryByText('Same sect')).not.toBeInTheDocument()
    expect(screen.queryByText(/Divorced/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Profile managed by/)).not.toBeInTheDocument()
    expect(screen.queryByText('Active this week')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /shortlist/ })).not.toBeInTheDocument()
  })
})

describe('ProfileCard shortlist heart', () => {
  it('fills at once and reverts with a toast when the request fails', async () => {
    server.use(
      http.put(apiUrl('/v1/shortlist/:profileId'), async () => {
        await delay(50)
        return apiError(500, 'internal_error', 'Boom')
      }),
    )
    const user = userEvent.setup()
    renderCard(() => <ProfileCard card={fullCard} />)

    const heart = await screen.findByRole('button', { name: 'Add Ayesha K. to shortlist' })
    await user.click(heart)

    expect(screen.getByRole('button', { name: 'Remove Ayesha K. from shortlist' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Ayesha K. to shortlist' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    )
  })
})
