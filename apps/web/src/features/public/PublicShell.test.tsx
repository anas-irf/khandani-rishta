import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { PublicHeader } from '~/components/layout/PublicHeader'
import { PublicShell } from '~/components/layout/PublicShell'
import { renderWithProviders } from '~/test/render'

/** Public pages read Clerk's __client_uat cookie instead of loading Clerk. */
function signInHint() {
  // biome-ignore lint/suspicious/noDocumentCookie: sets the cookie the way Clerk does in a browser
  document.cookie = '__client_uat=1763600000; path=/'
}

afterEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: resets the cookie between tests
  document.cookie = '__client_uat=0; path=/'
})

describe('PublicHeader', () => {
  it('shows "Sign in" and "Create profile" to a visitor', async () => {
    renderWithProviders(() => <PublicHeader />)

    const banner = await screen.findByRole('banner')
    const signIn = within(banner).getByRole('link', { name: 'Sign in' })
    const create = within(banner).getByRole('link', { name: 'Create profile' })
    expect(signIn.getAttribute('href')).toMatch(/^\/sign-in\/?$/)
    expect(create.getAttribute('href')).toMatch(/^\/sign-in\/?$/)
    expect(within(banner).queryByRole('link', { name: 'Open the app' })).not.toBeInTheDocument()
  })

  it('shows "Open the app" instead of the buttons when the visitor is signed in', async () => {
    signInHint()
    renderWithProviders(() => <PublicHeader />)

    const banner = await screen.findByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Open the app' })).toHaveAttribute(
      'href',
      '/home',
    )
    expect(within(banner).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(within(banner).queryByRole('link', { name: 'Create profile' })).not.toBeInTheDocument()
  })

  it('links the logo to the landing page and lists the main pages', async () => {
    renderWithProviders(() => <PublicHeader />)

    const banner = await screen.findByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Khandani Rishta' })).toHaveAttribute(
      'href',
      '/',
    )
    const nav = within(banner).getByRole('navigation', { name: 'Main' })
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['/how-it-works', '/safety', '/nikah-guide', '/faq', '/download'])
  })

  it('opens a menu sheet with every link and the account buttons', async () => {
    const user = userEvent.setup()
    renderWithProviders(() => <PublicHeader />)

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))

    const dialog = await screen.findByRole('dialog', { name: 'Menu' })
    const menu = within(dialog)
    for (const name of ['How it works', 'Safety', 'Nikah guide', 'FAQ', 'Download']) {
      expect(menu.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(menu.getByRole('link', { name: 'Create profile' })).toBeInTheDocument()
    expect(menu.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(menu.getByRole('button', { name: 'Close menu' })).toBeInTheDocument()
  })

  it('shows "Open the app" in the menu for a signed-in visitor', async () => {
    const user = userEvent.setup()
    signInHint()
    renderWithProviders(() => <PublicHeader />)

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))

    const dialog = await screen.findByRole('dialog', { name: 'Menu' })
    expect(within(dialog).getByRole('link', { name: 'Open the app' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })
})

describe('PublicShell', () => {
  it('has a skip link, one main landmark and the footer of 16 section 7.11', async () => {
    renderWithProviders(
      () => (
        <PublicShell>
          <h1>A page</h1>
        </PublicShell>
      ),
      { session: { isSignedIn: false } },
    )

    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main',
    )
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main')
    expect(within(main).getByRole('heading', { level: 1, name: 'A page' })).toBeInTheDocument()

    const footer = screen.getByRole('contentinfo')
    const links = within(footer)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links).toEqual([
      'How it works',
      'Safety',
      'Questions and answers',
      'Nikah guide',
      'Create a free profile',
      'Sign in',
      'Download the app',
      'Terms of Use',
      'Privacy Policy',
      'Community Guidelines',
      'Contact',
    ])
  })

  it('credits GeoNames and shows the copyright line in the footer', async () => {
    renderWithProviders(() => <PublicShell>content</PublicShell>, {
      session: { isSignedIn: false },
    })

    const footer = await screen.findByRole('contentinfo')
    expect(
      within(footer).getByText('City data from GeoNames (geonames.org), licensed under CC BY 4.0.'),
    ).toBeInTheDocument()
    expect(within(footer).getByText(/^© \d{4} Khandani Rishta\.$/)).toBeInTheDocument()
  })
})
