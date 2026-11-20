import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeMe } from '~/mocks/factories'
import { renderWithProviders } from '~/test/render'
import { AppShell, showsBottomBar } from './AppShell'

function Shell() {
  return (
    <AppShell>
      <p>screen content</p>
    </AppShell>
  )
}

describe('showsBottomBar (16 section 2.1)', () => {
  it.each([
    ['/home', true],
    ['/search', true],
    ['/interests', true],
    ['/chats', true],
    ['/me', true],
    ['/matches', true],
    ['/shortlist', true],
    ['/visitors', true],
    ['/notifications', true],
    ['/photo-requests', true],
    ['/settings', true],
    ['/settings/', true],
    ['/profiles/abc', false],
    ['/chats/abc', false],
    ['/chats/abc/details', false],
    ['/me/edit/basics', false],
    ['/me/photos', false],
    ['/settings/privacy', false],
  ])('%s -> %s', (path, shown) => {
    expect(showsBottomBar(path)).toBe(shown)
  })
})

describe('AppShell (17 section 9.2)', () => {
  it('shows the five destinations with the badges from Me.counters', async () => {
    const me = makeMe({
      counters: { pending_interests: 3, unread_chats: 120, unread_notifications: 4 },
    })
    renderWithProviders(() => <Shell />, { path: '/home', me })
    expect(await screen.findByText('screen content')).toBeInTheDocument()

    const bottom = screen.getAllByRole('navigation', { name: 'Main' })
    expect(bottom.length).toBeGreaterThan(0)
    const nav = bottom[bottom.length - 1] as HTMLElement
    for (const label of ['Home', 'Search', 'Interests', 'Chats', 'Me']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(within(nav).getByText('3')).toBeInTheDocument()
    expect(within(nav).getByText('99+')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notifications, 4 unread' })).toBeInTheDocument()
  })

  it('shows the attention dot on Me for a profile under 70 percent complete', async () => {
    renderWithProviders(() => <Shell />, {
      path: '/home',
      me: makeMe({ profile: { completeness: 50 } }),
    })
    expect((await screen.findAllByText('Needs attention')).length).toBeGreaterThan(0)
  })

  it('hides the bottom bar on detail screens', async () => {
    renderWithProviders(() => <Shell />, { path: '/profiles/abc', me: makeMe() })
    expect(await screen.findByText('screen content')).toBeInTheDocument()
    // Only the wide top bar's navigation remains (hidden by CSS on narrow screens).
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1)
  })

  it('shows no primary navigation, only a back link, when the gate is not ok', async () => {
    renderWithProviders(() => <Shell />, {
      path: '/me',
      me: makeMe({ gate: 'pending_review' }),
    })
    expect(await screen.findByText('screen content')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/account/review')
  })

  it('lists the secondary destinations and the staff console in the account menu', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => <Shell />, {
      path: '/home',
      me: makeMe({ user: { role: 'moderator' }, counters: { pending_photo_requests: 2 } }),
    })
    await user.click(await screen.findByRole('button', { name: 'Account menu' }))
    for (const item of ['My profile', 'Shortlist', 'Who viewed me', 'Settings', 'Staff console']) {
      expect(await screen.findByRole('menuitem', { name: new RegExp(item) })).toBeInTheDocument()
    }
    expect(screen.getByRole('menuitem', { name: /Photo requests/ })).toHaveTextContent('2')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('asks before signing out (16 rule G8)', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => <Shell />, { path: '/home', me: makeMe() })
    await user.click(await screen.findByRole('button', { name: 'Account menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Sign out of Khandani Rishta?' }),
    ).toBeInTheDocument()
  })
})
