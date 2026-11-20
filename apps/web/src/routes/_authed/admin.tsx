import { createFileRoute } from '@tanstack/react-router'
import { AdminLayout } from '~/features/admin/AdminLayout'
import { i18n } from '~/lib/i18n'

/** The staff console layout (17 section 16, 18): side navigation and the role guard. */
export const Route = createFileRoute('/_authed/admin')({
  head: () => ({ meta: [{ title: i18n.t('common:nav.admin') }] }),
  component: AdminLayout,
})
