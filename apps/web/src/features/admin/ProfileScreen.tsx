// ADM-PROFILE: one profile in full, with the review actions (18 sections 4.1 and 5.4).
import { Link, useNavigate } from '@tanstack/react-router'
import { Check, MessageSquareWarning, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { PlainText } from '~/components/common/PlainText'
import { RelativeTime } from '~/components/common/RelativeTime'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { formatDate, formatPhone } from '~/lib/format'
import { useLabelOf } from '~/lib/reference'
import { useIsAdmin } from './access'
import { AdminPhoto } from './components/AdminPhoto'
import { DataTable } from './components/DataTable'
import { Facts, Panel } from './components/Facts'
import { ProfileSections } from './components/ProfileData'
import {
  LockedFieldsDialog,
  RejectPhotoDialog,
  RejectTextDialog,
  RequestChangesDialog,
} from './components/ReviewDialogs'
import { StatusBadge } from './components/StatusBadge'
import { AuditTable, ReportsTable, SanctionsTable } from './components/Tables'
import { fullName } from './names'
import { adminKeys, useAdminProfile, useApproveProfile } from './queries'
import { useRouteId } from './search'
import { useQueueNeighbours } from './selection'
import { useShortcuts } from './shortcuts'
import type { AdminProfile, AdminProfileListItem, AdminTextField } from './types'

type Dialog =
  | { kind: 'changes'; nextId: string | null }
  | { kind: 'locked' }
  | { kind: 'photo'; photoId: string }
  | { kind: 'text'; field: AdminTextField; text: string }
  | null

export function ProfileScreen() {
  const { t } = useTranslation('admin')
  const profileId = useRouteId('profileId')
  const query = useAdminProfile(profileId)

  if (query.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{t('list.loading')}</span>
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  return <ProfileView data={query.data} />
}

function ProfileView({ data }: { data: AdminProfile }) {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const approve = useApproveProfile()
  const [dialog, setDialog] = useState<Dialog>(null)

  const { profile, user } = data
  const profileId = profile.id
  const name = fullName(profile.basics.first_name, profile.basics.last_name, profile.public_code)
  const canDecide = profile.status === 'pending_review'

  const openProfile = (id: string) =>
    void navigate({ to: '/admin/profiles/$profileId', params: { profileId: id } })
  const neighbours = useQueueNeighbours<AdminProfileListItem>({
    listKey: adminKeys.profileList({ status: 'pending_review' }),
    getId: (item) => item.profile_id,
    currentId: profileId,
    open: openProfile,
  })

  /** After a decision: the next profile of the queue, or back to the list. */
  const goAfterDecision = (nextId: string | null) => {
    if (nextId) openProfile(nextId)
    else void navigate({ to: '/admin/profiles' })
  }

  const doApprove = async () => {
    const { next } = neighbours()
    await approve.mutateAsync(profileId)
    toast.success(t('profile.approved', { name }))
    goAfterDecision(next)
  }

  const openChanges = () => setDialog({ kind: 'changes', nextId: neighbours().next })
  const openUser = () => void navigate({ to: '/admin/users/$userId', params: { userId: user.id } })

  useShortcuts(
    {
      a: canDecide ? () => void doApprove().catch(() => undefined) : undefined,
      c: canDecide ? openChanges : undefined,
      u: openUser,
    },
    dialog === null,
  )

  const texts: { field: AdminTextField; text: string | null; status: string }[] = [
    {
      field: 'about_me',
      text: profile.lifestyle.about_me ?? null,
      status: profile.text_status.about_me,
    },
    {
      field: 'about_family',
      text: profile.family.about_family ?? null,
      status: profile.text_status.about_family,
    },
    {
      field: 'partner_notes',
      text: data.preferences?.notes ?? null,
      status: profile.text_status.partner_notes,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={name}
        description={t('profile.subtitle', { code: profile.public_code })}
        backTo="/admin/profiles"
        backLabel={t('profile.back')}
        actions={<StatusBadge status={profile.status} />}
      />

      {profile.status_reason ? (
        <StatusBanner variant="info" title={t('profile.status_reason')}>
          <PlainText text={profile.status_reason} />
        </StatusBanner>
      ) : null}
      {data.reports_against.some((report) => report.source === 'system') ? (
        <StatusBanner variant="warning" title={t('profile.system_report_title')}>
          {t('profile.system_report_text')}
        </StatusBanner>
      ) : null}

      <div
        role="toolbar"
        aria-label={t('profile.actions')}
        className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background py-2"
      >
        <Button
          loading={approve.isPending}
          disabled={!canDecide}
          aria-keyshortcuts="A"
          onClick={() => void doApprove().catch(() => undefined)}
        >
          <Check aria-hidden="true" />
          {t('profile.approve')}
          <kbd className="ms-1 text-xs opacity-80">A</kbd>
        </Button>
        <Button
          variant="secondary"
          disabled={!canDecide || approve.isPending}
          aria-keyshortcuts="C"
          onClick={openChanges}
        >
          <MessageSquareWarning aria-hidden="true" />
          {t('profile.request_changes.open')}
          <kbd className="ms-1 text-xs opacity-80">C</kbd>
        </Button>
        <Button variant="secondary" asChild aria-keyshortcuts="U">
          <Link to="/admin/users/$userId" params={{ userId: user.id }}>
            <UserRound aria-hidden="true" />
            {t('profile.open_account')}
            <kbd className="ms-1 text-xs opacity-80">U</kbd>
          </Link>
        </Button>
        {isAdmin ? (
          <Button
            variant="secondary"
            className="ms-auto"
            onClick={() => setDialog({ kind: 'locked' })}
          >
            {t('profile.locked.open')}
          </Button>
        ) : null}
        {!canDecide ? (
          <p className="text-sm text-muted-foreground">{t('profile.not_pending')}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title={t('profile.photos')}>
            {profile.photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('profile.no_photos')}</p>
            ) : (
              <ul className="grid grid-cols-4 gap-3">
                {profile.photos.map((photo) => (
                  <li key={photo.id} className="flex flex-col gap-1">
                    <AdminPhoto
                      photoId={photo.id}
                      url={photo.medium_url}
                      isPrimary={photo.is_primary}
                      name={name}
                      gender={profile.basics.gender ?? null}
                      size="medium"
                      width={160}
                      height={200}
                      className="aspect-[4/5] rounded-md"
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary">
                        {t(`photo.status.${photo.status}`, { defaultValue: photo.status })}
                      </Badge>
                      {photo.is_primary ? (
                        <Badge variant="outline">{t('photo.primary')}</Badge>
                      ) : null}
                    </div>
                    {photo.status === 'pending_review' || photo.status === 'approved' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDialog({ kind: 'photo', photoId: photo.id })}
                      >
                        {t('photo.reject')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t('profile.texts')}>
            <ul className="flex flex-col gap-3">
              {texts.map((item) => (
                <li
                  key={item.field}
                  className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t(`texts.field.${item.field}`)}</h3>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={item.status} />
                      {item.text && item.status !== 'rejected' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setDialog({ kind: 'text', field: item.field, text: item.text ?? '' })
                          }
                        >
                          {t('texts.reject')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {item.text ? (
                    <PlainText text={item.text} className="text-sm" />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('profile.no_text')}</p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          <ProfileSections profile={profile} />

          {data.preferences ? (
            <Facts
              title={t('profile.preferences')}
              columns={2}
              facts={[
                {
                  label: t('profile.pref.age'),
                  value: `${data.preferences.age_min} - ${data.preferences.age_max}`,
                },
                {
                  label: t('profile.pref.marital'),
                  value: data.preferences.marital_statuses
                    .map((code) => label('marital_status', code))
                    .join(', '),
                },
                {
                  label: t('profile.pref.discovery'),
                  value: t(`profile.privacy.${data.privacy.discovery_visibility}`),
                },
                {
                  label: t('profile.pref.photo_visibility'),
                  value: label('photo_visibility', data.privacy.photo_visibility),
                },
              ]}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Facts
            title={t('profile.account')}
            columns={1}
            facts={[
              {
                label: t('user.email'),
                value: user.email
                  ? `${user.email} (${user.email_verified ? t('user.verified') : t('user.unverified')})`
                  : null,
              },
              {
                label: t('user.phone'),
                value: user.phone_e164 ? formatPhone(user.phone_e164) : t('user.phone_hidden'),
              },
              { label: t('user.role'), value: <StatusBadge status={user.role} /> },
              { label: t('user.status'), value: <StatusBadge status={user.status} /> },
              { label: t('user.status_reason'), value: user.status_reason },
              {
                label: t('user.suspended_until'),
                value: user.suspended_until ? formatDate(user.suspended_until) : null,
              },
              { label: t('user.created'), value: formatDate(user.created_at) },
              {
                label: t('user.last_seen'),
                value: user.last_seen_at ? <RelativeTime value={user.last_seen_at} /> : null,
              },
              {
                label: t('profile.first_activated'),
                value: data.first_activated_at ? formatDate(data.first_activated_at) : null,
              },
              {
                label: t('profile.last_active'),
                value: data.last_active_at ? <RelativeTime value={data.last_active_at} /> : null,
              },
            ]}
          />
          <Facts
            title={t('profile.stats.title')}
            columns={2}
            facts={Object.entries(data.stats).map(([key, value]) => ({
              label: t(`profile.stats.${key}`),
              value,
            }))}
          />
          <Panel title={t('profile.checklist.title')}>
            <ol className="list-decimal space-y-1 ps-5 text-sm">
              {(t('profile.checklist.items', { returnObjects: true }) as string[]).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <Panel title={t('profile.sanctions')}>
        <SanctionsTable sanctions={data.sanctions} caption={t('profile.sanctions')} />
      </Panel>
      <Panel title={t('profile.verification_requests')}>
        {data.verification_requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('verifications.none_for_profile')}</p>
        ) : (
          <DataTable
            caption={t('profile.verification_requests')}
            rows={data.verification_requests}
            getKey={(request) => request.id}
            columns={[
              {
                id: 'kind',
                header: t('verifications.col.kind'),
                cell: (request) => (
                  <Link
                    to="/admin/verifications/$requestId"
                    params={{ requestId: request.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {t(`verifications.kind.${request.kind}`, { defaultValue: request.kind })}
                  </Link>
                ),
              },
              {
                id: 'status',
                header: t('verifications.col.status'),
                cell: (request) => <StatusBadge status={request.status} />,
              },
              {
                id: 'reason',
                header: t('verifications.col.reason'),
                cell: (request) =>
                  request.rejection_reason
                    ? label('verification_rejection_reason', request.rejection_reason)
                    : '-',
              },
              {
                id: 'created',
                header: t('verifications.col.created'),
                cell: (request) => <RelativeTime value={request.created_at} />,
              },
            ]}
          />
        )}
      </Panel>
      <Panel title={t('profile.reports_against')}>
        <ReportsTable reports={data.reports_against} caption={t('profile.reports_against')} />
        <p className="text-sm text-muted-foreground">
          {t('profile.reports_filed', data.reports_filed)}
        </p>
      </Panel>
      <Panel title={t('profile.audit')}>
        <AuditTable entries={data.audit} caption={t('profile.audit')} />
      </Panel>

      {dialog?.kind === 'changes' ? (
        <RequestChangesDialog
          profileId={profileId}
          onClose={() => setDialog(null)}
          onDone={() => {
            toast.success(t('profile.changes_requested', { name }))
            goAfterDecision(dialog.nextId)
          }}
        />
      ) : null}
      {dialog?.kind === 'locked' ? (
        <LockedFieldsDialog profile={data} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'photo' ? (
        <RejectPhotoDialog photoId={dialog.photoId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'text' ? (
        <RejectTextDialog
          profileId={profileId}
          field={dialog.field}
          text={dialog.text}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}
