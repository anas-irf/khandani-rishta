import { createFileRoute } from '@tanstack/react-router'
import { CastesScreen } from '~/features/admin/CastesScreen'
import { castesSearch } from '~/features/admin/search-schemas'

export const Route = createFileRoute('/_authed/admin/castes')({
  validateSearch: castesSearch,
  component: CastesScreen,
})
