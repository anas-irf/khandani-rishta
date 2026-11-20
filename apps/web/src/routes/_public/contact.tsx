import { createFileRoute } from '@tanstack/react-router'
import { ContactPage } from '~/features/public/ContactPage'
import { pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/contact')({
  head: () => pageHead('contact'),
  component: ContactPage,
})
