// ME-VERIFY (16 section 6.21, 12 section 8.1)
import { Link } from '@tanstack/react-router'
import { BadgeCheck, ChevronDown, IdCard } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import type { VerificationKind, VerificationRequest, Verifications } from '~/lib/api-types'
import { formatDate, formatLongDate } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { useLabelOf } from '~/lib/reference'
import { cn } from '~/lib/utils'
import { useRejectionText, withoutFinalStop } from './copy'
import { useCancelVerification, useVerifications } from './queries'

type RowState = 'verified' | 'pending' | 'rejected' | 'not_started' | 'number_added' | 'no_photo'

/** The newest request of a kind: the first entry of `requests` with it (16 section 6.21). */
export function newestRequest(
  requests: readonly VerificationRequest[],
  kind: VerificationKind,
): VerificationRequest | null {
  return requests.find((request) => request.kind === kind) ?? null
}

/** Row "Identity document": the conditions of 16 section 6.21, top to bottom. */
export function identityRowState(data: Verifications): RowState {
  if (data.id_verified) return 'verified'
  const newest = newestRequest(data.requests, 'id_document')
  if (newest?.status === 'pending') return 'pending'
  if (newest?.status === 'rejected') return 'rejected'
  if (data.identity === null) return 'not_started'
  return 'number_added'
}

/** Row "Photo check": the conditions of 16 section 6.21, top to bottom. */
export function photoRowState(data: Verifications, hasApprovedPhoto: boolean): RowState {
  if (data.photo_verified) return 'verified'
  const newest = newestRequest(data.requests, 'selfie')
  if (newest?.status === 'pending') return 'pending'
  if (newest?.status === 'rejected') return 'rejected'
  if (!hasApprovedPhoto) return 'no_photo'
  return 'not_started'
}

/**
 * The verification centre: what is verified, what is pending, and how to verify the rest.
 * Refetched on open and when returning from a sub-screen.
 */
export function VerificationCentreScreen() {
  const { t } = useTranslation('verification')
  const verifications = useVerifications()

  return (
    <div className="container-app flex max-w-2xl flex-col gap-4">
      <PageHeader title={t('centre.title')} showBack />
      <p>{t('centre.intro')}</p>
      {verifications.isPending ? (
        <RowsSkeleton />
      ) : verifications.isError ? (
        <ErrorState
          error={verifications.error}
          onRetry={() => void verifications.refetch()}
          retrying={verifications.isFetching}
        />
      ) : (
        <Centre data={verifications.data} />
      )}
    </div>
  )
}

function Centre({ data }: { data: Verifications }) {
  const { t } = useTranslation('verification')
  const me = useCurrentMe()
  const label = useLabelOf()
  const rejectionText = useRejectionText()
  const cancel = useCancelVerification()
  const [cancelTarget, setCancelTarget] = useState<VerificationRequest | null>(null)
  const closed = me.profile.status === 'closed'
  const identityState = identityRowState(data)
  const photoState = photoRowState(data, me.profile.photo !== null)
  const newestId = newestRequest(data.requests, 'id_document')
  const newestSelfie = newestRequest(data.requests, 'selfie')
  const identity = data.identity
  const canChangeNumber =
    identity !== null && (identity.status === 'unverified' || identity.status === 'rejected')

  const rejected = (request: VerificationRequest | null) =>
    withoutFinalStop(rejectionText(request?.rejection_reason ?? null))

  const identityText: Record<RowState, string> = {
    verified: identity?.verified_at
      ? t('centre.identity.verified', { date: formatLongDate(identity.verified_at) })
      : t('centre.identity.verified_no_date'),
    pending: t('centre.identity.pending'),
    rejected: t('centre.identity.rejected', { reason: rejected(newestId) }),
    not_started: t('centre.identity.not_started'),
    number_added: t('centre.identity.number_added'),
    no_photo: '',
  }
  const photoText: Record<RowState, string> = {
    verified: t('centre.photo.verified'),
    pending: t('centre.photo.pending'),
    rejected: t('centre.photo.rejected', { reason: rejected(newestSelfie) }),
    not_started: t('centre.photo.not_started'),
    number_added: '',
    no_photo: t('centre.photo.no_photo'),
  }

  const cancelButton = (request: VerificationRequest | null) =>
    request ? (
      <Button variant="secondary" onClick={() => setCancelTarget(request)}>
        {t('centre.cancel.action')}
      </Button>
    ) : null

  const identityControl: ReactNode = {
    verified: null,
    pending: cancelButton(newestId),
    rejected: closed ? null : (
      <LinkButton to="/me/verification/identity">{t('centre.identity.try_again')}</LinkButton>
    ),
    not_started: closed ? null : (
      <LinkButton to="/me/verification/identity">{t('centre.identity.start')}</LinkButton>
    ),
    number_added: closed ? null : (
      <>
        <LinkButton to="/me/verification/identity">{t('centre.identity.upload')}</LinkButton>
        {canChangeNumber ? (
          <Button asChild variant="link" className="px-0">
            <Link to="/me/verification/identity" search={{ change: true }}>
              {t('centre.identity.change_number')}
            </Link>
          </Button>
        ) : null}
      </>
    ),
    no_photo: null,
  }[identityState]

  const photoControl: ReactNode = {
    verified: null,
    pending: cancelButton(newestSelfie),
    rejected: closed ? null : (
      <LinkButton to="/me/verification/selfie">{t('centre.photo.try_again')}</LinkButton>
    ),
    not_started: closed ? null : (
      <LinkButton to="/me/verification/selfie">{t('centre.photo.take_selfie')}</LinkButton>
    ),
    number_added: null,
    no_photo: <LinkButton to="/me/photos">{t('centre.photo.add_photo')}</LinkButton>,
  }[photoState]

  return (
    <>
      {closed ? (
        <p role="status" className="rounded-[var(--radius-input)] bg-muted p-3">
          {t('centre.closed')}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        <Row
          icon={<IdCard aria-hidden="true" className="size-6" />}
          title={t('centre.identity.title')}
          state={identityState}
          text={identityText[identityState]}
          detail={
            identity
              ? t('centre.identity.document', {
                  type: label('document_type', identity.document_type),
                  number: identity.number_masked,
                })
              : null
          }
          control={identityControl}
        />
        <Row
          icon={<BadgeCheck aria-hidden="true" className="size-6" />}
          title={t('centre.photo.title')}
          state={photoState}
          text={photoText[photoState]}
          control={photoControl}
        />
      </ul>
      <p className="text-sm text-muted-foreground">{t('centre.footer')}</p>
      <History requests={data.requests} rejected={rejectionText} />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
        title={t('centre.cancel.title')}
        description={t('centre.cancel.description')}
        confirmLabel={t('centre.cancel.confirm')}
        cancelLabel={t('centre.cancel.keep')}
        destructive
        onConfirm={async () => {
          if (!cancelTarget) return
          await cancel.mutateAsync(cancelTarget.id)
          toast.success(t('centre.cancel.done'))
        }}
      />
    </>
  )
}

function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button asChild>
      <Link to={to}>{children}</Link>
    </Button>
  )
}

const STATE_TONE: Record<RowState, string> = {
  verified: 'text-success',
  pending: 'text-warning',
  rejected: 'text-danger',
  not_started: 'text-muted-foreground',
  number_added: 'text-muted-foreground',
  no_photo: 'text-muted-foreground',
}

function Row({
  icon,
  title,
  state,
  text,
  detail,
  control,
}: {
  icon: ReactNode
  title: string
  state: RowState
  text: string
  detail?: string | null
  control: ReactNode
}) {
  const headingId = useId()
  return (
    <li
      aria-labelledby={headingId}
      data-row-state={state}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 shrink-0', STATE_TONE[state])}>{icon}</span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="font-semibold">
            {title}
          </h2>
          <p>{text}</p>
          {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
        </div>
      </div>
      {control ? <div className="flex flex-wrap items-center gap-3 ps-9">{control}</div> : null}
    </li>
  )
}

/** "Past requests": kind, status, date and the rejection message; never `reviewer_note`. */
function History({
  requests,
  rejected,
}: {
  requests: readonly VerificationRequest[]
  rejected: (reason: string | null) => string
}) {
  const { t } = useTranslation('verification')
  const [open, setOpen] = useState(false)
  const listId = useId()
  return (
    <section className="flex flex-col gap-2">
      <Button
        variant="ghost"
        className="-ms-3 self-start"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn('transition-transform', open && 'rotate-180')}
        />
        {t('centre.history.toggle')}
      </Button>
      <div id={listId} hidden={!open}>
        {requests.length === 0 ? (
          <p className="text-muted-foreground">{t('centre.history.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requests.map((request) => (
              <li
                key={request.id}
                className="rounded-[var(--radius-input)] border border-border bg-surface p-3"
              >
                <p>
                  {t('centre.history.line', {
                    kind: t(`centre.history.kind.${request.kind}`),
                    status: t(`centre.history.status.${request.status}`),
                    date: formatDate(request.reviewed_at ?? request.created_at),
                  })}
                </p>
                {request.status === 'rejected' ? (
                  <p className="text-sm text-muted-foreground">
                    {rejected(request.rejection_reason)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function RowsSkeleton() {
  const { t } = useTranslation('verification')
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{t('centre.loading')}</span>
      {[0, 1].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-11 w-32" />
        </div>
      ))}
    </div>
  )
}
