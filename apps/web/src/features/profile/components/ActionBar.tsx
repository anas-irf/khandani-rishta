import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Heart, MessageCircle, MoreVertical } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BlockDialog } from '~/components/common/BlockDialog'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { useGoBack } from '~/components/common/PageHeader'
import { PlainText } from '~/components/common/PlainText'
import { ReportDialog } from '~/components/common/ReportDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Label } from '~/components/ui/label'
import { NoteDialog, type NoteTarget } from '~/features/discovery/components/NoteDialog'
import { usePassWithUndo } from '~/features/discovery/components/usePassWithUndo'
import {
  useAcceptInterest,
  useDeclineInterest,
  useWithdrawInterest,
} from '~/features/interests/queries'
import { usePrivacy } from '~/features/me/queries'
import { useShortlistToggle } from '~/features/relations/queries'
import { isApiError } from '~/lib/api'
import type { ProfileDetail, Relation } from '~/lib/api-types'
import { showLimitDialog } from '~/lib/dialogs'
import { formatDate } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { cn } from '~/lib/utils'
import { useGrantPhotosTo } from '../queries'
import { SendInterestDialog, type SendOutcome } from './SendInterestDialog'

/** Which row of the action bar table of 16 section 6.7 applies, top to bottom. */
export type ActionBarState = 'connection' | 'received' | 'sent' | 'can_send' | 'cannot_send'

export function actionBarState(relation: Relation): ActionBarState {
  if (relation.tier === 'connection') return 'connection'
  if (relation.tier === 'interest_from_owner') return 'received'
  if (relation.tier === 'interest_to_owner') return 'sent'
  return relation.can_send_interest ? 'can_send' : 'cannot_send'
}

/** The button text for a `cannot_send_reason` (16 section 6.7, row 5). */
export function cannotSendButtonKey(reason: Relation['cannot_send_reason']): string {
  if (reason === 'already_pending') return 'actions.interest_sent'
  if (reason === 'already_connected') return 'actions.connected'
  return 'actions.send_interest'
}

type Dialogs =
  | 'send'
  | 'withdraw'
  | 'decline'
  | 'report'
  | 'block'
  | 'note'
  | 'open_interest'
  | 'mutual'
  | 'not_permitted'
  | null

/**
 * The action bar of `APP-PROFILE` (16 section 6.7), decided by `relation`: "Open chat" for a
 * connection; "Accept" and "Decline" for a received interest; "Interest sent" and "Withdraw" for
 * a sent one; "Send interest" or the disabled button with its reason otherwise. The heart, "Not
 * interested" and the menu (connection details, "Let {name} see my photos", report, block)
 * follow the table. Fixed to the bottom on narrow screens, in the side column on wide ones.
 */
export function ActionBar({ detail }: { detail: ProfileDetail }) {
  const { t } = useTranslation('profile')
  const navigate = useNavigate()
  const goBack = useGoBack()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const { card, relation } = detail
  const name = card.display_name
  const profileId = card.id
  const state = actionBarState(relation)
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [mutualConnection, setMutualConnection] = useState<string | null>(null)
  const [notPermitted, setNotPermitted] = useState<'verified_only' | 'preference_match'>(
    'verified_only',
  )
  const [alsoBlock, setAlsoBlock] = useState(false)
  const [note, setNote] = useState<NoteTarget | null>(null)

  const accept = useAcceptInterest({ limitText: 'profile:accept.limit_you' })
  const decline = useDeclineInterest()
  const withdraw = useWithdrawInterest()
  const pass = usePassWithUndo()

  const refetchProfile = () => queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })
  const close = () => setDialog(null)

  const onSendOutcome = (outcome: SendOutcome) => {
    if (outcome.kind === 'connected') {
      setMutualConnection(outcome.connectionId)
      setDialog('mutual')
    } else if (outcome.kind === 'not_permitted') {
      setNotPermitted(outcome.reason)
      setDialog('not_permitted')
    }
  }

  const doAccept = () => {
    if (!relation.interest) return
    accept.mutate(
      { id: relation.interest.id, profileId },
      {
        onSuccess: (result) => {
          toast.success(t('accept.done'))
          void navigate({
            to: '/chats/$connectionId',
            params: { connectionId: result.connection.id },
          })
        },
        onError: (error) => {
          if (!isApiError(error)) return
          if (error.code === 'limit_reached' && error.details.side === 'them') {
            showLimitDialog({ textKey: 'profile:accept.limit_them', details: error.details })
          }
          if (error.code === 'invalid_state') void refetchProfile()
        },
      },
    )
  }

  const doPass = () => {
    pass(profileId, { message: t('pass.done') })
    if (relation.interest?.direction === 'sent') setDialog('open_interest')
    else goBack()
  }

  const heart = (
    <ShortlistButton
      detail={detail}
      onAddNote={() => setNote({ profileId, note: relation.shortlist_note, name })}
    />
  )
  const notInterested = (
    <Button variant="ghost" disabled={!online} onClick={doPass}>
      {t('actions.not_interested')}
    </Button>
  )
  const menu = (
    <ProfileMenu
      detail={detail}
      state={state}
      onReport={() => setDialog('report')}
      onBlock={() => setDialog('block')}
    />
  )

  let primary: ReactNode
  let secondary: ReactNode
  let above: ReactNode = null
  let below: ReactNode = null

  switch (state) {
    case 'connection':
      primary = (
        <Button asChild className="flex-1">
          <Link
            to="/chats/$connectionId"
            params={{ connectionId: relation.connection_id ?? card.relation.connection_id ?? '' }}
          >
            <MessageCircle aria-hidden="true" />
            {t('actions.open_chat')}
          </Link>
        </Button>
      )
      secondary = menu
      break
    case 'received':
      above = relation.interest ? (
        <div className="flex flex-col gap-1" data-received-interest="">
          <p className="font-medium">{t('received.text', { name })}</p>
          <PlainText text={relation.interest.message} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t('received.expires', { date: formatDate(relation.interest.expires_at) })}
          </p>
        </div>
      ) : null
      primary = (
        <Button className="flex-1" onClick={doAccept} loading={accept.isPending} disabled={!online}>
          {t('actions.accept')}
        </Button>
      )
      secondary = (
        <>
          <Button variant="secondary" disabled={!online} onClick={() => setDialog('decline')}>
            {t('actions.decline')}
          </Button>
          {heart}
          {menu}
        </>
      )
      break
    case 'sent':
      primary = (
        <Button className="flex-1" disabled>
          {t('actions.interest_sent')}
        </Button>
      )
      secondary = (
        <>
          <Button variant="secondary" disabled={!online} onClick={() => setDialog('withdraw')}>
            {t('actions.withdraw')}
          </Button>
          {heart}
          {menu}
        </>
      )
      break
    case 'can_send':
      primary = (
        <Button className="flex-1" disabled={!online} onClick={() => setDialog('send')}>
          <Heart aria-hidden="true" />
          {t('actions.send_interest')}
        </Button>
      )
      secondary = (
        <>
          {heart}
          {notInterested}
          {menu}
        </>
      )
      break
    default:
      primary = (
        <Button className="flex-1" disabled data-cannot-send={relation.cannot_send_reason ?? ''}>
          {t(cannotSendButtonKey(relation.cannot_send_reason))}
        </Button>
      )
      secondary = (
        <>
          {heart}
          {notInterested}
          {menu}
        </>
      )
      below = <CannotSendLine relation={relation} />
      break
  }

  return (
    <section
      aria-label={t('actions.label')}
      data-action-bar={state}
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-3 border-t border-border bg-surface p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] md:static md:rounded-[var(--radius-card)] md:border md:p-4 md:shadow-sm"
    >
      {above}
      <div className="flex flex-wrap items-center gap-2">
        {primary}
        <div className="flex items-center gap-1">{secondary}</div>
      </div>
      {below}

      <SendInterestDialog
        open={dialog === 'send'}
        onOpenChange={(open) => setDialog(open ? 'send' : null)}
        profileId={profileId}
        name={name}
        onOutcome={onSendOutcome}
      />
      <ConfirmDialog
        open={dialog === 'withdraw'}
        onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
        title={t('withdraw.title')}
        description={t('withdraw.text')}
        confirmLabel={t('withdraw.confirm')}
        onConfirm={async () => {
          if (!relation.interest) return
          try {
            await withdraw.mutateAsync({ id: relation.interest.id, profileId })
            toast.success(t('withdraw.done'))
          } catch (error) {
            if (isApiError(error) && error.code === 'invalid_state') void refetchProfile()
            throw error
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'decline'}
        onOpenChange={(open) => {
          setDialog(open ? 'decline' : null)
          if (!open) setAlsoBlock(false)
        }}
        title={t('decline.title')}
        description={t('decline.text', { name })}
        confirmLabel={t('decline.confirm')}
        destructive
        onConfirm={async () => {
          if (!relation.interest) return
          try {
            await decline.mutateAsync({ id: relation.interest.id, profileId, alsoBlock })
            toast.success(t('decline.done'))
            setDialog(null)
            goBack()
          } catch (error) {
            if (isApiError(error) && error.code === 'invalid_state') void refetchProfile()
            throw error
          }
        }}
      >
        <div className="flex items-center gap-3">
          <Checkbox
            id={`decline-block-${profileId}`}
            checked={alsoBlock}
            onCheckedChange={(checked) => setAlsoBlock(checked === true)}
          />
          <Label htmlFor={`decline-block-${profileId}`} className="text-base font-normal">
            {t('decline.also_block', { name })}
          </Label>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'open_interest'}
        onOpenChange={(open) => {
          if (!open) {
            close()
            goBack()
          }
        }}
        title={t('pass.open_interest', { name })}
        description=""
        confirmLabel={t('pass.withdraw')}
        cancelLabel={t('pass.keep')}
        onConfirm={async () => {
          if (relation.interest) {
            await withdraw.mutateAsync({ id: relation.interest.id, profileId })
            toast.success(t('withdraw.done'))
          }
        }}
      />
      <AlertDialog open={dialog === 'mutual'} onOpenChange={(open) => (open ? null : close())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('send.mutual_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('send.mutual_text')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('send.later')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mutualConnection) {
                  void navigate({
                    to: '/chats/$connectionId',
                    params: { connectionId: mutualConnection },
                  })
                }
              }}
            >
              {t('send.start_chatting')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={dialog === 'not_permitted'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`cannot_send.${notPermitted}`)}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t(`cannot_send.${notPermitted}`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('load.ok')}</AlertDialogCancel>
            {notPermitted === 'verified_only' ? (
              <AlertDialogAction onClick={() => void navigate({ to: '/me/verification' })}>
                {t('send.verify_now')}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReportDialog
        open={dialog === 'report'}
        onOpenChange={(open) => setDialog(open ? 'report' : null)}
        profileId={profileId}
        name={name}
      />
      <BlockDialog
        open={dialog === 'block'}
        onOpenChange={(open) => setDialog(open ? 'block' : null)}
        profileId={profileId}
        name={name}
      />
      <NoteDialog entry={note} onClose={() => setNote(null)} />
    </section>
  )
}

/** The line under the disabled button (16 section 6.7, "Text for cannot_send_reason"). */
export function CannotSendLine({ relation }: { relation: Relation }) {
  const { t } = useTranslation('profile')
  const me = useCurrentMe()
  const verified =
    me.profile.badges.includes('id_verified') || me.profile.badges.includes('photo_verified')
  const linkClass =
    'inline-flex min-h-11 items-center self-start font-medium text-primary underline-offset-4 hover:underline'
  const verifyLink = (label: string) => (
    <Link to="/me/verification" className={linkClass}>
      {label}
    </Link>
  )

  let text: string | null = null
  let action: ReactNode = null
  switch (relation.cannot_send_reason) {
    case 'cooldown':
      text = t('cannot_send.cooldown', {
        date: relation.can_send_interest_after ? formatDate(relation.can_send_interest_after) : '',
      })
      break
    case 'daily_limit':
      text = t('cannot_send.daily_limit')
      if (!verified) action = verifyLink(t('cannot_send.verify_more'))
      break
    case 'pending_limit':
      text = t('cannot_send.pending_limit')
      action = (
        <Link to="/interests" search={{ box: 'sent', status: 'pending' }} className={linkClass}>
          {t('cannot_send.view_sent')}
        </Link>
      )
      break
    case 'connection_limit':
      text = t('cannot_send.connection_limit')
      break
    case 'not_permitted_by_member':
      if (relation.cannot_send_detail === 'verified_only') {
        text = t('cannot_send.verified_only')
        action = verifyLink(t('cannot_send.get_verified'))
      } else if (relation.cannot_send_detail === 'preference_match') {
        text = t('cannot_send.preference_match')
      }
      break
    case 'own_profile_not_active':
      text = t('cannot_send.own_profile_not_active')
      break
    default:
      break
  }
  if (!text) return null
  return (
    <div className="flex flex-col gap-0.5 text-sm" data-cannot-send-line="">
      <p className="text-muted-foreground">{text}</p>
      {action}
    </div>
  )
}

/**
 * The heart on the profile (16 section 6.7): optimistic `PUT`/`DELETE /v1/shortlist/{id}`. After
 * adding, a toast offers "Add a note".
 */
function ShortlistButton({ detail, onAddNote }: { detail: ProfileDetail; onAddNote: () => void }) {
  const { t } = useTranslation(['profile', 'shared'])
  const toggle = useShortlistToggle()
  const online = useOnlineStatus()
  const { card } = detail
  const shortlisted = toggle.isPending
    ? toggle.variables.shortlisted
    : detail.relation.is_shortlisted

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={shortlisted}
      disabled={!online}
      aria-label={
        shortlisted
          ? t('shared:card.shortlist_remove', { name: card.display_name })
          : t('shared:card.shortlist_add', { name: card.display_name })
      }
      onClick={() =>
        toggle.mutate(
          { profileId: card.id, shortlisted: !shortlisted },
          {
            onSuccess: (_data, variables) => {
              if (!variables.shortlisted) return
              toast(t('profile:actions.shortlisted'), {
                action: { label: t('profile:actions.add_note'), onClick: onAddNote },
              })
            },
          },
        )
      }
    >
      <Heart
        aria-hidden="true"
        className={cn('size-5 text-danger', shortlisted ? 'fill-danger' : 'fill-transparent')}
      />
    </Button>
  )
}

/** The "more" menu: connection details, "Let {name} see my photos", report and block. */
function ProfileMenu({
  detail,
  state,
  onReport,
  onBlock,
}: {
  detail: ProfileDetail
  state: ActionBarState
  onReport: () => void
  onBlock: () => void
}) {
  const { t } = useTranslation('profile')
  const [open, setOpen] = useState(false)
  const grant = useGrantPhotosTo()
  const { card, relation } = detail
  const related = state === 'connection' || state === 'received' || state === 'sent'
  // The mutation lives here, not in the menu item, so its toast survives the menu closing.
  const grantPhotos = () =>
    grant.mutate(card.id, {
      onSuccess: () => toast.success(t('actions.photos_granted', { name: card.display_name })),
    })
  const connectionId = relation.connection_id ?? card.relation.connection_id

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('actions.menu', { name: card.display_name })}
        >
          <MoreVertical aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {state === 'connection' && connectionId ? (
          <DropdownMenuItem asChild>
            <Link to="/chats/$connectionId/details" params={{ connectionId }}>
              {t('actions.connection_details')}
            </Link>
          </DropdownMenuItem>
        ) : null}
        {related && open ? (
          <LetSeePhotosItem name={card.display_name} onSelect={grantPhotos} />
        ) : null}
        {state === 'connection' || related ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={onReport}>{t('actions.report')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onBlock}>{t('actions.block')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Shown when the viewer's own `photo_visibility` is not `members` (16 section 6.7). */
function LetSeePhotosItem({ name, onSelect }: { name: string; onSelect: () => void }) {
  const { t } = useTranslation('profile')
  const privacy = usePrivacy()
  if (!privacy.data || privacy.data.photo_visibility === 'members') return null
  return (
    <DropdownMenuItem onSelect={onSelect}>{t('actions.let_see_photos', { name })}</DropdownMenuItem>
  )
}
