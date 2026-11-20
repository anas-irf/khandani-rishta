// ADM-VERIFICATION: one verification request, with the images and the data to compare (18 section 4.4).
import { useNavigate } from '@tanstack/react-router'
import { Check, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { RelativeTime } from '~/components/common/RelativeTime'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Skeleton } from '~/components/ui/skeleton'
import { Textarea } from '~/components/ui/textarea'
import { formatDate } from '~/lib/format'
import { useLabelOf, useOptions } from '~/lib/reference'
import { ActionDialog } from './components/ActionDialog'
import { AdminPhoto } from './components/AdminPhoto'
import { DataTable } from './components/DataTable'
import { Facts, Panel } from './components/Facts'
import { FormField } from './components/FormField'
import { SanctionDialog } from './components/SanctionDialog'
import { StatusBadge } from './components/StatusBadge'
import { ErrorSummary, useDialogErrors } from './components/useDialogErrors'
import { ZoomableImage } from './components/ZoomableImage'
import { validate } from './forms'
import { fullName } from './names'
import {
  adminKeys,
  useAdminProfile,
  useAdminVerification,
  useApproveVerification,
  useRejectVerification,
} from './queries'
import { verificationRejectSchema } from './schemas'
import { useRouteId } from './search'
import { useQueueNeighbours } from './selection'
import { useShortcuts } from './shortcuts'
import type { AdminVerificationDetail, AdminVerificationListItem } from './types'

export function VerificationScreen() {
  const { t } = useTranslation('admin')
  const requestId = useRouteId('requestId')
  const query = useAdminVerification(requestId)

  if (query.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{t('list.loading')}</span>
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  return (
    <VerificationView
      key={query.data.request_id}
      data={query.data}
      reloading={query.isFetching}
      onReload={() => void query.refetch()}
    />
  )
}

type Underage = { kind: 'rejected_underage' } | null

function VerificationView({
  data,
  reloading,
  onReload,
}: {
  data: AdminVerificationDetail
  reloading: boolean
  onReload: () => void
}) {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  const navigate = useNavigate()
  const approve = useApproveVerification()
  const [checked, setChecked] = useState<boolean[]>([])
  const [rejecting, setRejecting] = useState(false)
  const [suspending, setSuspending] = useState(false)
  const [underage, setUnderage] = useState<Underage>(null)

  const checklist = t(`verification.checklist.${data.kind}`, { returnObjects: true }) as string[]
  const allChecked = checklist.length > 0 && checklist.every((_, index) => checked[index])
  const pending = data.status === 'pending'
  const { profile, identity, images } = data
  const name = fullName(profile.first_name, profile.last_name, profile.public_code)

  const openRequest = (id: string) =>
    void navigate({ to: '/admin/verifications/$requestId', params: { requestId: id } })
  const neighbours = useQueueNeighbours<AdminVerificationListItem>({
    listKey: adminKeys.verificationList({ status: 'pending' }),
    getId: (item) => item.request_id,
    currentId: data.request_id,
    open: openRequest,
  })
  const goAfterDecision = (nextId: string | null) => {
    if (nextId) openRequest(nextId)
    else void navigate({ to: '/admin/verifications' })
  }

  const doApprove = async () => {
    if (!pending || !allChecked || approve.isPending) return
    const { next } = neighbours()
    await approve.mutateAsync({
      requestId: data.request_id,
      // Check 10 (the selfie matches the profile photos) needs approved photos to compare.
      ...(data.kind === 'id_document' ? { photos_match: profile.photos.length > 0 } : {}),
    })
    toast.success(t('verification.approved', { name }))
    goAfterDecision(next)
  }
  const approveNow = () => void doApprove().catch(() => undefined)

  // The user id for the suspension dialog comes from the profile, fetched only when needed.
  const profileQuery = useAdminProfile(profile.profile_id, { enabled: suspending })

  useShortcuts(
    {
      a: pending && allChecked ? approveNow : undefined,
      r: pending ? () => setRejecting(true) : undefined,
    },
    !rejecting && !suspending,
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('verification.title', { name })}
        description={
          <>
            {t(`verifications.kind.${data.kind}`)}
            {' - '}
            {t('verification.submitted')} <RelativeTime value={data.created_at} />
          </>
        }
        backTo="/admin/verifications"
        backLabel={t('verification.back')}
        actions={<StatusBadge status={data.status} />}
      />

      {data.media_purged ? (
        <StatusBanner variant="info">{t('verification.purged')}</StatusBanner>
      ) : null}
      {!pending ? <StatusBanner variant="info">{t('verification.decided')}</StatusBanner> : null}
      {!data.gesture_valid ? (
        <StatusBanner variant="danger">{t('verification.gesture_invalid')}</StatusBanner>
      ) : null}
      {underage ? (
        <StatusBanner
          variant="warning"
          title={t('verification.underage_title')}
          action={
            <Button variant="destructive" onClick={() => setSuspending(true)}>
              <ShieldAlert aria-hidden="true" />
              {t('verification.suspend_now')}
            </Button>
          }
        >
          {t('verification.underage_text')}
        </StatusBanner>
      ) : null}

      <div className="grid grid-cols-2 items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t('verification.images')}</h2>
            <Button variant="secondary" size="sm" loading={reloading} onClick={onReload}>
              {t('image.reload_all')}
            </Button>
          </div>
          {data.kind === 'id_document' ? (
            <>
              <ZoomableImage
                src={images.front_url}
                alt={t('verification.image.front')}
                label={t('verification.image.front')}
                onReload={onReload}
              />
              <ZoomableImage
                src={images.back_url}
                alt={t('verification.image.back')}
                label={t('verification.image.back')}
                onReload={onReload}
              />
            </>
          ) : null}
          <ZoomableImage
            src={images.selfie_url}
            alt={t('verification.image.selfie')}
            label={t('verification.image.selfie')}
            onReload={onReload}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Facts
            title={t('verification.submission')}
            columns={2}
            facts={[
              {
                label: t('verification.gesture'),
                value: t(`verification.gesture_name.${data.gesture}`, {
                  defaultValue: data.gesture,
                }),
              },
              {
                label: t('verification.gesture_check'),
                value: data.gesture_valid
                  ? t('verification.gesture_ok')
                  : t('verification.gesture_bad'),
              },
            ]}
          />
          {identity ? (
            <Facts
              title={t('verification.identity')}
              columns={1}
              facts={[
                {
                  label: t('verification.document_type'),
                  value: label('document_type', identity.document_type),
                },
                {
                  label: t('verification.number'),
                  value: (
                    <span dir="ltr" className="font-mono text-base tracking-wide">
                      {identity.number}
                    </span>
                  ),
                },
                {
                  label: t('verification.identity_status'),
                  value: <StatusBadge status={identity.status} />,
                },
              ]}
            />
          ) : null}
          <Facts
            title={t('verification.profile')}
            columns={2}
            facts={[
              { label: t('profile.field.first_name'), value: profile.first_name },
              { label: t('profile.field.last_name'), value: profile.last_name },
              {
                label: t('profile.field.gender'),
                value: profile.gender ? label('gender', profile.gender) : null,
              },
              {
                label: t('profile.field.date_of_birth'),
                value: profile.date_of_birth
                  ? `${formatDate(profile.date_of_birth)}${profile.age !== null ? ` (${profile.age})` : ''}`
                  : null,
              },
              {
                label: t('profile.field.marital_status'),
                value: profile.marital_status
                  ? label('marital_status', profile.marital_status)
                  : null,
              },
              {
                label: t('profile.field.managed_by'),
                value: profile.managed_by ? label('managed_by', profile.managed_by) : null,
              },
              { label: t('profile.field.manager_name'), value: profile.manager_name },
            ]}
          />
          <Panel title={t('verification.approved_photos')}>
            {profile.photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('verification.no_photos')}</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {profile.photos.map((photo) => (
                  <li key={photo.photo_id}>
                    <AdminPhoto
                      photoId={photo.photo_id}
                      url={photo.large_url}
                      isPrimary={photo.is_primary}
                      name={name}
                      gender={profile.gender}
                      size="medium"
                      width={120}
                      height={150}
                      className="aspect-[4/5] rounded-md"
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title={t('verification.checklist_title')}>
        <fieldset className="grid gap-1" disabled={!pending}>
          <legend className="sr-only">{t('verification.checklist_title')}</legend>
          {checklist.map((item, index) => (
            <label
              key={item}
              htmlFor={`${data.request_id}-check-${index}`}
              className="flex min-h-11 items-start gap-3 py-1 text-sm"
            >
              <Checkbox
                id={`${data.request_id}-check-${index}`}
                checked={Boolean(checked[index])}
                onCheckedChange={(value) =>
                  setChecked((previous) => {
                    const next = [...previous]
                    next[index] = value === true
                    return next
                  })
                }
              />
              <span>
                {data.kind === 'id_document' ? (
                  <span className="text-muted-foreground">{index + 1}. </span>
                ) : null}
                {item}
              </span>
            </label>
          ))}
        </fieldset>
        <div
          role="toolbar"
          aria-label={t('verification.decision')}
          className="flex flex-wrap items-center gap-2"
        >
          <Button
            loading={approve.isPending}
            disabled={!pending || !allChecked}
            aria-keyshortcuts="A"
            onClick={approveNow}
          >
            <Check aria-hidden="true" />
            {t('verification.approve')}
            <kbd className="ms-1 text-xs opacity-80">A</kbd>
          </Button>
          <Button
            variant="secondary"
            disabled={!pending || approve.isPending}
            aria-keyshortcuts="R"
            onClick={() => setRejecting(true)}
          >
            <X aria-hidden="true" />
            {t('verification.reject')}
            <kbd className="ms-1 text-xs opacity-80">R</kbd>
          </Button>
          {pending && !allChecked ? (
            <p className="text-sm text-muted-foreground">{t('verification.tick_all')}</p>
          ) : null}
        </div>
      </Panel>

      <Panel title={t('verification.previous')}>
        {data.previous_requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('verification.no_previous')}</p>
        ) : (
          <DataTable
            caption={t('verification.previous')}
            rows={data.previous_requests}
            getKey={(request) => request.id}
            columns={[
              {
                id: 'kind',
                header: t('verifications.col.kind'),
                cell: (request) =>
                  t(`verifications.kind.${request.kind}`, { defaultValue: request.kind }),
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

      {rejecting ? (
        <RejectVerificationDialog
          requestId={data.request_id}
          onClose={() => setRejecting(false)}
          onDone={(reason, next) => {
            toast.success(t('verification.rejected', { name }))
            if (reason === 'underage') setUnderage({ kind: 'rejected_underage' })
            else goAfterDecision(next)
          }}
          nextId={neighbours().next}
        />
      ) : null}
      {suspending && profileQuery.data ? (
        <SanctionDialog
          userId={profileQuery.data.user.id}
          publicCode={profile.public_code}
          kinds={['suspend']}
          initialReason={t('verification.underage_reason')}
          onClose={() => setSuspending(false)}
          onDone={() => {
            toast.success(t('sanctions.done.suspend'))
            goAfterDecision(null)
          }}
        />
      ) : null}
    </div>
  )
}

function RejectVerificationDialog({
  requestId,
  nextId,
  onDone,
  onClose,
}: {
  requestId: string
  /** The next request of the queue, noted before the decision removes this one. */
  nextId: string | null
  onDone: (reason: string, nextId: string | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const reasons = useOptions('verification_rejection_reason')
  const reject = useRejectVerification()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const form = useDialogErrors(['reason', 'note'])

  const submit = async () => {
    const result = validate(verificationRejectSchema, { reason, note }, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    try {
      await reject.mutateAsync({
        requestId,
        reason: result.data.reason,
        note: result.data.note || undefined,
      })
    } catch (error) {
      form.fail(error)
      throw error
    }
    onDone(result.data.reason, nextId)
  }

  return (
    <ActionDialog
      title={t('verification.reject_title')}
      description={t('verification.reject_description')}
      submitLabel={t('verification.reject')}
      destructive
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      <FormField label={t('verification.reject_reason')} error={form.errors.reason}>
        {(props) => (
          <NativeSelect
            {...props}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <NativeSelectOption value="">{t('form.choose')}</NativeSelectOption>
            {reasons.map((option) => (
              <NativeSelectOption key={option.code} value={option.code}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        label={t('verification.note_label')}
        hint={t('verification.note_hint')}
        error={form.errors.note}
      >
        {(props) => (
          <Textarea
            {...props}
            name="note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </FormField>
    </ActionDialog>
  )
}
