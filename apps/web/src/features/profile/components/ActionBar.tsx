import { Link } from '@tanstack/react-router'
import { Ellipsis, MessageSquare } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MonogramArch } from '~/components/common/Arch'
import { CompatBadge } from '~/components/common/CompatBadge'
import { ExpiryNote } from '~/components/common/ExpiryNote'
import { MemberPhoto } from '~/components/common/MemberPhoto'
import { NameAge } from '~/components/common/NameAge'
import { QuoteBlock } from '~/components/common/QuoteBlock'
import { ShortlistButton } from '~/components/common/ShortlistButton'
import { StickyActionBar } from '~/components/common/StickyActionBar'
import { TextLink } from '~/components/common/TextLink'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { usePrivacy } from '~/features/me/queries'
import { useCandidate } from '~/features/profile-sections/useCandidate'
import type { Relation } from '~/lib/api-types'
import { formatDate } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { cn } from '~/lib/utils'
import { useGrantPhotosTo } from '../queries'
import { cannotSendButtonKey, useProfileActions } from './actions'

/*
 * The actions of `APP-PROFILE` (16 section 6.7, decided by `relation`) in their three places:
 *
 * - phones: the one primary and a line at the bottom (DESIGN.md 6.14), Shortlist and More in the
 *   top bar, so the primary stays large;
 * - wide screens: all of them in the side rail.
 */

/** Shortlist and More as icon-and-label buttons, for the phone top bar (DESIGN.md 6.16). */
export function TopBarActions() {
  const { detail, state, shortlisted } = useProfileActions()
  return (
    <>
      {state === 'connection' ? null : (
        <ShortlistButton
          profileId={detail.card.id}
          shortlisted={detail.relation.is_shortlisted}
          onAdded={shortlisted}
          variant="ghost"
          size="bar"
          className="shrink-0 [&_svg]:size-[22px]"
        />
      )}
      <MoreMenu inBar />
    </>
  )
}

/** The phone action bar: one primary button, and at most one line under it. */
export function ActionBar() {
  const { t } = useTranslation('profile')
  const { state, online, openWithdraw, openDecline } = useProfileActions()
  const received = state === 'received'

  return (
    <StickyActionBar
      aria-label={t('actions.label')}
      data-action-bar={state}
      className={cn(received && 'overflow-hidden')}
    >
      {received ? (
        <>
          <ReceivedBanner size="xs" />
          <div className="flex shrink-0 flex-wrap gap-[12px]">
            <Button
              variant="secondary"
              size="lg"
              className="min-w-min flex-[1_1_0] px-[12px]"
              disabled={!online}
              onClick={openDecline}
            >
              {t('actions.decline')}
            </Button>
            <Primary className="min-w-min flex-[1.4_1_0] px-[12px]" />
          </div>
        </>
      ) : state === 'sent' ? (
        <div className="flex flex-wrap gap-3">
          <Primary className="flex-[1_1_auto] px-[12px]" />
          <Button
            variant="secondary"
            size="lg"
            className="grow px-5"
            disabled={!online}
            onClick={openWithdraw}
          >
            {t('actions.withdraw')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Primary className="w-full" />
          <UnderPrimary />
        </div>
      )}
    </StickyActionBar>
  )
}

/** The side rail of wide screens (16 section 6.7, "Platform differences"; DESIGN.md 5.3). */
export function ActionRail() {
  const { t } = useTranslation('profile')
  const { detail, state, online, shortlisted, pass, openDecline, openWithdraw } =
    useProfileActions()
  const { card, relation } = detail
  const canPass = state === 'can_send' || state === 'cannot_send'

  return (
    <section
      aria-label={t('actions.label')}
      data-slot="action-rail"
      data-action-bar={state}
      className="sticky top-[calc(var(--app-bar,80px)+24px)] z-10 flex max-h-[calc(100dvh-var(--app-bar,80px)-48px)] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-panel [--tonal:var(--color-muted)] *:shrink-0"
    >
      {state === 'received' ? (
        <ReceivedBanner size="sm" />
      ) : (
        <div className="flex items-center gap-4">
          <MemberPhoto
            photo={card.photo}
            name={card.display_name}
            gender={card.gender}
            size="thumb"
            width={46}
            height={58}
            decorative
            className="h-[58px] w-[46px]"
          />
          <div className="flex min-w-0 flex-col items-start gap-2">
            <p className="max-w-full text-figure">
              <NameAge name={card.display_name} age={card.age} />
            </p>
            <CompatBadge compat={card.compat} size="compact" />
          </div>
        </div>
      )}

      <Primary className="w-full" />
      {state === 'received' ? (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={!online}
          onClick={openDecline}
        >
          {t('actions.decline')}
        </Button>
      ) : null}
      {state === 'sent' ? (
        <Button variant="secondary" className="w-full" disabled={!online} onClick={openWithdraw}>
          {t('actions.withdraw')}
        </Button>
      ) : null}
      <UnderPrimary meter />

      <div className="flex flex-wrap gap-3">
        {state === 'connection' ? null : (
          <ShortlistButton
            profileId={card.id}
            shortlisted={relation.is_shortlisted}
            onAdded={shortlisted}
            size="compact"
            variant={state === 'received' ? 'quiet' : 'secondary'}
            className="flex-[1_1_auto]"
          />
        )}
        {canPass ? (
          <Button
            variant="quiet"
            size="compact"
            className="flex-[1_1_auto]"
            disabled={!online}
            onClick={pass}
          >
            {t('actions.not_interested')}
          </Button>
        ) : null}
        <MoreMenu className={canPass ? 'basis-full' : 'flex-[1_1_auto]'} />
      </div>
    </section>
  )
}

/** The one main button of the row of 16 section 6.7 that applies. */
function Primary({ className }: { className?: string }) {
  const { t } = useTranslation('profile')
  const { detail, state, online, accept, accepting, openSend } = useProfileActions()
  const { card, relation } = detail

  switch (state) {
    case 'connection':
      return (
        <Button asChild size="lg" className={className}>
          <Link
            to="/chats/$connectionId"
            params={{ connectionId: relation.connection_id ?? card.relation.connection_id ?? '' }}
          >
            <MessageSquare aria-hidden="true" />
            {t('actions.open_chat')}
          </Link>
        </Button>
      )
    case 'received':
      return (
        <Button
          size="lg"
          className={className}
          loading={accepting}
          disabled={!online}
          onClick={accept}
        >
          {t('actions.accept')}
        </Button>
      )
    case 'sent':
      return (
        <Button size="lg" className={className} disabled>
          {t('actions.interest_sent')}
        </Button>
      )
    case 'can_send':
      return (
        <Button size="lg" className={className} disabled={!online} onClick={openSend}>
          {t('actions.send_interest')}
        </Button>
      )
    default:
      return (
        <Button
          size="lg"
          className={className}
          disabled
          data-cannot-send={relation.cannot_send_reason ?? ''}
        >
          {t(cannotSendButtonKey(relation.cannot_send_reason))}
        </Button>
      )
  }
}

/** The line under the primary: the interests left today, or why none can be sent. */
function UnderPrimary({ meter = false }: { meter?: boolean }) {
  const { detail, state } = useProfileActions()
  if (state === 'can_send') return <InterestsLeft meter={meter} />
  if (state === 'cannot_send') return <CannotSendLine relation={detail.relation} />
  return null
}

/** Up to this many, the day's interests also show as small arches. */
const METER_MAX = 10

function InterestsLeft({ meter }: { meter: boolean }) {
  const { t } = useTranslation('profile')
  const me = useCurrentMe()
  const total = me.usage.interests_per_day
  const left = Math.max(0, total - me.usage.interests_sent_today)
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-caption text-muted-foreground tabular-nums">
      {meter && total > 0 && total <= METER_MAX ? (
        <span aria-hidden="true" className="flex gap-1">
          {Array.from({ length: total }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: the marks have no identity.
              key={index}
              className={cn(
                'h-[14px] w-[11px] rounded-t-pill border-[1.5px] border-primary',
                index < left && 'bg-primary',
              )}
            />
          ))}
        </span>
      ) : null}
      <span className="min-w-0">{t('send.left', { left, total })}</span>
    </p>
  )
}

/** The line under the disabled button (16 section 6.7, "Text for cannot_send_reason"). */
function CannotSendLine({ relation }: { relation: Relation }) {
  const { t } = useTranslation('profile')
  const me = useCurrentMe()
  const verified =
    me.profile.badges.includes('id_verified') || me.profile.badges.includes('photo_verified')
  const verifyLink = (label: string) => (
    <TextLink to="/me/verification" className="text-label-md">
      {label}
    </TextLink>
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
        <TextLink
          to="/interests"
          search={{ box: 'sent', status: 'pending' }}
          className="text-label-md"
        >
          {t('cannot_send.view_sent')}
        </TextLink>
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
    <div data-cannot-send-line="" className="flex flex-col items-center text-center text-caption">
      <p className="max-w-full text-muted-foreground">{text}</p>
      {action}
    </div>
  )
}

/**
 * The interest banner of DESIGN.md 6.12, on top of the buttons as one unit. In the phone bar it
 * scrolls inside when it is long, so Decline and Accept stay on the screen.
 */
function ReceivedBanner({ size }: { size: 'xs' | 'sm' }) {
  const { t } = useTranslation('profile')
  const { context } = useCandidate()
  const { detail } = useProfileActions()
  const titleId = useId()
  const { interest } = detail.relation
  if (!interest) return null
  const name = detail.card.display_name
  const inBar = size === 'xs'

  return (
    <section
      aria-labelledby={titleId}
      data-received-interest=""
      // It scrolls inside the phone bar, so the keyboard has to reach it.
      tabIndex={inBar ? 0 : undefined}
      className={cn(
        'flex flex-col gap-3',
        inBar && 'min-h-0 overflow-y-auto rounded-sm -outline-offset-3',
      )}
    >
      <div className="flex shrink-0 items-start gap-3">
        <MonogramArch name={name} size={size} />
        <div className="flex min-w-0 flex-col gap-1">
          <p id={titleId} className="max-w-full text-title-md font-bold">
            {t('received.text', { name, context })}
          </p>
          <ExpiryNote
            expiresAt={interest.expires_at}
            text={t('received.expires', { date: formatDate(interest.expires_at) })}
          />
        </div>
      </div>
      <QuoteBlock text={interest.message} className="shrink-0" />
    </section>
  )
}

/**
 * More: connection details, "Let {name} see my photos", "Not interested" on phones (the rail has
 * a button for it), report and block.
 */
function MoreMenu({ inBar = false, className }: { inBar?: boolean; className?: string }) {
  const { t } = useTranslation(['profile', 'shared'])
  const { context } = useCandidate()
  const { detail, state, online, pass, openReport, openBlock } = useProfileActions()
  const [open, setOpen] = useState(false)
  const grant = useGrantPhotosTo()
  const { card, relation } = detail
  const related = state === 'connection' || state === 'received' || state === 'sent'
  // The mutation lives here, not in the menu item, so its toast survives the menu closing.
  const grantPhotos = () =>
    grant.mutate(card.id, {
      onSuccess: () =>
        toast.success(t('actions.photos_granted', { name: card.display_name, context })),
    })
  const connectionId = relation.connection_id ?? card.relation.connection_id

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={inBar ? 'ghost' : 'quiet'}
          size={inBar ? 'bar' : 'compact'}
          className={cn(inBar && 'shrink-0 [&_svg]:size-[22px]', className)}
          aria-label={t('actions.menu', { name: card.display_name })}
        >
          <Ellipsis aria-hidden="true" />
          {t('shared:card.more')}
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
        {inBar && !related ? (
          <DropdownMenuItem disabled={!online} onSelect={pass}>
            {t('actions.not_interested')}
          </DropdownMenuItem>
        ) : null}
        {related || inBar ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={openReport}>{t('actions.report')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={openBlock}>{t('actions.block')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Shown when the viewer's own `photo_visibility` is not `members` (16 section 6.7). */
function LetSeePhotosItem({ name, onSelect }: { name: string; onSelect: () => void }) {
  const { t } = useTranslation('profile')
  const { context } = useCandidate()
  const privacy = usePrivacy()
  if (!privacy.data || privacy.data.photo_visibility === 'members') return null
  return (
    <DropdownMenuItem onSelect={onSelect}>
      {t('actions.let_see_photos', { name, context })}
    </DropdownMenuItem>
  )
}
