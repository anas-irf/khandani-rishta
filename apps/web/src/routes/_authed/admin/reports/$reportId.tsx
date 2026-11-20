import { createFileRoute } from '@tanstack/react-router'
import { ReportScreen } from '~/features/admin/ReportScreen'

export const Route = createFileRoute('/_authed/admin/reports/$reportId')({
  component: ReportScreen,
})
