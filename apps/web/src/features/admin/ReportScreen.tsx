// ADM-REPORT: one report, with its context and the claim, sanction and resolve workflow (18 section 4.5).
import { Link, useNavigate } from '@tanstack/react-router'
import { Gavel, HandMetal, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { Page } from '~/components/common/Page'
import { PlainText } from '~/components/common/PlainText'
import { RelativeTime } from '~/components/common/RelativeTime'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button } from '~/components/ui/button'
import { formatDate } from '~/lib/format'
import { useLabelOf } from '~/lib/reference'
import { useIsAdmin } from './access'
import { ActionToolbar } from './components/ActionToolbar'
import { AdminPhoto } from './components/AdminPhoto'
import { DetailState, detailGridClass } from './components/DetailState'
import { Facts, Panel } from './components/Facts'
import { Kbd } from './components/Kbd'
import { ReportContext } from './components/ReportContext'
import { ResolveReportDialog } from './components/ResolveReportDialog'
import { RejectPhotoDialog } from './components/ReviewDialogs'
import { SanctionDialog, type SanctionKind } from './components/SanctionDialog'
import { StatusBadge } from './components/StatusBadge'
import { ReportsTable, SanctionsTable } from './components/Tables'
import { adminKeys, useAdminReport, useClaimReport, useResolveReport } from './queries'
import { PriorityBadge } from './ReportsScreen'
import { useRouteId } from './search'
import { useQueueNeighbours } from './selection'
import { useShortcuts } from './shortcuts'
import type { AdminReportDetail, AdminReportListItem, ReportOutcome } from './types'

type Dialog =
  | { kind: 'sanction' }
  | { kind: 'resolve'; nextId: string | null }
  | { kind: 'photo'; photoId: string }
  | { kind: 'related'; note: string; nextId: string | null }
  | null

export function ReportScreen() {
  const reportId = useRouteId('reportId')
  const query = useAdminReport(reportId)

  if (query.isPending || query.isError) return <DetailState query={query} />
  return <ReportView data={query.data} />
}

function ReportView({ data }: { data: AdminReportDetail }) {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const claim = useClaimReport()
  const resolve = useResolveReport()
  const [dialog, setDialog] = useState<Dialog>(null)
  // Content removal or a sanction made from this screen counts as "action recorded".
  const [actionRecorded, setActionRecorded] = useState(false)

  const reportId = data.report_id
  const reasonLabel = label('report_reason', data.reason)
  const isOpen = data.status === 'open'
  const inReview = data.status === 'in_review'
  const decided = !isOpen && !inReview
  const target = data.target
  const targetName = target.first_name ?? target.public_code
  const recorded = actionRecorded || data.photo?.status === 'rejected'

  const openReport = (id: string) =>
    void navigate({ to: '/admin/reports/$reportId', params: { reportId: id } })
  const neighbours = useQueueNeighbours<AdminReportListItem>({
    listKey: adminKeys.reportList('open'),
    getId: (item) => item.report_id,
    currentId: reportId,
    open: openReport,
  })
  const goAfterDecision = (nextId: string | null) => {
    if (nextId) openReport(nextId)
    else void navigate({ to: '/admin/reports' })
  }

  const doClaim = async () => {
    await claim.mutateAsync(reportId)
    toast.success(t('report.claimed'))
  }
  const claimNow = () => void doClaim().catch(() => undefined)

  useShortcuts(
    {
      c: isOpen ? claimNow : undefined,
      s: inReview ? () => setDialog({ kind: 'sanction' }) : undefined,
      x: decided ? undefined : () => setDialog({ kind: 'resolve', nextId: neighbours().next }),
    },
    dialog === null,
  )

  const openRelated = data.related_reports.filter((report) => report.status === 'open')

  const afterResolve = (
    result: { outcome: ReportOutcome; note: string },
    nextId: string | null,
  ) => {
    toast.success(t('report.resolved'))
    if (result.outcome === 'actioned' && openRelated.length > 0) {
      setDialog({ kind: 'related', note: result.note, nextId })
    } else {
      goAfterDecision(nextId)
    }
  }

  /** Claims and resolves each related open report with the same note (18 section 4.5 rule 4). */
  const resolveRelated = async (note: string) => {
    let done = 0
    for (const report of openRelated) {
      try {
        await claim.mutateAsync(report.report_id)
        await resolve.mutateAsync({ reportId: report.report_id, outcome: 'actioned', note })
        done += 1
      } catch {
        // Someone else took this one; the rest are still resolved.
      }
    }
    toast.success(t('report.related_done', { count: done }))
  }

  const sanctionKinds: SanctionKind[] = isAdmin ? ['warn', 'suspend', 'ban'] : ['warn', 'suspend']

  return (
    <Page
      title={t('report.title', { reason: reasonLabel })}
      description={t('report.subtitle', { target: targetName, code: target.public_code })}
      backTo="/admin/reports"
      backLabel={t('report.back')}
      actions={
        <>
          <PriorityBadge priority={data.priority} />
          <StatusBadge status={data.status} />
        </>
      }
    >
      {data.source === 'system' ? (
        <StatusBanner variant="warning">{t('report.system_note')}</StatusBanner>
      ) : null}

      <ActionToolbar label={t('report.actions')}>
        <Button
          loading={claim.isPending}
          disabled={!isOpen}
          aria-keyshortcuts="C"
          onClick={claimNow}
        >
          <HandMetal aria-hidden="true" />
          {t('report.claim')}
          <Kbd>C</Kbd>
        </Button>
        <Button
          variant="secondary"
          disabled={!inReview || claim.isPending}
          aria-keyshortcuts="S"
          onClick={() => setDialog({ kind: 'sanction' })}
        >
          <Gavel aria-hidden="true" />
          {t('report.sanction')}
          <Kbd>S</Kbd>
        </Button>
        <Button
          variant="secondary"
          disabled={decided || claim.isPending}
          aria-keyshortcuts="X"
          onClick={() => setDialog({ kind: 'resolve', nextId: neighbours().next })}
        >
          <ShieldCheck aria-hidden="true" />
          {t('report.resolve')}
          <Kbd>X</Kbd>
        </Button>
        <Button asChild variant="link" className="mx-2">
          <Link to="/admin/profiles/$profileId" params={{ profileId: target.profile_id }}>
            {t('report.open_profile')}
          </Link>
        </Button>
        <Button asChild variant="link" className="mx-2">
          <Link to="/admin/users/$userId" params={{ userId: target.user_id }}>
            {t('report.open_account')}
          </Link>
        </Button>
        {isOpen ? (
          <p className="text-body-sm text-muted-foreground">{t('report.claim_first')}</p>
        ) : null}
      </ActionToolbar>

      <div className={detailGridClass}>
        <div className="flex min-w-0 flex-col gap-4">
          <Facts
            title={t('report.summary')}
            columns={2}
            facts={[
              { label: t('reports.col.reason'), value: reasonLabel },
              { label: t('reports.col.subject'), value: t(`reports.subject.${data.subject_type}`) },
              { label: t('reports.col.source'), value: t(`reports.source.${data.source}`) },
              { label: t('reports.col.created'), value: <RelativeTime value={data.created_at} /> },
              { label: t('reports.col.handled_by'), value: data.handled_by_email },
              {
                label: t('report.handled_at'),
                value: data.handled_at ? formatDate(data.handled_at) : null,
              },
            ]}
          />
          {data.details ? (
            <Panel title={t('report.details')}>
              <PlainText text={data.details} />
            </Panel>
          ) : null}
          {data.resolution_note ? (
            <Panel title={t('report.resolution_note')}>
              <PlainText text={data.resolution_note} />
            </Panel>
          ) : null}
          {data.photo ? (
            <Panel
              title={t('report.photo')}
              action={data.photo.status ? <StatusBadge status={data.photo.status} /> : undefined}
            >
              <AdminPhoto
                photoId={data.photo.photo_id}
                url={data.photo.large_url}
                name={targetName}
                gender={null}
                size="large"
                width={400}
                height={500}
                whole
                className="aspect-[4/5] w-full max-w-sm"
              />
              {data.photo.status === 'approved' || data.photo.status === 'pending_review' ? (
                <Button
                  className="w-fit"
                  variant="secondary"
                  disabled={decided}
                  onClick={() => {
                    if (data.photo) setDialog({ kind: 'photo', photoId: data.photo.photo_id })
                  }}
                >
                  {t('report.reject_photo')}
                </Button>
              ) : null}
            </Panel>
          ) : null}
          {data.subject_type !== 'photo' ? (
            <Panel title={t('report.context')}>
              <ReportContext report={data} />
            </Panel>
          ) : null}
          <Panel title={t('report.related')}>
            <ReportsTable reports={data.related_reports} caption={t('report.related')} />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Facts
            title={t('report.target')}
            columns={1}
            facts={[
              { label: t('reports.col.target'), value: `${targetName} (${target.public_code})` },
              {
                label: t('report.user_status'),
                value: <StatusBadge status={data.target_summary.user_status} />,
              },
              {
                label: t('report.profile_status'),
                value: <StatusBadge status={data.target_summary.profile_status} />,
              },
              {
                label: t('report.reports_against'),
                value: t('report.reports_against_value', {
                  total: data.target_summary.reports_against_total,
                  actioned: data.target_summary.reports_against_actioned,
                }),
              },
              {
                label: t('report.verification'),
                value: [
                  data.target_summary.is_id_verified ? t('report.id_verified') : null,
                  data.target_summary.is_photo_verified ? t('report.photo_verified') : null,
                ]
                  .filter(Boolean)
                  .join(', '),
              },
            ]}
          />
          <Panel title={t('report.sanctions')}>
            <SanctionsTable
              sanctions={data.target_summary.sanctions}
              caption={t('report.sanctions')}
            />
          </Panel>
          {data.reporter_summary ? (
            <Facts
              title={t('report.reporter')}
              columns={1}
              facts={[
                {
                  label: t('reports.col.reporter'),
                  value: data.reporter
                    ? `${data.reporter.first_name ?? data.reporter.public_code} (${data.reporter.public_code})`
                    : null,
                },
                { label: t('report.filed'), value: data.reporter_summary.filed },
                { label: t('report.actioned'), value: data.reporter_summary.actioned },
                { label: t('report.dismissed'), value: data.reporter_summary.dismissed },
              ]}
            />
          ) : null}
        </div>
      </div>

      {dialog?.kind === 'sanction' ? (
        <SanctionDialog
          userId={target.user_id}
          publicCode={target.public_code}
          kinds={sanctionKinds}
          reportId={reportId}
          onClose={() => setDialog(null)}
          onDone={(kind) => {
            setActionRecorded(true)
            toast.success(t(`sanctions.done.${kind}`))
          }}
        />
      ) : null}
      {dialog?.kind === 'photo' ? (
        <RejectPhotoDialog
          photoId={dialog.photoId}
          onDone={() => setActionRecorded(true)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'resolve' ? (
        <ResolveReportDialog
          reportId={reportId}
          status={data.status}
          actionRecorded={recorded}
          onClose={() => setDialog((current) => (current?.kind === 'related' ? current : null))}
          onDone={(result) => afterResolve(result, dialog.nextId)}
        />
      ) : null}
      {dialog?.kind === 'related' ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null)
              goAfterDecision(dialog.nextId)
            }
          }}
          title={t('report.related_title')}
          description={t('report.related_text', { count: openRelated.length })}
          confirmLabel={t('report.related_confirm')}
          cancelLabel={t('report.related_skip')}
          onConfirm={() => resolveRelated(dialog.note)}
        />
      ) : null}
    </Page>
  )
}
