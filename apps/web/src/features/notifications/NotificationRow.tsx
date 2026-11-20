import { useRouter } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberPhoto } from '~/components/common/MemberPhoto'
import { PlainText } from '~/components/common/PlainText'
import { RelativeTime } from '~/components/common/RelativeTime'
import { LogoMark } from '~/components/layout/Logo'
import type { NotificationItem } from '~/lib/api-types'
import { useLabelOf } from '~/lib/reference'
import { cn } from '~/lib/utils'
import { describeNotification } from './describe'

const rowClass =
  'flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

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
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-base leading-snug', !item.is_read && 'font-semibold')}>
          {text}
          {target?.kind === 'external' ? (
            <>
              <ExternalLink aria-hidden="true" className="ms-1 inline size-3.5 align-baseline" />
              <span className="sr-only">{t('announcement.opens_in_new_tab')}</span>
            </>
          ) : null}
        </span>
        {note ? (
          <PlainText as="span" text={note} className="text-sm text-muted-foreground" />
        ) : null}
        <RelativeTime value={item.created_at} className="text-sm text-muted-foreground" />
      </span>
      {item.is_read ? null : (
        <span className="mt-1.5 flex shrink-0 items-center" data-unread-dot="">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
          <span className="sr-only">{t('unread')}</span>
        </span>
      )}
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

/** The actor's photo, the brand mark for system notifications, or the actor's initial. */
function Avatar({ item }: { item: NotificationItem }) {
  const { t } = useTranslation('notifications')
  const actor = item.actor
  if (actor?.photo) {
    return (
      <MemberPhoto
        photo={actor.photo}
        name={actor.display_name}
        gender="female"
        size="thumb"
        width={48}
        height={48}
        className="size-12 shrink-0 rounded-full"
      />
    )
  }
  if (actor) {
    return (
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary"
      >
        {actor.display_name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <span
      className="flex size-12 shrink-0 items-center justify-center"
      role="img"
      aria-label={t('app_icon')}
    >
      <LogoMark className="size-10" />
    </span>
  )
}
