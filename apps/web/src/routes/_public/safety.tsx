import { createFileRoute } from '@tanstack/react-router'
import { SafetyPage } from '~/features/public/SafetyPage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/safety')({
  head: () => pageHead('safety'),
  component: SafetyPage,
})
