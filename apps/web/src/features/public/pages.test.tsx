import { screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '~/test/render'
import { ContactPage } from './ContactPage'
import { SUPPORT_EMAIL } from './config'
import { DownloadPage } from './DownloadPage'
import { FaqPage } from './FaqPage'
import { HomePage } from './HomePage'
import { HowItWorksPage } from './HowItWorksPage'
import { GuidelinesPage, PrivacyPage, TermsPage } from './LegalPage'
import { NikahGuidePage } from './NikahGuidePage'
import { SafetyPage } from './SafetyPage'

const pages: { name: string; h1: string; element: ReactNode }[] = [
  { name: 'home', h1: 'Rishta, the khandani way.', element: <HomePage /> },
  { name: 'how it works', h1: 'How Khandani Rishta works', element: <HowItWorksPage /> },
  { name: 'safety', h1: 'Safety advice', element: <SafetyPage /> },
  { name: 'nikah guide', h1: 'Nikah guide', element: <NikahGuidePage /> },
  { name: 'faq', h1: 'Questions and answers', element: <FaqPage /> },
  {
    name: 'download',
    h1: 'Download the Android app',
    element: <DownloadPage result={{ status: 'none' }} />,
  },
  { name: 'contact', h1: 'Contact', element: <ContactPage /> },
  { name: 'terms', h1: 'Terms of Use', element: <TermsPage /> },
  { name: 'privacy', h1: 'Privacy Policy', element: <PrivacyPage /> },
  { name: 'community guidelines', h1: 'Community Guidelines', element: <GuidelinesPage /> },
]

/** A missing translation renders as its key, for example "terms.sections". */
const UNTRANSLATED_KEY =
  /\b(home|how|safety|nikah|faq|download|contact|terms|privacy|guidelines|legal|links|cta|header|footer)\.[a-z_]+\b/

describe.each(pages)('$name page', ({ h1, element }) => {
  it('has exactly one h1 and no untranslated keys or unfilled values', async () => {
    const { container } = renderWithProviders(() => element)

    const headings = await screen.findAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(h1)

    const text = container.textContent ?? ''
    expect(text).not.toContain('{{')
    expect(text).not.toMatch(UNTRANSLATED_KEY)
    // The brief forbids the long dash in copy.
    expect(text).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('legal pages', () => {
  it.each([
    ['terms', <TermsPage key="terms" />, 12],
    ['privacy', <PrivacyPage key="privacy" />, 13],
    ['guidelines', <GuidelinesPage key="guidelines" />, 9],
  ] as const)(
    '%s shows the pending-review note and its numbered clauses',
    async (_name, element, clauses) => {
      renderWithProviders(() => element)

      expect(await screen.findByText('Pending legal review')).toBeInTheDocument()
      expect(screen.getByText(/A lawyer in Pakistan has not reviewed it yet/)).toBeInTheDocument()
      const headings = screen.getAllByRole('heading', { level: 2 })
      expect(headings).toHaveLength(clauses)
      expect(headings[0]).toHaveTextContent(/^1\. /)
      expect(headings[clauses - 1]).toHaveTextContent(new RegExp(`^${clauses}\\. `))
      expect(screen.getByRole('navigation', { name: 'On this page' })).toBeInTheDocument()
    },
  )

  it('shows the support address in the contact clause of the terms', async () => {
    renderWithProviders(() => <TermsPage />)
    await screen.findByRole('heading', { level: 1 })
    expect(
      screen.getByText(`Questions about these terms: write to ${SUPPORT_EMAIL}.`),
    ).toBeInTheDocument()
  })
})

describe('nikah guide', () => {
  it('shows the fixed notice at the top and the bottom, twelve sections and a contents list', async () => {
    renderWithProviders(() => <NikahGuidePage />)
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getAllByText(/It is not legal or religious advice/)).toHaveLength(2)
    expect(
      screen.getAllByText('Khandani Rishta does not conduct, arrange or register marriages.'),
    ).toHaveLength(2)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(12)
    const toc = screen.getByRole('navigation', { name: 'On this page' })
    expect(toc.querySelectorAll('a')).toHaveLength(12)
    expect(screen.getByRole('link', { name: 'Safety' })).toHaveAttribute('href', '/safety')
    expect(screen.getByRole('link', { name: 'Questions and answers' })).toHaveAttribute(
      'href',
      '/faq',
    )
  })
})

describe('safety page', () => {
  it('presents the twelve tips in order', async () => {
    const { container } = renderWithProviders(() => <SafetyPage />)
    await screen.findByRole('heading', { level: 1 })

    const tips = container.querySelectorAll('ol > li')
    expect(tips).toHaveLength(12)
    expect(tips[0]).toHaveTextContent(/^Never send money\./)
    expect(tips[11]).toHaveTextContent(/National Cyber Crime Investigation Agency/)
    expect(screen.getByRole('heading', { level: 2, name: 'For parents' })).toBeInTheDocument()
  })
})

describe('contact page', () => {
  it('links the support address and says what to include', async () => {
    renderWithProviders(() => <ContactPage />)
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute(
      'href',
      `mailto:${SUPPORT_EMAIL}`,
    )
    expect(screen.getByText('We usually answer within 2 working days.')).toBeInTheDocument()
    expect(screen.getByText(/Never send your CNIC number/)).toBeInTheDocument()
  })
})
