import { createFileRoute } from '@tanstack/react-router'
import { GuidelinesPage } from '~/features/public/LegalPage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/community-guidelines')({
  head: () => pageHead('community_guidelines'),
  component: GuidelinesPage,
})
