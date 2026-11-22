import { useRouter } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from '~/components/common/MemberAvatar'
import { PlainText } from '~/components/common/PlainText'
import { RelativeTime } from '~/components/common/RelativeTime'
import { UnreadDot } from '~/components/common/UnreadDot'
import { LogoMark } from '~/components/layout/Logo'
import { avatarVariants } from '~/components/ui/avatar'
import type { NotificationItem } from '~/lib/api-types'
import { useLabelOf } from '~/lib/reference'
import { cn } from '~/lib/utils'
import { describeNotification } from './describe'

const rowClass =
  'flex min-h-[76px] w-full items-start gap-[12px] rounded-row px-[12px] py-3 text-start text-foreground transition-colors hover:tonal'

function isPlainLeftClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * One row of the feed (APP-NOTIFS, 16 section 6.15): the actor's photo or an app icon, the text
 * for the type, the relative time, and a dot while unread. Tapping marks the row read and opens
 * the target; a row without a target only marks it read.
 */
export function NotificationRow({
  item,
  onRead,
  onOpenWarning,
}: {
  item: NotificationItem
  /** Marks the row read (a no-op when it already is). */
  onRead: (item: NotificationItem) => void
  /** Opens the dialog of an `account_warning`. */
  onOpenWarning: (reason: string | null) => void
}) {
  const { t, i18n } = useTranslation('notifications')
  const label = useLabelOf()
  const router = useRouter()

  const { text, note, target } = describeNotification(item, {
    t: (key, values) => String(t(key as never, values as never)),
    label,
    language: i18n.language,
  })

  const content = (
    <>
      <Avatar item={item} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn('text-body-md', !item.is_read && 'font-bold')}>
          {text}
          {target?.kind === 'external' ? (
            <>
              <ExternalLink
                aria-hidden="true"
                className="ms-1 inline size-[0.85em] align-baseline"
              />
              <span className="sr-only">{t('announcement.opens_in_new_tab')}</span>
            </>
          ) : null}
        </span>
        {note ? (
          <PlainText as="span" text={note} className="text-body-sm text-muted-foreground" />
        ) : null}
        <RelativeTime value={item.created_at} className="text-caption text-muted-foreground" />
      </span>
      {item.is_read ? null : <UnreadDot label={t('unread')} data-unread-dot="" className="mt-2" />}
    </>
  )

  const wrap = (element: ReactNode) => (
    <div data-notification-type={item.type} data-read={item.is_read ? 'true' : 'false'}>
      {element}
    </div>
  )

  if (target?.kind === 'path') {
    const href = target.href
    return wrap(
      <a
        href={href}
        className={rowClass}
        onClick={(event) => {
          onRead(item)
          if (!isPlainLeftClick(event)) return
          event.preventDefault()
          router.history.push(href)
        }}
      >
        {content}
      </a>,
    )
  }

  if (target?.kind === 'external') {
    return wrap(
      <a
        href={target.url}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClass}
        onClick={() => onRead(item)}
      >
        {content}
      </a>,
    )
  }

  if (target?.kind === 'warning') {
    const reason = target.reason
    return wrap(
      <button
        type="button"
        className={rowClass}
        onClick={() => {
          onRead(item)
          onOpenWarning(reason)
        }}
      >
        {content}
      </button>,
    )
  }

  return wrap(
    <button type="button" className={rowClass} onClick={() => onRead(item)}>
      {content}
    </button>,
  )
}

/** The actor's arch (photo or monogram), or the brand mark for system notifications. */
function Avatar({ item }: { item: NotificationItem }) {
  const { t } = useTranslation('notifications')
  const actor = item.actor
  if (actor) {
    return (
      <MemberAvatar
        photo={actor.photo}
        name={actor.display_name}
        // The feed carries no gender. It is only for the silhouette, which a name makes unnecessary.
        gender="female"
        // Without a photo the monogram only repeats the name the text starts with.
        decorative={!actor.photo}
      />
    )
  }
  return (
    <span
      className={cn(avatarVariants({ size: 'sm' }), 'tonal items-center justify-center')}
      role="img"
      aria-label={t('app_icon')}
    >
      <LogoMark className="size-[26px]" />
    </span>
  )
}
