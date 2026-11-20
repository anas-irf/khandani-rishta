// ADM-USER: one account, with sanctions, devices and history (18 sections 5.2 and 5.3).
import { Link } from '@tanstack/react-router'
import { Ban, Gavel, ShieldOff, TriangleAlert, UserCog } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { RelativeTime } from '~/components/common/RelativeTime'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button } from '~/components/ui/button'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Skeleton } from '~/components/ui/skeleton'
import { formatDate, formatPhone } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { useIsAdmin } from './access'
import { ActionDialog } from './components/ActionDialog'
import { DataTable } from './components/DataTable'
import { Facts, Panel } from './components/Facts'
import { FormField } from './components/FormField'
import { SanctionDialog, type SanctionKind } from './components/SanctionDialog'
import { StatusBadge } from './components/StatusBadge'
import { AuditTable, ReportsTable, SanctionsTable } from './components/Tables'
import { fullName } from './names'
import { useAdminUser, useChangeRole, useUnbanUser, useUnsuspendUser } from './queries'
import { useRouteId } from './search'
import type { AdminUser, RoleBody } from './types'

type Dialog =
  | { kind: 'sanction'; sanction: SanctionKind }
  | { kind: 'unsuspend' }
  | { kind: 'unban' }
  | { kind: 'role' }
  | null

export function UserScreen() {
  const { t } = useTranslation('admin')
  const userId = useRouteId('userId')
  const query = useAdminUser(userId)

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
  return <UserView data={query.data} />
}

function UserView({ data }: { data: AdminUser }) {
  const { t } = useTranslation('admin')
  const me = useCurrentMe()
  const isAdmin = useIsAdmin()
  const unsuspend = useUnsuspendUser()
  const unban = useUnbanUser()
  const [dialog, setDialog] = useState<Dialog>(null)

  const name = fullName(data.first_name, data.last_name, data.public_code)
  const isSelf = me.user.id === data.user_id
  const targetIsStaff = data.role === 'moderator' || data.role === 'admin'
  // A moderator cannot sanction staff and nobody can sanction themselves (18 section 5.3).
  const mayWarnOrSuspend = !isSelf && (isAdmin || !targetIsStaff)
  const isActive = data.status === 'active'
  const canWarn = isActive && mayWarnOrSuspend
  const canBan = (isActive || data.status === 'suspended') && !isSelf

  const sanctionKinds = (kind: SanctionKind): SanctionKind[] => [kind]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={data.email ?? name}
        description={t('user.subtitle', { name, code: data.public_code })}
        backTo="/admin/users"
        backLabel={t('user.back')}
        actions={
          <>
            <StatusBadge status={data.role} />
            <StatusBadge status={data.status} />
          </>
        }
      />

      {data.status_reason ? (
        <StatusBanner variant="warning" title={t('user.status_reason')}>
          {data.status_reason}
          {data.suspended_until ? (
            <>
              {' - '}
              {t('user.until', { date: formatDate(data.suspended_until) })}
            </>
          ) : null}
        </StatusBanner>
      ) : null}
      {data.flags.reporter_misuse ? (
        <StatusBanner variant="warning" icon={TriangleAlert}>
          {t('user.flag_misuse')}
        </StatusBanner>
      ) : null}
      {data.flags.shared_device_with_sanctioned_user ? (
        <StatusBanner variant="warning" icon={TriangleAlert}>
          {t('user.flag_shared_device')}
        </StatusBanner>
      ) : null}
      {isSelf ? <StatusBanner variant="info">{t('user.self')}</StatusBanner> : null}
      {!isSelf && targetIsStaff && !isAdmin ? (
        <StatusBanner variant="info">{t('user.staff_target')}</StatusBanner>
      ) : null}

      <div
        role="toolbar"
        aria-label={t('user.actions')}
        className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background py-2"
      >
        <Button
          variant="secondary"
          disabled={!canWarn}
          onClick={() => setDialog({ kind: 'sanction', sanction: 'warn' })}
        >
          <TriangleAlert aria-hidden="true" />
          {t('user.warn')}
        </Button>
        <Button
          variant="secondary"
          disabled={!canWarn}
          onClick={() => setDialog({ kind: 'sanction', sanction: 'suspend' })}
        >
          <Gavel aria-hidden="true" />
          {t('user.suspend')}
        </Button>
        <Button
          variant="secondary"
          disabled={data.status !== 'suspended'}
          onClick={() => setDialog({ kind: 'unsuspend' })}
        >
          <ShieldOff aria-hidden="true" />
          {t('user.unsuspend')}
        </Button>
        {isAdmin ? (
          <>
            <Button
              variant="destructive"
              disabled={!canBan}
              onClick={() => setDialog({ kind: 'sanction', sanction: 'ban' })}
            >
              <Ban aria-hidden="true" />
              {t('user.ban')}
            </Button>
            <Button
              variant="secondary"
              disabled={data.status !== 'banned'}
              onClick={() => setDialog({ kind: 'unban' })}
            >
              {t('user.unban')}
            </Button>
            <Button
              variant="secondary"
              disabled={isSelf || !isActive}
              onClick={() => setDialog({ kind: 'role' })}
            >
              <UserCog aria-hidden="true" />
              {t('user.change_role')}
            </Button>
          </>
        ) : null}
        <Button asChild variant="ghost" className="ms-auto">
          <Link to="/admin/profiles/$profileId" params={{ profileId: data.profile_id }}>
            {t('user.view_profile')}
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Facts
          title={t('user.account')}
          columns={2}
          facts={[
            {
              label: t('user.email'),
              value: data.email
                ? `${data.email} (${data.email_verified ? t('user.verified') : t('user.unverified')})`
                : null,
            },
            {
              label: t('user.phone'),
              value: data.phone_e164
                ? `${formatPhone(data.phone_e164)} (${data.phone_verified ? t('user.verified') : t('user.unverified')})`
                : t('user.phone_hidden'),
            },
            { label: t('user.role'), value: <StatusBadge status={data.role} /> },
            { label: t('user.status'), value: <StatusBadge status={data.status} /> },
            {
              label: t('user.profile_status'),
              value: <StatusBadge status={data.profile_status} />,
            },
            { label: t('user.locale'), value: data.locale },
            { label: t('user.created'), value: formatDate(data.created_at) },
            {
              label: t('user.last_seen'),
              value: data.last_seen_at ? <RelativeTime value={data.last_seen_at} /> : null,
            },
            {
              label: t('user.deletion_requested'),
              value: data.deletion_requested_at ? formatDate(data.deletion_requested_at) : null,
            },
            {
              label: t('user.purge_after'),
              value: data.purge_after ? formatDate(data.purge_after) : null,
            },
          ]}
        />
        <div className="flex flex-col gap-4">
          <Facts
            title={t('user.flags')}
            columns={1}
            facts={[
              {
                label: t('user.flag_misuse_label'),
                value: data.flags.reporter_misuse ? t('common.yes') : t('common.no'),
              },
              { label: t('user.flag_money'), value: data.flags.money_flags_30d },
              {
                label: t('user.flag_shared_device_label'),
                value: data.flags.shared_device_with_sanctioned_user
                  ? t('common.yes')
                  : t('common.no'),
              },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            {t('user.reports_filed', data.reports_filed)}
          </p>
        </div>
      </div>

      <Panel title={t('user.sanctions')}>
        <SanctionsTable sanctions={data.sanctions} caption={t('user.sanctions')} />
      </Panel>
      <Panel title={t('user.devices')}>
        {data.devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('user.no_devices')}</p>
        ) : (
          <DataTable
            caption={t('user.devices')}
            rows={data.devices}
            getKey={(device) => `${device.platform}-${device.device_model}-${device.last_seen_at}`}
            columns={[
              { id: 'platform', header: t('user.col.platform'), cell: (device) => device.platform },
              {
                id: 'model',
                header: t('user.col.model'),
                cell: (device) => device.device_model ?? '-',
              },
              {
                id: 'version',
                header: t('user.col.version'),
                cell: (device) => device.app_version ?? '-',
              },
              {
                id: 'seen',
                header: t('user.col.seen'),
                cell: (device) => <RelativeTime value={device.last_seen_at} />,
              },
            ]}
          />
        )}
      </Panel>
      <Panel title={t('user.consents')}>
        {data.consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('user.no_consents')}</p>
        ) : (
          <DataTable
            caption={t('user.consents')}
            rows={data.consents}
            getKey={(consent) => `${consent.document}-${consent.version}`}
            columns={[
              {
                id: 'document',
                header: t('user.col.document'),
                cell: (consent) => consent.document,
              },
              {
                id: 'version',
                header: t('user.col.consent_version'),
                cell: (consent) => consent.version,
              },
              {
                id: 'accepted',
                header: t('user.col.accepted'),
                cell: (consent) => formatDate(consent.accepted_at),
              },
            ]}
          />
        )}
      </Panel>
      <Panel title={t('user.reports_against')}>
        <ReportsTable reports={data.reports_against} caption={t('user.reports_against')} />
      </Panel>
      <Panel title={t('user.audit')}>
        <AuditTable entries={data.audit} caption={t('user.audit')} />
      </Panel>

      {dialog?.kind === 'sanction' ? (
        <SanctionDialog
          userId={data.user_id}
          publicCode={data.public_code}
          kinds={sanctionKinds(dialog.sanction)}
          onClose={() => setDialog(null)}
          onDone={(kind) => toast.success(t(`sanctions.done.${kind}`))}
        />
      ) : null}
      {dialog?.kind === 'unsuspend' ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={t('user.unsuspend_title')}
          description={t('user.unsuspend_text')}
          confirmLabel={t('user.unsuspend')}
          onConfirm={async () => {
            await unsuspend.mutateAsync({ userId: data.user_id })
            toast.success(t('sanctions.done.unsuspend'))
          }}
        />
      ) : null}
      {dialog?.kind === 'unban' ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={t('user.unban_title')}
          description={t('user.unban_text')}
          confirmLabel={t('user.unban')}
          onConfirm={async () => {
            await unban.mutateAsync({ userId: data.user_id })
            toast.success(t('sanctions.done.unban'))
          }}
        />
      ) : null}
      {dialog?.kind === 'role' ? <RoleDialog user={data} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

function RoleDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation('admin')
  const change = useChangeRole()
  const [role, setRole] = useState<RoleBody['role']>(
    user.role === 'moderator' || user.role === 'admin' ? user.role : 'member',
  )

  return (
    <ActionDialog
      title={t('user.role_title')}
      description={t('user.role_description')}
      submitLabel={t('user.role_submit')}
      canSubmit={role !== user.role}
      onSubmit={async () => {
        await change.mutateAsync({ userId: user.user_id, role })
        toast.success(t('user.role_done', { role: t(`role.${role}`) }))
      }}
      onClose={onClose}
    >
      <FormField label={t('user.role')}>
        {(props) => (
          <NativeSelect
            {...props}
            value={role}
            onChange={(event) => setRole(event.target.value as RoleBody['role'])}
          >
            {(['member', 'moderator', 'admin'] as const).map((option) => (
              <NativeSelectOption key={option} value={option}>
                {t(`role.${option}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
    </ActionDialog>
  )
}
