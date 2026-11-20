import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '~/test/render'
import { buildFaqStructuredData, FaqPage } from './FaqPage'
import { allFaqEntries, FAQ_GROUPS, HOME_FAQ_IDS } from './faq'
import { faqJsonLd } from './seo'

const questionCount = FAQ_GROUPS.reduce((total, group) => total + group.items.length, 0)

describe('FaqPage (PUB-FAQ)', () => {
  it('lists the five groups with every question as a details element', async () => {
    const { container } = renderWithProviders(() => <FaqPage />)

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Questions and answers',
    )
    for (const group of [
      'Getting started',
      'Privacy',
      'Matches and interests',
      'Verification and safety',
      'Your account',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: group })).toBeInTheDocument()
    }
    expect(container.querySelectorAll('details')).toHaveLength(questionCount)
    expect(questionCount).toBe(24)
  })

  it('keeps each answer next to its question, closed until opened', async () => {
    const { container } = renderWithProviders(() => <FaqPage />)
    await screen.findByRole('heading', { level: 1 })

    const first = container.querySelector('details')
    expect(first).not.toBeNull()
    expect(first).not.toHaveAttribute('open')
    expect(within(first as HTMLElement).getByText('Is Khandani Rishta free?')).toBeInTheDocument()
    expect(within(first as HTMLElement).getByText(/never charge for safety/)).toBeInTheDocument()
  })

  it('links to the contact page for an unanswered question', async () => {
    renderWithProviders(() => <FaqPage />)
    expect(await screen.findByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact')
  })
})

describe('FAQPage structured data (17 section 13)', () => {
  it('builds schema.org questions and answers from the page texts', () => {
    const data = buildFaqStructuredData()

    expect(data['@context']).toBe('https://schema.org')
    expect(data['@type']).toBe('FAQPage')
    const entities = data.mainEntity as {
      '@type': string
      name: string
      acceptedAnswer: { '@type': string; text: string }
    }[]
    expect(entities).toHaveLength(questionCount)
    for (const entity of entities) {
      expect(entity['@type']).toBe('Question')
      expect(entity.name.endsWith('?')).toBe(true)
      expect(entity.acceptedAnswer['@type']).toBe('Answer')
      expect(entity.acceptedAnswer.text.length).toBeGreaterThan(20)
    }
    expect(entities[0]?.name).toBe('Is Khandani Rishta free?')
  })

  it('is plain JSON that survives serialisation', () => {
    const data = faqJsonLd([{ question: 'Q?', answer: 'A.' }])
    expect(JSON.parse(JSON.stringify(data))).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } },
      ],
    })
  })

  it('uses the same texts on the page and in the data, and the landing questions exist', () => {
    const entries = allFaqEntries((key) => key)
    expect(entries).toHaveLength(questionCount)
    const ids = FAQ_GROUPS.flatMap((group) => group.items as readonly string[])
    for (const id of HOME_FAQ_IDS) expect(ids).toContain(id)
  })
})
