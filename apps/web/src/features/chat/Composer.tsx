import { Link } from '@tanstack/react-router'
import { SendHorizontal } from 'lucide-react'
import { type KeyboardEvent, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { sendTyping } from '~/lib/realtime'
import { cn } from '~/lib/utils'
import { MESSAGE_MAX_LENGTH } from './queries'

const COUNTER_FROM = 1800

export type ComposerBlock = 'ended' | 'unavailable' | 'closed' | 'offline'

/**
 * Why the composer is replaced by a grey bar (16 section 6.11 "Composer disabled states"), in
 * the order of that table, or null when the member can write.
 */
export function composerBlock(options: {
  ended: boolean
  otherMissing: boolean
  ownClosed: boolean
  online: boolean
}): ComposerBlock | null {
  if (options.ended) return 'ended'
  if (options.otherMissing) return 'unavailable'
  if (options.ownClosed) return 'closed'
  if (!options.online) return 'offline'
  return null
}

export function ComposerDisabled({ reason }: { reason: ComposerBlock }) {
  const { t } = useTranslation('chat')
  return (
    <div
      role="status"
      className="border-t border-border bg-muted px-4 py-3 text-center text-sm text-muted-foreground"
      data-composer-disabled={reason}
    >
      {t(`disabled.${reason}`)}
      {reason === 'closed' ? (
        <>
          {' '}
          <Link to="/settings/account" className="font-medium text-primary underline">
            {t('disabled.reopen')}
          </Link>
        </>
      ) : null}
    </div>
  )
}

/**
 * The composer (16 section 6.11 block 5): grows to five lines, counter from 1,800 characters,
 * at most 2,000. On the web Enter sends and Shift plus Enter makes a new line. While the text
 * changes and the field has focus, a `typing` frame goes out at most every 3 seconds.
 */
export function Composer({
  connectionId,
  value,
  onChange,
  onSend,
  limitReached,
}: {
  connectionId: string
  value: string
  onChange: (value: string) => void
  /** Returns true when the message was accepted for sending (the field is then cleared). */
  onSend: (text: string) => boolean
  limitReached: boolean
}) {
  const { t } = useTranslation('chat')
  const ids = { field: useId(), counter: useId(), hint: useId() }
  const field = useRef<HTMLTextAreaElement | null>(null)
  const empty = value.trim().length === 0

  const send = () => {
    if (empty) return
    if (onSend(value)) {
      onChange('')
      field.current?.focus()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    send()
  }

  return (
    <div className="border-t border-border bg-surface px-3 py-2">
      {limitReached ? (
        <p
          role="alert"
          className="mb-2 rounded-[var(--radius-input)] bg-warning-soft px-3 py-2 text-sm"
        >
          {t('composer.limit_banner')}
        </p>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <label htmlFor={ids.field} className="sr-only">
          {t('composer.label')}
        </label>
        <textarea
          ref={field}
          id={ids.field}
          dir="auto"
          rows={1}
          value={value}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={t('composer.placeholder')}
          aria-describedby={`${ids.hint}${value.length >= COUNTER_FROM ? ` ${ids.counter}` : ''}`}
          onChange={(event) => {
            onChange(event.target.value)
            if (event.target.value.trim() && document.activeElement === event.target) {
              sendTyping(connectionId)
            }
          }}
          onKeyDown={onKeyDown}
          className="field-sizing-content max-h-[8.5rem] min-h-11 flex-1 resize-none rounded-[var(--radius-input)] border border-input bg-surface px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="icon" aria-label={t('composer.send')} disabled={empty}>
          <SendHorizontal aria-hidden="true" className="rtl:-scale-x-100" />
        </Button>
      </form>
      <div className="flex justify-between gap-2 pt-1 text-sm text-muted-foreground">
        <span id={ids.hint} className="sr-only">
          {t('composer.hint')}
        </span>
        {value.length >= COUNTER_FROM ? (
          <span
            id={ids.counter}
            className={cn('ms-auto', value.length >= MESSAGE_MAX_LENGTH && 'text-danger')}
          >
            {t('composer.counter', { count: value.length, max: MESSAGE_MAX_LENGTH })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
