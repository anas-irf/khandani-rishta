import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelativeTime } from './RelativeTime'

describe('RelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-11-20T10:15:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the relative time with the instant in dateTime and the full date in title', () => {
    render(<RelativeTime value="2026-11-20T10:10:00Z" />)

    const time = screen.getByText('5 min ago')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('dateTime', '2026-11-20T10:10:00.000Z')
    expect(time.getAttribute('title')).toMatch(/2026/)
  })

  it('updates once a minute', () => {
    render(<RelativeTime value="2026-11-20T10:10:00Z" />)
    expect(screen.getByText('5 min ago')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('6 min ago')).toBeInTheDocument()
  })

  it('shows the date after 7 days', () => {
    render(<RelativeTime value="2026-11-01T10:00:00Z" />)
    expect(screen.getByText('1 Nov 2026')).toBeInTheDocument()
  })
})
