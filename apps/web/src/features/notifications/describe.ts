import type { NotificationItem } from '~/lib/api-types'

/**
 * Notification type to text and target (14 section 3, 16 section 6.15, 17 section 3.4). A pure
 * function: the feed screen only renders what it returns. Texts are built on the client from
 * `type`, `actor` and `data`; every `data` object may gain keys later and unknown keys are
 * ignored. A `type` this build does not know reads "You have a new notification." and has no
 * target, which keeps old builds safe when new types are added.
 */

export type Translate = (key: string, values?: Record<string, unknown>) => string

export type DescribeContext = {
  /** Translates a key of the `notifications` namespace, for example `text.interest_received`. */
  t: Translate
  /** Option label: `label('connection_stage', 'engaged')`. */
  label: (list: string, code: string | null | undefined) => string
  /** The active language, for `announcement` (`text_ur` in Urdu, otherwise `text_en`). */
  language: string
}

/** What tapping a row does. */
export type NotificationTarget =
  /** A screen of the app, as the URL of 17 section 3.4 (path and query). */
  | { kind: 'path'; href: string }
  /** `announcement` with a `url`: opens in a new tab. */
  | { kind: 'external'; url: string }
  /** `account_warning`: opens the dialog with the full reason (16 section 6.15). */
  | { kind: 'warning'; reason: string | null }
  | null

export type NotificationDescription = {
  text: string
  /** The moderator's note of `text_rejected`, shown under the text. */
  note: string | null
  target: NotificationTarget
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Only absolute http(s) links are opened; anything else is dropped. */
export function safeExternalUrl(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

function path(href: string): NotificationTarget {
  return { kind: 'path', href }
}

function query(values: Record<string, string | null>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) params.set(key, value)
  }
  const result = params.toString()
  return result ? `?${result}` : ''
}

const enc = encodeURIComponent

/** The section of `ME-EDIT` (or `ME-PREFS`) that owns a rejected text field (16 section 4.1). */
export function textRejectedTarget(field: string | null): string {
  if (field === 'about_me') return '/me/edit/lifestyle'
  if (field === 'about_family') return '/me/edit/family'
  if (field === 'partner_notes') return '/me/preferences'
  return '/me'
}

export function describeNotification(
  item: Pick<NotificationItem, 'type' | 'actor' | 'data'>,
  context: DescribeContext,
): NotificationDescription {
  const { t, label, language } = context
  const data = item.data ?? {}
  const actor = item.actor
  const actorName = actor?.display_name ?? t('actor_fallback')
  const actorProfile = actor ? path(`/profiles/${enc(actor.profile_id)}`) : null
  const unknown: NotificationDescription = { text: t('text.unknown'), note: null, target: null }
  const plain = (
    key: string,
    target: NotificationTarget,
    values: Record<string, unknown> = {},
  ) => ({
    text: t(`text.${key}`, values),
    note: null,
    target,
  })

  switch (item.type) {
    case 'interest_received': {
      if (data.reminder === true) {
        return plain(
          'interest_received_reminder',
          path(`/interests${query({ box: 'received', interest_id: text(data.interest_id) })}`),
          { actor: actorName, count: count(data.count) ?? 1 },
        )
      }
      return plain('interest_received', actorProfile, { actor: actorName })
    }

    case 'interest_accepted': {
      const connectionId = text(data.connection_id)
      return plain('interest_accepted', connectionId ? path(`/chats/${enc(connectionId)}`) : null, {
        actor: actorName,
      })
    }

    case 'photo_request_received':
      return plain('photo_request_received', path('/photo-requests?box=received'), {
        actor: actorName,
      })

    case 'photo_request_granted':
      return plain('photo_request_granted', actorProfile, { actor: actorName })

    case 'contact_shared': {
      const connectionId = text(data.connection_id)
      return plain(
        'contact_shared',
        connectionId ? path(`/chats/${enc(connectionId)}/details`) : null,
        { actor: actorName },
      )
    }

    case 'stage_proposed':
    case 'stage_confirmed': {
      const stage = text(data.stage)
      if (!stage) return unknown
      const connectionId = text(data.connection_id)
      return plain(item.type, connectionId ? path(`/chats/${enc(connectionId)}/details`) : null, {
        actor: actorName,
        stage: label('connection_stage', stage),
      })
    }

    case 'profile_approved':
      return plain('profile_approved', path('/home'))

    case 'profile_changes_requested':
      return plain('profile_changes_requested', path('/account/changes'))

    case 'photo_approved':
      return plain('photo_approved', path('/me/photos'))

    case 'photo_rejected': {
      const reason = text(data.rejection_reason)
      return reason
        ? plain('photo_rejected', path('/me/photos'), {
            reason: label('photo_rejection_reason', reason),
          })
        : plain('photo_rejected_no_reason', path('/me/photos'))
    }

    case 'text_rejected':
      return {
        text: t('text.text_rejected'),
        note: text(data.note),
        target: path(textRejectedTarget(text(data.field))),
      }

    case 'verification_approved': {
      const kind = text(data.kind)
      const key =
        kind === 'id_document'
          ? 'verification_approved_id_document'
          : kind === 'selfie'
            ? 'verification_approved_selfie'
            : 'verification_approved_other'
      return plain(key, path('/me/verification'))
    }

    case 'verification_rejected': {
      const reason = text(data.rejection_reason)
      return reason
        ? plain('verification_rejected', path('/me/verification'), {
            reason: label('verification_rejection_reason', reason),
          })
        : plain('verification_rejected_no_reason', path('/me/verification'))
    }

    case 'new_matches': {
      const total = count(data.count) ?? 0
      const name = text(data.saved_search_name)
      if (data.source === 'saved_search' && name) {
        const searchId = text(data.saved_search_id)
        return plain(
          'new_matches_saved_search',
          path(`/search${query({ saved_search_id: searchId })}`),
          { count: total, name },
        )
      }
      return plain('new_matches', path('/matches'), { count: total })
    }

    case 'profile_views_summary':
      return plain('profile_views_summary', path('/visitors'), { count: count(data.count) ?? 0 })

    case 'account_warning': {
      const reason = text(data.reason)
      return {
        text: reason ? t('text.account_warning', { reason }) : t('text.account_warning_no_reason'),
        note: null,
        target: { kind: 'warning', reason },
      }
    }

    case 'announcement': {
      const body = (language === 'ur' ? text(data.text_ur) : null) ?? text(data.text_en)
      if (!body) return unknown
      const url = safeExternalUrl(data.url)
      return { text: body, note: null, target: url ? { kind: 'external', url } : null }
    }

    default:
      return unknown
  }
}
