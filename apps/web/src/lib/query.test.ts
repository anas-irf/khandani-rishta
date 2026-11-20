import { describe, expect, it, vi } from 'vitest'
import { makeMe } from '~/mocks/factories'
import { ApiError } from './api'
import { closeLimitDialog, limitDialogStore } from './dialogs'
import {
  createQueryClient,
  errorMessage,
  handleApiError,
  qk,
  removeFromPages,
  updateInPages,
} from './query'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { toast } = await import('sonner')

function apiError(code: string, details: Record<string, unknown> = {}, status = 409) {
  return new ApiError({ status, code, message: `api ${code}`, details, requestId: 'r-1' })
}

describe('handleApiError (17 section 6.4)', () => {
  it('refetches Me on gate codes without a toast', async () => {
    const client = createQueryClient()
    client.setQueryData(qk.me(), makeMe())
    client.setQueryData(qk.ownProfile(), { id: 'x' })
    handleApiError(apiError('profile_not_active', {}, 403), { kind: 'mutation' })
    expect(client.getQueryState(qk.me())?.isInvalidated).toBe(true)
    // Only Me itself, not every key that starts with `me`.
    expect(client.getQueryState(qk.ownProfile())?.isInvalidated).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens the limit dialog with the action text', () => {
    handleApiError(apiError('limit_reached', { limit: 10, used: 10 }, 429), {
      kind: 'mutation',
      limitText: 'discovery:limits.interests',
    })
    expect(limitDialogStore.get()).toEqual({
      textKey: 'discovery:limits.interests',
      details: { limit: 10, used: 10 },
    })
    closeLimitDialog()
  })

  it('toasts rate limits with the seconds to wait', () => {
    handleApiError(apiError('rate_limited', { retry_after_seconds: 12 }, 429), { kind: 'mutation' })
    expect(toast.error).toHaveBeenLastCalledWith(
      'You are going a little fast. Please try again in 12 seconds.',
      expect.anything(),
    )
  })

  it('toasts unexpected errors with the request id', () => {
    handleApiError(apiError('internal_error', {}, 500), { kind: 'mutation' })
    expect(toast.error).toHaveBeenLastCalledWith('Something went wrong. Please try again.', {
      description: 'Reference: r-1',
    })
  })

  it('stays silent for codes the mutation handles and for validation errors', () => {
    vi.mocked(toast.error).mockClear()
    handleApiError(apiError('not_permitted_by_member'), {
      kind: 'mutation',
      handles: ['not_permitted_by_member'],
    })
    handleApiError(apiError('validation_failed', {}, 400), { kind: 'mutation' })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('never toasts for failed screen loads (16 rule G3)', () => {
    vi.mocked(toast.error).mockClear()
    handleApiError(apiError('internal_error', {}, 500), { kind: 'query' })
    handleApiError(apiError('not_found', {}, 404), { kind: 'query' })
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('errorMessage', () => {
  it('translates by code, with the API message as fallback', () => {
    expect(errorMessage(apiError('connection_ended'))).toBe('This connection has ended.')
    expect(errorMessage(apiError('something_new'))).toBe('api something_new')
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.')
  })

  it('formats the cooldown date', () => {
    expect(errorMessage(apiError('cooldown_active', { retry_after_date: '2026-12-01' }))).toBe(
      'You can try this again on 1 Dec 2026.',
    )
  })
})

describe('retry policy', () => {
  it('retries network and server errors only', () => {
    const client = createQueryClient()
    const retry = client.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean
    expect(retry(0, apiError('network_error', {}, 0))).toBe(true)
    expect(retry(0, apiError('internal_error', {}, 500))).toBe(true)
    expect(retry(2, apiError('internal_error', {}, 500))).toBe(false)
    expect(retry(0, apiError('not_found', {}, 404))).toBe(false)
    expect(retry(0, apiError('validation_failed', {}, 400))).toBe(false)
  })
})

describe('infinite page helpers', () => {
  it('removes and updates items in every cached page', () => {
    const client = createQueryClient()
    client.setQueryData(qk.shortlist(), {
      pages: [
        {
          items: [
            { id: 'a', n: 1 },
            { id: 'b', n: 2 },
          ],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    })
    removeFromPages<{ id: string }>(client, qk.shortlist(), (item) => item.id === 'a')
    updateInPages<{ id: string; n: number }>(client, qk.shortlist(), (item) => ({ ...item, n: 9 }))
    expect(client.getQueryData(qk.shortlist())).toEqual({
      pages: [{ items: [{ id: 'b', n: 9 }], next_cursor: null }],
      pageParams: [undefined],
    })
  })
})
