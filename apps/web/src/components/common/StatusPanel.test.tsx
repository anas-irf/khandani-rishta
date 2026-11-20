import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Me } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { makeMe } from '~/mocks/factories'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { StatusPanel } from './StatusPanel'

describe('StatusPanel', () => {
  it('paused: explains, and "Resume the profile" resumes and replaces Me', async () => {
    let resumed = false
    server.use(
      http.post(apiUrl('/v1/me/profile/resume'), () => {
        resumed = true
        return HttpResponse.json(makeMe({ profile: { status: 'active' } }))
      }),
    )
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(() => <StatusPanel status="paused" />, {
      me: makeMe({ profile: { status: 'paused' } }),
    })

    expect(
      await screen.findByRole('heading', { name: 'The profile is paused' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Resume it to see matches, search and send interests. Your chats are still available.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume the profile' }))

    await waitFor(() =>
      expect(queryClient.getQueryData<Me>(qk.me())?.profile.status).toBe('active'),
    )
    expect(resumed).toBe(true)
  })

  it('closed: explains and links to the account settings', async () => {
    renderWithProviders(() => <StatusPanel status="closed" />, {
      me: makeMe({ profile: { status: 'closed' } }),
    })

    expect(
      await screen.findByRole('heading', { name: 'The profile is closed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Reopen it to see matches and answer interests. You can still read your chats.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reopen the profile' })).toHaveAttribute(
      'href',
      '/settings/account',
    )
  })
})
