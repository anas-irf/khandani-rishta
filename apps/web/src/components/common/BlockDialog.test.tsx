import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileDetail } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { db } from '~/mocks/db'
import { makeMe } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { BlockDialog } from './BlockDialog'

const PROFILE_ID = '10000000-0000-4000-8000-000000000010'

function Harness({ onBlocked }: { onBlocked: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <BlockDialog
      open={open}
      onOpenChange={setOpen}
      profileId={PROFILE_ID}
      name="Hassan N."
      onBlocked={onBlocked}
    />
  )
}

describe('BlockDialog', () => {
  it('confirms with the copy of 16 section 6.7, blocks and calls onBlocked', async () => {
    let calledWith: string | null = null
    server.use(
      http.put(apiUrl('/v1/blocks/:profileId'), ({ params }) => {
        calledWith = String(params.profileId)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const onBlocked = vi.fn()
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(() => <Harness onBlocked={onBlocked} />, {
      me: makeMe(),
    })
    const profile = db.profiles.get(PROFILE_ID) as ProfileDetail
    queryClient.setQueryData(qk.profile(PROFILE_ID), profile)

    const dialog = await screen.findByRole('alertdialog', { name: 'Block Hassan N.?' })
    expect(dialog).toHaveTextContent(
      'You will no longer see each other anywhere. Any connection and chat between you ends.',
    )
    await user.click(screen.getByRole('button', { name: 'Block' }))

    await waitFor(() => expect(onBlocked).toHaveBeenCalledTimes(1))
    expect(calledWith).toBe(PROFILE_ID)
    expect(await screen.findByText('Blocked.')).toBeInTheDocument()
    // 17 section 6.3: the profile is dropped from the cache.
    expect(queryClient.getQueryData(qk.profile(PROFILE_ID))).toBeUndefined()
  })

  it('stays open with a toast when the block fails', async () => {
    server.use(
      http.put(apiUrl('/v1/blocks/:profileId'), () => apiError(500, 'internal_error', 'Boom')),
    )
    const onBlocked = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(() => <Harness onBlocked={onBlocked} />, { me: makeMe() })

    await user.click(await screen.findByRole('button', { name: 'Block' }))

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog', { name: 'Block Hassan N.?' })).toBeInTheDocument()
    expect(onBlocked).not.toHaveBeenCalled()
  })
})
