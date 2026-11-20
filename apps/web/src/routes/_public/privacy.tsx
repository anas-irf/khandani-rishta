import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPage } from '~/features/public/LegalPage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/privacy')({
  head: () => pageHead('privacy'),
  component: PrivacyPage,
})
