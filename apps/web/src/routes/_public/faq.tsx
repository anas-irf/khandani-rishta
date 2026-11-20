import { createFileRoute } from '@tanstack/react-router'
import { buildFaqStructuredData, FaqPage } from '~/features/public/FaqPage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/faq')({
  head: () => pageHead('faq', { jsonLd: buildFaqStructuredData() }),
  component: FaqPage,
})
