import { useInfiniteQuery } from '@tanstack/react-query'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '~/lib/api'
import type { Page } from '~/lib/api-types'
import { nextCursor } from '~/lib/query'
import { renderWithProviders } from '~/test/render'
import { EmptyState } from './EmptyState'
import { InfiniteList } from './InfiniteList'

type Row = { id: string; name: string }

/** Pages of two rows; `pages` of them in total. */
function fakePage(cursor: string | undefined, pages: number): Page<Row> {
  const index = Number(cursor ?? 0)
  return {
    items: [0, 1].map((n) => ({ id: `${index}-${n}`, name: `Row ${index * 2 + n + 1}` })),
    next_cursor: index + 1 < pages ? String(index + 1) : null,
  }
}

function List({ fetchPage }: { fetchPage: (cursor: string | undefined) => Promise<Page<Row>> }) {
  const query = useInfiniteQuery({
    queryKey: ['test-list'],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  })
  return (
    <InfiniteList
      query={query}
      getKey={(row) => row.id}
      renderItem={(row) => <span>{row.name}</span>}
      empty={<EmptyState title="Nothing here yet" text="Rows appear here." />}
    />
  )
}

const originalObserver = globalThis.IntersectionObserver

afterEach(() => {
  globalThis.IntersectionObserver = originalObserver
})

describe('InfiniteList', () => {
  it('shows the first page, then loads the next one with "Load more" until the end', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => <List fetchPage={async (cursor) => fakePage(cursor, 2)} />)

    expect(await screen.findByText('Row 1')).toBeInTheDocument()
    expect(screen.getByText('Row 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('Row 3')).toBeInTheDocument()
    expect(screen.getByText('Row 4')).toBeInTheDocument()
    // next_cursor is null: nothing more is offered.
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('loads the next page when the sentinel scrolls into view', async () => {
    let trigger: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null
    globalThis.IntersectionObserver = class {
      constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
        trigger = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    } as unknown as typeof IntersectionObserver

    renderWithProviders(() => <List fetchPage={async (cursor) => fakePage(cursor, 3)} />)
    expect(await screen.findByText('Row 1')).toBeInTheDocument()

    act(() => trigger?.([{ isIntersecting: true }]))

    expect(await screen.findByText('Row 3')).toBeInTheDocument()
  })

  it('shows the skeleton first and the empty slot when there are no items', async () => {
    let resolve: (page: Page<Row>) => void = () => {}
    renderWithProviders(() => (
      <List fetchPage={() => new Promise<Page<Row>>((done) => (resolve = done))} />
    ))

    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')
    await act(async () => resolve({ items: [], next_cursor: null }))

    expect(await screen.findByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument()
  })

  it('shows the error state with the reference and retries', async () => {
    const fetchPage = vi
      .fn<(cursor: string | undefined) => Promise<Page<Row>>>()
      .mockRejectedValueOnce(
        new ApiError({ status: 500, code: 'internal_error', message: 'x', requestId: 'req-42' }),
      )
      .mockImplementation(async (cursor) => fakePage(cursor, 1))
    const user = userEvent.setup()
    renderWithProviders(() => <List fetchPage={fetchPage} />)

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Reference: req-42')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Row 1')).toBeInTheDocument()
  })
})
