import { createFileRoute } from '@tanstack/react-router'
import { ProfilesScreen } from '~/features/admin/ProfilesScreen'
import { profilesSearch } from '~/features/admin/search-schemas'

export const Route = createFileRoute('/_authed/admin/profiles/')({
  validateSearch: profilesSearch,
  component: ProfilesScreen,
})
