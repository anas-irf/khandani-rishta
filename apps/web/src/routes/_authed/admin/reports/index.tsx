import { createFileRoute } from '@tanstack/react-router'
import { ReportsScreen } from '~/features/admin/ReportsScreen'
import { reportsSearch } from '~/features/admin/search-schemas'

export const Route = createFileRoute('/_authed/admin/reports/')({
  validateSearch: reportsSearch,
  component: ReportsScreen,
})
