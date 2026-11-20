import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as mswHttp } from 'msw'
import { useEffect, useMemo, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { http, isApiError } from '~/lib/api'
import { apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithRouter } from '~/test/render'
import { TestSessionProvider } from './session'

/** Sends one request when it mounts, as `useMe` does inside AuthGate. */
function FirstRequest() {
  const [result, setResult] = useState('pending')
  useEffect(() => {
    http.get('/v1/me').then(
      () => setResult('sent with a token'),
      (error: unknown) => setResult(isApiError(error) ? error.code : 'failed'),
    )
  }, [])
  return <p>{result}</p>
}

function Harness() {
  const [token, setToken] = useState<string | null>(null)
  const session = useMemo(() => ({ getToken: async () => token }), [token])
  return (
    <TestSessionProvider session={session}>
      {token ? (
        <FirstRequest />
      ) : (
        <button type="button" onClick={() => setToken('fresh-token')}>
          Sign in
        </button>
      )}
    </TestSessionProvider>
  )
}

describe('token getter registration (17 section 6.1)', () => {
  it('gives the first request of a new session its token', async () => {
    let auth: string | null = null
    server.use(
      mswHttp.get(apiUrl('/v1/me'), ({ request }) => {
        auth = request.headers.get('Authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    const user = userEvent.setup()
    renderWithRouter(() => <Harness />)

    // Signing in changes the session and mounts a component that sends a request in the same
    // commit; React runs the provider's effect cleanup before that child's effect.
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('sent with a token')).toBeInTheDocument()
    expect(auth).toBe('Bearer fresh-token')
  })
})
