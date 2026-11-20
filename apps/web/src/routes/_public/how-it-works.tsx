import { createFileRoute } from '@tanstack/react-router'
import { HowItWorksPage } from '~/features/public/HowItWorksPage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/how-it-works')({
  head: () => pageHead('how_it_works'),
  component: HowItWorksPage,
})
