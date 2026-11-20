import { createFileRoute } from '@tanstack/react-router'
import { NikahGuidePage } from '~/features/public/NikahGuidePage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/nikah-guide')({
  head: () => pageHead('nikah_guide'),
  component: NikahGuidePage,
})
