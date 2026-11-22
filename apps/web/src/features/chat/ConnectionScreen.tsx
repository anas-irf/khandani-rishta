// APP-CONNECTION (16 section 6.12)
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Mail, MessageCircle, Phone, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Band } from '~/components/common/Band'
import { BlockDialog } from '~/components/common/BlockDialog'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { DefinitionList, DefinitionRow } from '~/components/common/DefinitionList'
import { ErrorState } from '~/components/common/ErrorState'
import { LinkRow } from '~/components/common/LinkRow'
import { NoLongerAvailable } from '~/components/common/NoLongerAvailable'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { PlainText } from '~/components/common/PlainText'
import { ProfileCard } from '~/components/common/ProfileCard'
import { ReportDialog } from '~/components/common/ReportDialog'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { SectionCard } from '~/components/common/SectionCard'
import { SwitchRow } from '~/components/common/SwitchRow'
import { Button } from '~/components/ui/button'
import { useOwnProfile } from '~/features/profile-sections/queries'
import { isApiError } from '~/lib/api'
import type { Connection, ContactShareBody, SharedContact } from '~/lib/api-types'
import { formatLongDate, formatPhone } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { useLabelOf } from '~/lib/reference'
import { OtherAvatar } from './ChatsScreen'
import {
  ContactShareDialog,
  SHARE_ITEMS,
  takeSavedSelection,
  useContactValue,
} from './ContactShareDialog'
import { EndConnectionDialog } from './EndConnectionDialog'
import { forgetConnection, useConnection, usePatchConnection, useStopSharing } from './queries'
import { readShareHint, StageBlock, StageFollowUps, writeShareHint } from './stage'
import { otherName } from './text'

export function ConnectionScreen({ connectionId }: { connectionId: string }) {
  return (
    <ScreenAccess screen="APP-CONNECTION">
      <ConnectionDetails key={connectionId} connectionId={connectionId} />
    </ScreenAccess>
  )
}

function ConnectionDetails({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation('chat')
  const queryClient = useQueryClient()
  const connection = useConnection(connectionId)
  const notFound = isApiError(connection.error) && connection.error.code === 'not_found'
  useEffect(() => {
    if (notFound) forgetConnection(queryClient, connectionId)
  }, [notFound, queryClient, connectionId])

  if (connection.data && !notFound) return <ConnectionContent connection={connection.data} />
  return (
    <Page title={t('connection.title')} backTo={`/chats/${connectionId}`} width="column">
      {connection.isPending ? (
        <DetailsSkeleton />
      ) : notFound ? (
        <NoLongerAvailable />
      ) : (
        <ErrorState
          error={connection.error}
          onRetry={() => void connection.refetch()}
          retrying={connection.isFetching}
        />
      )}
    </Page>
  )
}

function DetailsSkeleton() {
  const { t } = useTranslation('shared')
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{t('list.loading')}</span>
      {['h-28', 'h-40', 'h-32', 'h-24'].map((height) => (
        <div key={height} className={`skeleton w-full rounded-card ${height}`} />
      ))}
    </div>
  )
}

function ConnectionContent({ connection }: { connection: Connection }) {
  const { t } = useTranslation(['chat', 'shared'])
  const me = useCurrentMe()
  const label = useLabelOf()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const name = otherName(t, connection)
  const active = connection.status === 'active'
  const canEngage = me.profile.status === 'active' || me.profile.status === 'paused'
  const [endOpen, setEndOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const backToList = () => void navigate({ to: '/chats' })

  const member = (
    <section aria-label={name} className="flex flex-col items-start gap-1">
      {connection.other ? (
        <ProfileCard
          card={connection.other}
          size="compact"
          headingLevel="h2"
          className="self-stretch"
          actions={
            <Button asChild variant="quiet" size="compact">
              <Link to="/profiles/$profileId" params={{ profileId: connection.other.id }}>
                {t('chat:connection.view_profile')}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex max-w-full items-center gap-4 py-3">
          <OtherAvatar connection={connection} size="lg" />
          <h2 className="min-w-0 text-title-md font-bold">{name}</h2>
        </div>
      )}
      <p className="text-caption text-muted-foreground">
        {t('chat:connection.connected_since', { date: formatLongDate(connection.created_at) })}
      </p>
    </section>
  )

  return (
    <Page
      title={t('chat:connection.title')}
      backTo={`/chats/${connection.id}`}
      width="column"
      layout="bands"
      header={member}
    >
      {active ? (
        <>
          <Band tone="auto" as="div" width="column">
            <SectionCard title={t('chat:stage.title')}>
              <StageBlock connection={connection} canEngage={canEngage} />
            </SectionCard>
          </Band>
          <Band tone="auto" as="div" width="column">
            <MyContactCard connection={connection} name={name} canEngage={canEngage} />
          </Band>
          <Band tone="auto" as="div" width="column">
            <TheirContactCard connection={connection} name={name} />
          </Band>
          <Band tone="auto" as="div" width="column">
            <ChatSettingsCard connection={connection} />
          </Band>
        </>
      ) : (
        <Band tone="auto" as="div" width="column">
          <div className="tonal rounded-xl px-5 py-4" role="status">
            <p>
              {t('chat:connection.ended_on', {
                date: formatLongDate(connection.ended_at ?? connection.created_at),
              })}
            </p>
            {connection.ended_by === 'me' && connection.ended_reason ? (
              <p className="mt-1 text-body-sm text-foreground-secondary">
                {t('chat:connection.ended_reason', {
                  reason: label('connection_end_reason', connection.ended_reason),
                })}
              </p>
            ) : null}
          </div>
        </Band>
      )}

      <Band tone="auto" as="div" width="column">
        <SectionCard title={t('chat:connection.help.title')}>
          <ul className="flex flex-col">
            <li className="border-b border-border">
              <LinkRow to="/safety" label={t('chat:connection.help.safety')} />
            </li>
            <li className="border-b border-border">
              <LinkRow to="/nikah-guide" label={t('chat:connection.help.nikah')} />
            </li>
          </ul>
        </SectionCard>
      </Band>

      <Band
        tone="auto"
        width="column"
        aria-label={t('chat:connection.actions_label')}
        innerClassName="flex flex-wrap gap-3"
      >
        {active ? (
          <Button variant="destructive" onClick={() => setEndOpen(true)} disabled={!online}>
            {t('chat:chat.end')}
          </Button>
        ) : null}
        {connection.other ? (
          <>
            <Button variant="secondary" onClick={() => setReportOpen(true)} disabled={!online}>
              {t('chat:chat.report')}
            </Button>
            <Button variant="secondary" onClick={() => setBlockOpen(true)} disabled={!online}>
              {t('chat:chat.block')}
            </Button>
          </>
        ) : null}
      </Band>

      <EndConnectionDialog
        connection={connection}
        open={endOpen}
        onOpenChange={setEndOpen}
        onEnded={backToList}
      />
      {connection.other ? (
        <>
          <ReportDialog
            open={reportOpen}
            onOpenChange={setReportOpen}
            profileId={connection.other.id}
            name={name}
            onBlocked={backToList}
          />
          <BlockDialog
            open={blockOpen}
            onOpenChange={setBlockOpen}
            profileId={connection.other.id}
            name={name}
            onBlocked={backToList}
          />
        </>
      ) : null}
      <StageFollowUps connection={connection} />
    </Page>
  )
}

function MyContactCard({
  connection,
  name,
  canEngage,
}: {
  connection: Connection
  name: string
  canEngage: boolean
}) {
  const { t } = useTranslation('chat')
  const profile = useOwnProfile()
  const contactValue = useContactValue()
  const stop = useStopSharing()
  const online = useOnlineStatus()
  const [restored] = useState(() => takeSavedSelection(connection.id))
  const [shareOpen, setShareOpen] = useState(restored !== null)
  const [initial, setInitial] = useState<ContactShareBody | null>(restored)
  const [stopOpen, setStopOpen] = useState(false)
  const [hint, setHint] = useState(() => readShareHint(connection.id))
  const share = connection.my_contact_share
  const sharing = share?.status === 'active'

  // The "families_talking" follow-up may start while the screen is open.
  useEffect(() => {
    if (connection.stage !== 'chatting') setHint(readShareHint(connection.id))
  }, [connection.stage, connection.id])

  const openShare = () => {
    setInitial(null)
    setShareOpen(true)
  }
  const dismissHint = () => {
    writeShareHint(connection.id, 'done')
    setHint('done')
  }

  return (
    <SectionCard title={t('connection.my_contact.title')}>
      <div className="flex flex-col gap-3">
        {hint === 'pending' && !sharing && canEngage ? (
          <div className="relative flex flex-col gap-3 rounded-lg bg-primary-soft p-[16px] pe-[56px]">
            <p>{t('stage.share_hint')}</p>
            <Button className="self-start" onClick={openShare} disabled={!online}>
              {t('connection.my_contact.share')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 end-1"
              aria-label={t('connection.my_contact.dismiss_hint')}
              onClick={dismissHint}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        {sharing && share ? (
          <>
            <p>{t('connection.my_contact.sharing')}</p>
            <DefinitionList>
              {SHARE_ITEMS.filter((item) => share[item.key]).map((item) => {
                const value = profile.data ? contactValue(profile.data.contacts, item.key) : null
                return (
                  <DefinitionRow key={item.key} label={t(`connection.item.${item.label}`)}>
                    {value ?? ''}
                  </DefinitionRow>
                )
              })}
            </DefinitionList>
            <div className="flex flex-wrap gap-2">
              {canEngage ? (
                <Button variant="secondary" onClick={openShare} disabled={!online}>
                  {t('connection.my_contact.change')}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setStopOpen(true)} disabled={!online}>
                {t('connection.my_contact.stop')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>{t('connection.my_contact.none', { name })}</p>
            {canEngage ? (
              <Button className="self-start" onClick={openShare} disabled={!online}>
                {t('connection.my_contact.share')}
              </Button>
            ) : null}
          </>
        )}
      </div>
      <ContactShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        connectionId={connection.id}
        name={name}
        current={share}
        initialSelection={initial}
      />
      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title={t('connection.my_contact.stop_title', { name })}
        description={t('share.warning')}
        confirmLabel={t('connection.my_contact.stop')}
        tone="ink"
        onConfirm={async () => {
          await stop.mutateAsync(connection.id)
          toast.success(t('connection.my_contact.stopped'))
        }}
      />
    </SectionCard>
  )
}

function digitsOf(e164: string): string {
  return e164.replace(/[^\d]/g, '')
}

function TheirContactCard({ connection, name }: { connection: Connection; name: string }) {
  const { t } = useTranslation('chat')
  const contact = connection.their_contact
  return (
    <SectionCard title={t('connection.their_contact.title')}>
      {contact ? (
        <SharedContactRows contact={contact} />
      ) : (
        <p>{t('connection.their_contact.none', { name })}</p>
      )}
    </SectionCard>
  )
}

function SharedContactRows({ contact }: { contact: SharedContact }) {
  const { t } = useTranslation('chat')
  const label = useLabelOf()
  const rows: {
    key: string
    title: string
    value: string
    href: string
    action: string
    icon: typeof Phone
  }[] = []
  if (contact.phone_e164) {
    const value = formatPhone(contact.phone_e164)
    rows.push({
      key: 'mobile',
      title: t('connection.their_contact.mobile'),
      value,
      href: `tel:${contact.phone_e164}`,
      action: t('connection.their_contact.call', { value }),
      icon: Phone,
    })
  }
  if (contact.whatsapp_e164) {
    const value = formatPhone(contact.whatsapp_e164)
    rows.push({
      key: 'whatsapp',
      title: t('connection.their_contact.whatsapp'),
      value,
      href: `https://wa.me/${digitsOf(contact.whatsapp_e164)}`,
      action: t('connection.their_contact.open_whatsapp', { value }),
      icon: MessageCircle,
    })
  }
  if (contact.contact_email) {
    rows.push({
      key: 'email',
      title: t('connection.their_contact.email'),
      value: contact.contact_email,
      href: `mailto:${contact.contact_email}`,
      action: t('connection.their_contact.send_email', { value: contact.contact_email }),
      icon: Mail,
    })
  }
  const guardian = contact.guardian
  if (guardian && (guardian.name || guardian.phone_e164)) {
    const phone = guardian.phone_e164 ? formatPhone(guardian.phone_e164) : ''
    const relation = guardian.relation ? label('guardian_relation', guardian.relation) : ''
    const value = [guardian.name, relation ? `(${relation})` : '', phone].filter(Boolean).join(' ')
    rows.push({
      key: 'guardian',
      title: t('connection.their_contact.guardian'),
      value,
      href: guardian.phone_e164 ? `tel:${guardian.phone_e164}` : '',
      action: t('connection.their_contact.call', { value: phone }),
      icon: Phone,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {contact.preferred_contact === 'guardian' ? (
        <p className="text-title-sm">{t('connection.their_contact.guardian_first')}</p>
      ) : null}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 border-b border-border py-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-sm text-muted-foreground">{row.title}</span>
              <span dir="auto" className="text-title-sm">
                {row.value}
              </span>
            </span>
            {row.href ? (
              <Button asChild variant="secondary" size="icon">
                <a
                  href={row.href}
                  aria-label={row.action}
                  {...(row.key === 'whatsapp'
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                >
                  <row.icon aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {contact.best_time_to_call ? (
        <PlainText
          text={t('connection.their_contact.best_time', { text: contact.best_time_to_call })}
          className="text-body-sm"
        />
      ) : null}
      <p className="text-caption text-muted-foreground">{t('connection.their_contact.private')}</p>
    </div>
  )
}

function ChatSettingsCard({ connection }: { connection: Connection }) {
  const { t } = useTranslation('chat')
  const patch = usePatchConnection()
  const online = useOnlineStatus()
  return (
    <SectionCard title={t('connection.settings.title')}>
      <div className="flex flex-col gap-3">
        <SwitchRow
          label={t('connection.settings.mute')}
          checked={connection.is_muted}
          disabled={!online}
          onCheckedChange={(checked) => patch.mutate({ id: connection.id, is_muted: checked })}
        />
        <SwitchRow
          label={t('connection.settings.archive')}
          checked={connection.is_archived}
          disabled={!online}
          onCheckedChange={(checked) => patch.mutate({ id: connection.id, is_archived: checked })}
        />
      </div>
    </SectionCard>
  )
}
