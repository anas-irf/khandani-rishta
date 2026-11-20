import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '~/test/render'
import { HomePage } from './HomePage'

describe('HomePage (PUB-HOME)', () => {
  it('has one h1 with the value proposition and the main calls to action', async () => {
    renderWithProviders(() => <HomePage />)

    const headings = await screen.findAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Rishta, the khandani way.')
    expect(
      screen.getByText(/A respectful place for families and individuals in Pakistan and abroad/),
    ).toBeInTheDocument()

    expect(screen.getAllByRole('link', { name: 'Create a free profile' }).length).toBeGreaterThan(1)
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute(
      'href',
      '/how-it-works',
    )
  })

  it('shows the three promises, the three steps and the privacy promise', async () => {
    renderWithProviders(() => <HomePage />)
    await screen.findByRole('heading', { level: 1 })

    for (const title of ['Your privacy, your rules', 'Checked by people', 'For marriage only']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }

    const how = screen.getByRole('region', { name: 'How it works' })
    expect(within(how).getAllByRole('listitem')).toHaveLength(3)

    const privacy = screen.getByRole('region', { name: 'Our privacy promise' })
    expect(within(privacy).getByText('Your CNIC number is never shown to anyone.')).toBeVisible()
  })

  it('covers verification, families, safety and the Android app', async () => {
    renderWithProviders(() => <HomePage />)
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getByRole('heading', { name: 'Verification is free' })).toBeInTheDocument()
    expect(screen.getByText('Parents and siblings are welcome.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read our safety advice' })).toHaveAttribute(
      'href',
      '/safety',
    )
    expect(screen.getByRole('link', { name: 'Download the app' })).toHaveAttribute(
      'href',
      '/download',
    )
    expect(screen.getByText('The web app works on any phone or computer.')).toBeInTheDocument()
  })

  it('teases four questions as plain details elements and links to all of them', async () => {
    const { container } = renderWithProviders(() => <HomePage />)
    await screen.findByRole('heading', { level: 1 })

    const questions = container.querySelectorAll('details > summary')
    expect(questions).toHaveLength(4)
    expect(screen.getByText('Is Khandani Rishta free?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all questions and answers' })).toHaveAttribute(
      'href',
      '/faq',
    )
  })

  it('sends both sign-up buttons to the sign-in page', async () => {
    renderWithProviders(() => <HomePage />)
    await screen.findByRole('heading', { level: 1 })

    for (const link of screen.getAllByRole('link', { name: 'Create a free profile' })) {
      expect(link.getAttribute('href')).toMatch(/^\/sign-in\/?$/)
    }
  })
})
