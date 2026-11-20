import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { BlockEntry } from '~/lib/api-types'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { BlockedMembersScreen } from './BlockedMembersScreen'
import { HelpScreen } from './HelpScreen'
import { SettingsHomeScreen } from './SettingsHomeScreen'

function render(ui: ReactNode, path: string, scenario: MockScenario = 'active') {
  resetDb(scenario)
  return renderWithProviders(() => ui, { path, me: structuredClone(db.me) })
}

function block(index: number, overrides: Partial<BlockEntry> = {}): BlockEntry {
  return {
    profile_id: `blocked-${index}`,
    display_name: `Member ${index}`,
    public_code: `KR${index}ABC`,
    created_at: '2026-11-19T10:00:00Z',
    ...overrides,
  }
}

describe('SettingsHomeScreen (SET-HOME)', () => {
  it('lists a row for every settings screen, in the order of 16 section 6.24', async () => {
    render(<SettingsHomeScreen />, '/settings')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Privacy', '/settings/privacy'],
      ['Notifications', '/settings/notifications'],
      ['Contact details', '/settings/contacts'],
      ['Blocked members', '/settings/blocked'],
      ['Account', '/settings/account'],
      ['Help and safety', '/settings/help'],
    ])
  })

  it('hides "Blocked members" when the gate is not ok (it needs an active profile)', async () => {
    render(<SettingsHomeScreen />, '/settings', 'pending_review')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    expect(within(nav).queryByRole('link', { name: 'Blocked members' })).not.toBeInTheDocument()
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
  })

  it('shows "Sign out" and the app version at the bottom, and asks before signing out', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    resetDb('active')
    const user = userEvent.setup()
    const { router } = renderWithProviders(() => <SettingsHomeScreen />, {
      path: '/settings',
      me: structuredClone(db.me),
      session: { signOut },
    })

    expect(await screen.findByText(/^App version: /)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Sign out of Khandani Rishta?')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(signOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sign out' }),
    )
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('BlockedMembersScreen (SET-BLOCKED)', () => {
  it('shows skeleton rows while loading', async () => {
    server.use(
      http.get(apiUrl('/v1/blocks'), async () => {
        await delay(150)
      }),
    )
    const { container } = render(<BlockedMembersScreen />, '/settings/blocked')
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(await screen.findByText('You have not blocked anyone.')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    render(<BlockedMembersScreen />, '/settings/blocked')
    expect(await screen.findByText('You have not blocked anyone.')).toBeInTheDocument()
    expect(
      screen.getByText('Blocked members cannot see you, and you cannot see them.'),
    ).toBeInTheDocument()
  })

  it('shows the error state and retries', async () => {
    let failing = true
    server.use(
      http.get(apiUrl('/v1/blocks'), () => {
        if (failing) return apiError(500, 'internal_error', 'Boom')
        return undefined
      }),
    )
    const user = userEvent.setup()
    render(<BlockedMembersScreen />, '/settings/blocked')

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('You have not blocked anyone.')).toBeInTheDocument()
  })

  it('lists name, code and when it was blocked, without a photo or a link to the profile', async () => {
    resetDb('active')
    db.blocks = [block(1)]
    renderWithProviders(() => <BlockedMembersScreen />, {
      path: '/settings/blocked',
      me: structuredClone(db.me),
    })

    const list = await screen.findByRole('list', { name: 'Blocked members' })
    const row = within(list).getByRole('listitem')
    expect(within(row).getByText('Member 1')).toBeInTheDocument()
    expect(within(row).getByText('Profile code KR1ABC')).toBeInTheDocument()
    expect(within(row).getByText(/^Blocked /)).toBeInTheDocument()
    expect(within(row).queryByRole('img')).not.toBeInTheDocument()
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Unblock' })).toBeInTheDocument()
  })

  it('asks before unblocking, then removes the row and says "Unblocked."', async () => {
    resetDb('active')
    db.blocks = [block(1), block(2)]
    const user = userEvent.setup()
    renderWithProviders(() => <BlockedMembersScreen />, {
      path: '/settings/blocked',
      me: structuredClone(db.me),
    })

    const list = await screen.findByRole('list', { name: 'Blocked members' })
    await user.click(
      within(within(list).getAllByRole('listitem')[0] as HTMLElement).getByRole('button', {
        name: 'Unblock',
      }),
    )

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Unblock Member 1?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'You will be able to see each other again. A connection or chat that ended is not restored.',
      ),
    ).toBeInTheDocument()
    expect(db.blocks).toHaveLength(2)
    await user.click(within(dialog).getByRole('button', { name: 'Unblock' }))

    expect(await screen.findByText('Unblocked.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Member 1')).not.toBeInTheDocument())
    expect(screen.getByText('Member 2')).toBeInTheDocument()
    expect(db.blocks.map((entry) => entry.profile_id)).toEqual(['blocked-2'])
  })

  it('keeps the member blocked when the confirmation is cancelled', async () => {
    resetDb('active')
    db.blocks = [block(1)]
    const user = userEvent.setup()
    renderWithProviders(() => <BlockedMembersScreen />, {
      path: '/settings/blocked',
      me: structuredClone(db.me),
    })

    await user.click(await screen.findByRole('button', { name: 'Unblock' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(db.blocks).toHaveLength(1)
    expect(screen.getByText('Member 1')).toBeInTheDocument()
  })

  it('refreshes the list instead of saying "Unblocked." when the block no longer exists (not_found)', async () => {
    resetDb('active')
    db.blocks = [block(1)]
    const user = userEvent.setup()
    renderWithProviders(() => <BlockedMembersScreen />, {
      path: '/settings/blocked',
      me: structuredClone(db.me),
    })

    await user.click(await screen.findByRole('button', { name: 'Unblock' }))
    // Unblocked on another device meanwhile.
    db.blocks = []
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unblock' }),
    )

    expect(await screen.findByText('You have not blocked anyone.')).toBeInTheDocument()
    expect(screen.queryByText('Unblocked.')).not.toBeInTheDocument()
  })

  it('loads more rows with "Load more"', async () => {
    resetDb('active')
    db.blocks = Array.from({ length: 25 }, (_, index) => block(index + 1))
    const user = userEvent.setup()
    renderWithProviders(() => <BlockedMembersScreen />, {
      path: '/settings/blocked',
      me: structuredClone(db.me),
    })

    const list = await screen.findByRole('list', { name: 'Blocked members' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(20)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(25))
  })
})

describe('HelpScreen (SET-HELP)', () => {
  it('lists the public pages and the support email', async () => {
    render(<HelpScreen />, '/settings/help')

    const nav = await screen.findByRole('navigation', { name: 'Help pages' })
    const rows = within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')?.split('?')[0]])
    expect(rows).toEqual([
      ['Safety tips', '/safety'],
      ['How Khandani Rishta works', '/how-it-works'],
      ['Questions and answers', '/faq'],
      ['Nikah guide', '/nikah-guide'],
      ['Community Guidelines', '/community-guidelines'],
      ['Terms of Use', '/terms'],
      ['Privacy Policy', '/privacy'],
      ['Contact support', 'mailto:support@example.com'],
    ])
  })

  it('opens an email with the profile code in the subject and the version and platform at the end', async () => {
    render(<HelpScreen />, '/settings/help')

    const link = await screen.findByRole('link', { name: 'Contact support' })
    const url = new URL(link.getAttribute('href') ?? '')
    expect(url.protocol).toBe('mailto:')
    expect(url.pathname).toBe('support@example.com')
    expect(url.searchParams.get('subject')).toBe('Support request KR7Q2M')
    const body = url.searchParams.get('body') ?? ''
    expect(body.trim().endsWith('Platform: web')).toBe(true)
    expect(body).toContain('App version: ')
  })

  it('shows the app version, the profile code and the GeoNames credit', async () => {
    render(<HelpScreen />, '/settings/help')

    expect(await screen.findByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByText(/^App version: /)).toBeInTheDocument()
    expect(screen.getByText('Profile code: KR7Q2M')).toBeInTheDocument()
    expect(
      screen.getByText('City data from GeoNames (geonames.org), licensed under CC BY 4.0.'),
    ).toBeInTheDocument()
  })

  it('goes back to the settings menu, or to the gate screen when the settings are closed', async () => {
    render(<HelpScreen />, '/settings/help')
    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
  })

  it.each([
    ['banned', '/account/blocked'],
    ['suspended', '/account/blocked'],
    ['deletion_scheduled', '/account/deletion'],
  ] as const)('goes back to the gate screen under %s', async (scenario, home) => {
    render(<HelpScreen />, '/settings/help', scenario)
    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', home)
  })
})
