import { Link } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { RelativeTime } from '~/components/common/RelativeTime'
import { formatDate } from '~/lib/format'
import { useLabelOf } from '~/lib/reference'
import type { AdminReportListItem, AuditEntry } from '../types'
import { type Column, DataTable } from './DataTable'
import { StatusBadge } from './StatusBadge'

/** The target of an audit entry as a link to its screen, or plain text when it has none. */
export function AuditTarget({ entry }: { entry: Pick<AuditEntry, 'target_type' | 'target_id'> }) {
  const { t } = useTranslation('admin')
  const label = (
    <>
      <span>{t(`audit.target.${entry.target_type}`, { defaultValue: entry.target_type })}</span>{' '}
      <span className="font-mono text-xs text-muted-foreground">{entry.target_id}</span>
    </>
  )
  switch (entry.target_type) {
    case 'profile':
      return (
        <Link
          to="/admin/profiles/$profileId"
          params={{ profileId: entry.target_id }}
          className="text-primary hover:underline"
        >
          {label}
        </Link>
      )
    case 'user':
      return (
        <Link
          to="/admin/users/$userId"
          params={{ userId: entry.target_id }}
          className="text-primary hover:underline"
        >
          {label}
        </Link>
      )
    case 'verification_request':
      return (
        <Link
          to="/admin/verifications/$requestId"
          params={{ requestId: entry.target_id }}
          className="text-primary hover:underline"
        >
          {label}
        </Link>
      )
    case 'report':
      return (
        <Link
          to="/admin/reports/$reportId"
          params={{ reportId: entry.target_id }}
          className="text-primary hover:underline"
        >
          {label}
        </Link>
      )
    case 'caste':
    case 'caste_suggestion':
      return (
        <Link to="/admin/castes" className="text-primary hover:underline">
          {label}
        </Link>
      )
    case 'app_setting':
      return entry.target_id === 'announcement' ? (
        <Link to="/admin/announcements" className="text-primary hover:underline">
          {label}
        </Link>
      ) : (
        <Link to="/admin/settings" className="text-primary hover:underline">
          {label}
        </Link>
      )
    case 'app_release':
      return (
        <Link to="/admin/releases" className="text-primary hover:underline">
          {label}
        </Link>
      )
    default:
      return <span>{label}</span>
  }
}

/** Audit entries as a table, newest first (18 section 8.2). */
export function auditColumns(t: TFunction, showActor = true): Column<AuditEntry>[] {
  const columns: Column<AuditEntry>[] = [
    {
      id: 'time',
      header: t('audit.col.time'),
      className: 'whitespace-nowrap',
      cell: (entry) => <RelativeTime value={entry.created_at} />,
    },
  ]
  if (showActor) {
    columns.push({
      id: 'actor',
      header: t('audit.col.actor'),
      cell: (entry) => entry.actor.email ?? entry.actor.user_id,
    })
  }
  columns.push(
    {
      id: 'action',
      header: t('audit.col.action'),
      cell: (entry) => <code className="text-xs">{entry.action}</code>,
    },
    { id: 'target', header: t('audit.col.target'), cell: (entry) => <AuditTarget entry={entry} /> },
    {
      id: 'details',
      header: t('audit.col.details'),
      cell: (entry) => {
        const text = JSON.stringify(entry.details)
        return (
          <code className="block max-w-xs truncate text-xs text-muted-foreground" title={text}>
            {text}
          </code>
        )
      },
    },
  )
  return columns
}

export function AuditTable({
  entries,
  caption,
  showActor = true,
}: {
  entries: AuditEntry[]
  caption: string
  showActor?: boolean
}) {
  const { t } = useTranslation('admin')
  if (entries.length === 0)
    return <p className="text-sm text-muted-foreground">{t('audit.none')}</p>
  return (
    <DataTable
      caption={caption}
      columns={auditColumns(t, showActor)}
      rows={entries}
      getKey={(entry) => entry.id}
    />
  )
}

/** Reports (on a target, or related) as a table linking to each report. */
export function ReportsTable({
  reports,
  caption,
}: {
  reports: AdminReportListItem[]
  caption: string
}) {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('reports.none')}</p>
  }
  const columns: Column<AdminReportListItem>[] = [
    {
      id: 'report',
      header: t('reports.col.reason'),
      cell: (report) => (
        <Link
          to="/admin/reports/$reportId"
          params={{ reportId: report.report_id }}
          className="font-medium text-primary hover:underline"
        >
          {label('report_reason', report.reason)}
        </Link>
      ),
    },
    {
      id: 'status',
      header: t('reports.col.status'),
      cell: (report) => <StatusBadge status={report.status} />,
    },
    {
      id: 'source',
      header: t('reports.col.source'),
      cell: (report) => t(`reports.source.${report.source}`),
    },
    {
      id: 'created',
      header: t('reports.col.created'),
      cell: (report) => <RelativeTime value={report.created_at} />,
    },
  ]
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={reports}
      getKey={(report) => report.report_id}
    />
  )
}

type SanctionRow = {
  id?: string
  type: string
  reason: string
  starts_at: string
  ends_at: string | null
  revoked_at: string | null
  created_by_email?: string | null
}

/** Sanctions as a table: type, reason, period and who applied or lifted them. */
export function SanctionsTable({
  sanctions,
  caption,
}: {
  sanctions: SanctionRow[]
  caption: string
}) {
  const { t } = useTranslation('admin')
  if (sanctions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('sanctions.none')}</p>
  }
  const columns: Column<SanctionRow>[] = [
    {
      id: 'type',
      header: t('sanctions.col.type'),
      cell: (row) => t(`sanctions.type.${row.type}`, { defaultValue: row.type }),
    },
    { id: 'reason', header: t('sanctions.col.reason'), cell: (row) => row.reason },
    {
      id: 'period',
      header: t('sanctions.col.period'),
      cell: (row) =>
        row.ends_at
          ? t('sanctions.period', { from: formatDate(row.starts_at), to: formatDate(row.ends_at) })
          : formatDate(row.starts_at),
    },
    {
      id: 'state',
      header: t('sanctions.col.state'),
      cell: (row) =>
        row.revoked_at
          ? t('sanctions.revoked', { date: formatDate(row.revoked_at) })
          : t('sanctions.in_force'),
    },
    { id: 'by', header: t('sanctions.col.by'), cell: (row) => row.created_by_email ?? '-' },
  ]
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={sanctions}
      getKey={(row) => row.id ?? `${row.type}-${row.starts_at}`}
    />
  )
}
