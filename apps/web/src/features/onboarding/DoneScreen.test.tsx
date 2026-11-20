import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { db, resetDb } from '~/mocks/db'
import { makeOwnPhoto } from '~/mocks/factories'
import { currentMe } from '~/mocks/handlers/account'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { DoneScreen } from './DoneScreen'

function setup(prepare?: () => void) {
  resetDb('active')
  prepare?.()
  return {
    ...renderWithProviders(() => <DoneScreen />, {
      path: '/onboarding/done',
      me: structuredClone(currentMe()),
    }),
    user: userEvent.setup(),
  }
}

describe('ONB-DONE', () => {
  it('offers a photo, verification and privacy when they are missing', async () => {
    setup(() => {
      db.ownPhotos = [makeOwnPhoto({ status: 'rejected' })]
    })
    expect(
      await screen.findByRole('heading', { name: 'Mubarak! The profile is live.' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Add a photo/ })).toHaveAttribute(
      'href',
      '/me/photos',
    )
    expect(screen.getByRole('link', { name: /Verify your identity/ })).toHaveAttribute(
      'href',
      '/me/verification',
    )
    expect(screen.getByRole('link', { name: /Review your privacy/ })).toHaveAttribute(
      'href',
      '/settings/privacy',
    )
  })

  it('hides the photo card with a usable photo and the verify card while a request is pending', async () => {
    setup(() => {
      db.ownProfile.verification = {
        ...db.ownProfile.verification,
        pending: { id_document: true, selfie: false },
      }
    })
    expect(await screen.findByRole('link', { name: /Review your privacy/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Add a photo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Verify your identity/ })).not.toBeInTheDocument()
  })

  it('"See my matches" opens the home screen, replacing the history entry', async () => {
    const { user, router } = setup()
    await user.click(await screen.findByRole('button', { name: 'See my matches' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    expect(router.history.length).toBe(1)
  })

  it('shows the error state when the profile cannot be loaded', async () => {
    server.use(http.get(apiUrl('/v1/me/profile'), () => apiError(500, 'internal_error', 'x')))
    setup()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })
})
