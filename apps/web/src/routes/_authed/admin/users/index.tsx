import { createFileRoute } from '@tanstack/react-router'
import { usersSearch } from '~/features/admin/search-schemas'
import { UsersScreen } from '~/features/admin/UsersScreen'

export const Route = createFileRoute('/_authed/admin/users/')({
  validateSearch: usersSearch,
  component: UsersScreen,
})
