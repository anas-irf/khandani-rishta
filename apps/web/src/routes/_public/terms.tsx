import { createFileRoute } from '@tanstack/react-router'
import { TermsPage } from '~/features/public/LegalPage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/terms')({
  head: () => pageHead('terms'),
  component: TermsPage,
})
