import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { useSendInterest } from '~/features/interests/queries'
import { isApiError } from '~/lib/api'
import type { SendInterestResult } from '~/lib/api-types'
import { showLimitDialog } from '~/lib/dialogs'
import { serverFieldMessage } from '~/lib/form-context'
import { formatDate } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { cn } from '~/lib/utils'

/** At most 300 characters (11 section 2.2). */
export const MESSAGE_MAX = 300

/** The `limit_reached` text for the limit in `details.limit` (16 section 6.7, row 5 texts). */
export function sendLimitTextKey(limit: unknown): string {
  if (limit === 'limits.pending_interests_max') return 'profile:send.limit.pending'
  if (limit === 'limits.active_connections_max') return 'profile:send.limit.connections'
  return 'profile:send.limit.daily'
}

export type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'connected'; connectionId: string }
  | { kind: 'not_permitted'; reason: 'verified_only' | 'preference_match' }

/**
 * The send dialog of 16 section 6.7: "Send an interest to {name}", the interests left today, an
 * optional message (at most 300 characters, with a counter) with the templates of 11 section 2.2
 * as chips that fill the field (the third only when the sender's profile is managed by someone
 * else), and the helper text. Then `POST /v1/interests`; every error code of 6.7 is answered here
 * or passed to `onOutcome`.
 */
export function SendInterestDialog({
  open,
  onOpenChange,
  profileId,
  name,
  onOutcome,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profileId: string
  name: string
  onOutcome: (outcome: SendOutcome) => void
}) {
  const { t } = useTranslation(['profile', 'common'])
  const me = useCurrentMe()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const send = useSendInterest({ limitText: 'profile:send.limit.daily' })
  const fieldId = useId()
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMessage('')
      setError(null)
    }
  }

  const perDay = me.usage.interests_per_day
  const left = Math.max(0, perDay - me.usage.interests_sent_today)
  const templates = ['template_1', 'template_2']
  if (me.profile.managed_by && me.profile.managed_by !== 'self') templates.push('template_3')

  const refetchProfile = () => queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const text = message.trim()
    send.mutate(
      { receiver_profile_id: profileId, ...(text ? { message: text } : {}) },
      {
        onSuccess: (result: SendInterestResult) => {
          onOpenChange(false)
          if (result.connection) {
            onOutcome({ kind: 'connected', connectionId: result.connection.id })
          } else {
            toast.success(t('profile:send.sent'))
            onOutcome({ kind: 'sent' })
          }
        },
        onError: (failure) => {
          if (!isApiError(failure)) return
          switch (failure.code) {
            case 'validation_failed': {
              const field = failure.fields.find((item) => item.field === 'message')
              setError(field ? serverFieldMessage('profile', field) : failure.message)
              return
            }
            case 'already_connected':
            case 'interest_already_pending':
            case 'not_found':
              onOpenChange(false)
              void refetchProfile()
              return
            case 'cooldown_active': {
              onOpenChange(false)
              const date = failure.details.retry_after_date
              toast.error(
                t('profile:send.cooldown', {
                  date: typeof date === 'string' ? formatDate(date) : '',
                }),
              )
              return
            }
            case 'not_permitted_by_member': {
              onOpenChange(false)
              const reason =
                failure.details.reason === 'verified_only' ? 'verified_only' : 'preference_match'
              onOutcome({ kind: 'not_permitted', reason })
              return
            }
            case 'limit_reached':
              // The global handler opened the limit dialog with the daily text; name the limit
              // that was hit. The send dialog stays open under it.
              showLimitDialog({
                textKey: sendLimitTextKey(failure.details.limit),
                details: failure.details,
              })
              return
            default:
              return
          }
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('profile:send.title', { name })}</DialogTitle>
            <DialogDescription>{t('profile:send.left', { left, total: perDay })}</DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              {t('profile:send.templates_label')}
            </legend>
            <div className="flex flex-col gap-2">
              {templates.map((key) => {
                const text = t(`profile:send.${key}`)
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={message === text}
                    onClick={() => setMessage(text)}
                    className={cn(
                      'min-h-11 rounded-[var(--radius-input)] border px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      message === text
                        ? 'border-primary bg-primary-soft'
                        : 'border-input bg-surface hover:bg-muted',
                    )}
                  >
                    {text}
                  </button>
                )
              })}
              <button
                type="button"
                aria-pressed={message === ''}
                onClick={() => setMessage('')}
                className={cn(
                  'min-h-11 self-start rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  message === ''
                    ? 'border-primary bg-primary-soft'
                    : 'border-input bg-surface hover:bg-muted',
                )}
              >
                {t('profile:send.template_none')}
              </button>
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId}>
              {t('profile:send.message_label')}{' '}
              <span className="font-normal text-muted-foreground">{t('common:optional')}</span>
            </Label>
            <Textarea
              id={fieldId}
              name="message"
              dir="auto"
              rows={4}
              value={message}
              maxLength={MESSAGE_MAX}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${fieldId}-help ${fieldId}-count${error ? ` ${fieldId}-error` : ''}`}
              onChange={(event) => setMessage(event.target.value)}
            />
            <div className="flex justify-between gap-3 text-sm text-muted-foreground">
              <p id={`${fieldId}-help`}>{t('profile:send.helper')}</p>
              <p id={`${fieldId}-count`} className="shrink-0">
                {t('profile:send.count', { count: message.length, max: MESSAGE_MAX })}
              </p>
            </div>
            {error ? (
              <p id={`${fieldId}-error`} className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={send.isPending} disabled={!online}>
              {t('profile:send.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
