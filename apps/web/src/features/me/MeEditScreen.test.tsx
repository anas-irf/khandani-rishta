import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { makeMe } from '~/mocks/factories'
import { ownProfileView } from '~/mocks/handlers/profile'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { MeEditScreen, sectionFromSlug } from './MeEditScreen'
import { MePreferencesScreen } from './MePreferencesScreen'

function renderEdit(slug: string) {
  return renderWithProviders(() => <MeEditScreen section={slug} />, {
    path: `/me/edit/${slug}`,
    me: makeMe(),
  })
}

describe('sectionFromSlug', () => {
  it('maps the URL slugs of 17 section 3.3 to section keys', () => {
    expect(sectionFromSlug('account-for')).toBe('account_for')
    expect(sectionFromSlug('education-career')).toBe('education_career')
    expect(sectionFromSlug('lifestyle')).toBe('lifestyle')
    expect(sectionFromSlug('contacts')).toBeNull()
    expect(sectionFromSlug('education_career')).toBe('education_career')
    expect(sectionFromSlug('unknown')).toBeNull()
    expect(sectionFromSlug(undefined)).toBeNull()
  })
})

describe('MeEditScreen', () => {
  it('shows Not Found for an unknown section', async () => {
    renderEdit('preferences')
    expect(await screen.findByText('This part of the profile does not exist.')).toBeInTheDocument()
  })

  it('saves the section, shows "Saved" and returns to the profile', async () => {
    const user = userEvent.setup()
    const { router } = renderEdit('basics')
    expect(await screen.findByRole('heading', { name: 'Basics' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('offers to review the preferences after the religion changed', async () => {
    const user = userEvent.setup()
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/community'), () => {
        const profile = ownProfileView()
        return HttpResponse.json({
          ...profile,
          community: { ...profile.community, religion_code: 'christianity', sect_code: null },
        })
      }),
    )
    const { router } = renderEdit('community')
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(
      await screen.findByRole('alertdialog', {
        name: 'You changed the religion. Your partner preferences still list the previous one. Review them now?',
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/preferences'))
  })

  it('goes to the profile when the review is left for later', async () => {
    const user = userEvent.setup()
    server.use(
      http.put(apiUrl('/v1/me/profile/sections/location'), () => {
        const profile = ownProfileView()
        return HttpResponse.json({
          ...profile,
          location: { ...profile.location, country_code: 'AE' },
        })
      }),
    )
    const { router } = renderEdit('location')
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(
      await screen.findByRole('alertdialog', {
        name: 'You changed the country. Your partner preferences still list the previous one. Review them now?',
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Later' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })

  it('asks before discarding unsaved input', async () => {
    const user = userEvent.setup()
    const { router } = renderEdit('basics')
    const firstName = await screen.findByDisplayValue('Ayesha')
    await user.type(firstName, 'h')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/me/edit/basics')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })
})

describe('MePreferencesScreen', () => {
  it('shows the must-have note, saves and goes back', async () => {
    const user = userEvent.setup()
    const { router } = renderWithProviders(() => <MePreferencesScreen />, {
      path: '/me/preferences',
      me: makeMe(),
    })
    expect(
      await screen.findByText(
        'Must-haves hide everyone who does not fit. Everything else only changes the order of your matches.',
      ),
    ).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Preferences saved. Your matches are being updated.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })
})
