import { createFileRoute } from '@tanstack/react-router'
import { verificationsSearch } from '~/features/admin/search-schemas'
import { VerificationsScreen } from '~/features/admin/VerificationsScreen'

export const Route = createFileRoute('/_authed/admin/verifications/')({
  validateSearch: verificationsSearch,
  component: VerificationsScreen,
})
