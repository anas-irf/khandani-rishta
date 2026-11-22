import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FieldError, OptionalMark } from '~/components/common/fields/field-shell'
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
import { Toggle } from '~/components/ui/toggle'
import { useSendInterest } from '~/features/interests/queries'
import { isApiError } from '~/lib/api'
import type { SendInterestResult } from '~/lib/api-types'
import { showLimitDialog } from '~/lib/dialogs'
import { serverFieldMessage } from '~/lib/form-context'
import { formatDate } from '~/lib/format'
import { useCurrentMe } from '~/lib/me'
import { qk } from '~/lib/query'

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
 * as rows that fill the field (the third only when the sender's profile is managed by someone
 * else), and the helper text. Then `POST /v1/interests`; every error code of 6.7 is answered here
 * or passed to `onOutcome`. A bottom sheet on phones, in the rail's place on wide screens.
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

  const choice = (value: string, label: string) => (
    <Toggle
      key={value}
      variant="row"
      className="py-2"
      pressed={message === value}
      onPressedChange={() => setMessage(value)}
    >
      {label}
    </Toggle>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent placement="rail" closeLabel={t('common:actions.close')}>
        {/* Close set: "Send interest" is on screen when this opens at 1280x800 and 360x800. */}
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{t('profile:send.title', { name })}</DialogTitle>
            <DialogDescription className="text-body-sm tabular-nums">
              {t('profile:send.left', { left, total: perDay })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId} className="flex-wrap">
              {t('profile:send.message_label')} <OptionalMark />
            </Label>
            <Textarea
              id={fieldId}
              name="message"
              dir="auto"
              rows={3}
              value={message}
              maxLength={MESSAGE_MAX}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${fieldId}-help ${fieldId}-count${error ? ` ${fieldId}-error` : ''}`}
              onChange={(event) => setMessage(event.target.value)}
            />
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
              <p id={`${fieldId}-help`} className="min-w-0 flex-[1_1_12rem]">
                {t('profile:send.helper')}
              </p>
              <p id={`${fieldId}-count`} className="tabular-nums">
                {t('profile:send.count', { count: message.length, max: MESSAGE_MAX })}
              </p>
            </div>
            <FieldError id={`${fieldId}-error`} message={error ?? undefined} />
          </div>
          <fieldset>
            <legend className="mb-1 text-label-lg">{t('profile:send.templates_label')}</legend>
            <div className="flex flex-col gap-2">
              {templates.map((key) => {
                const text = t(`profile:send.${key}`)
                return choice(text, text)
              })}
              {choice('', t('profile:send.template_none'))}
            </div>
          </fieldset>
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
