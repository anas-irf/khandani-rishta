import { createFileRoute } from '@tanstack/react-router'
import { AuditLogScreen } from '~/features/admin/AuditLogScreen'
import { auditSearch } from '~/features/admin/search-schemas'

export const Route = createFileRoute('/_authed/admin/audit-log')({
  validateSearch: auditSearch,
  component: AuditLogScreen,
})
