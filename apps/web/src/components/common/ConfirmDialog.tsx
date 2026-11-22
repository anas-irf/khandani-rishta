import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useOnlineStatus } from './OfflineBanner'

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A question for a choice ("Block Ayesha K.?", 16 section 8.3). */
  title: string
  /** One or two sentences naming the consequence (16 rule G8). */
  description: ReactNode
  /** Repeats the verb: "Block", "End connection". */
  confirmLabel: string
  cancelLabel?: string
  /**
   * The confirming button (DESIGN.md 6.1): `ink` for a negative choice that destroys nothing
   * (decline, withdraw), `danger` for one that does (block, delete).
   */
  tone?: 'default' | 'ink' | 'danger'
  /** `rail` takes the place of a profile's side rail on wide screens (DESIGN.md 6.13). */
  placement?: 'center' | 'rail'
  /** A phrase the member must type before the confirm button is enabled (e.g. "DELETE"). */
  confirmPhrase?: string
  /** Label of the phrase field (default "Type {phrase} to confirm"). */
  phraseLabel?: string
  /**
   * Runs on confirm. A returned promise keeps the dialog open with a spinner until it settles;
   * it closes on success and stays open on failure (the error is shown by its handler).
   */
  onConfirm: () => unknown
  /** Extra content between the text and the buttons (a checkbox, a select). */
  children?: ReactNode
}

const CONFIRM_VARIANT = { default: 'default', ink: 'ink', danger: 'destructive' } as const

/**
 * The confirmation dialog of 16 rule G8, built on `AlertDialog` (focus starts on Cancel, Escape
 * closes, the overlay does not): a bottom sheet on phones, with two equal buttons 56 tall.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  placement,
  confirmPhrase,
  phraseLabel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const { t } = useTranslation(['shared', 'common'])
  const online = useOnlineStatus()
  const phraseId = useId()
  const [phrase, setPhrase] = useState('')
  const [pending, setPending] = useState(false)

  const phraseMatches = !confirmPhrase || phrase.trim() === confirmPhrase

  const handleOpenChange = (next: boolean) => {
    if (pending) return
    if (!next) setPhrase('')
    onOpenChange(next)
  }

  const confirm = async () => {
    if (!phraseMatches || pending) return
    setPending(true)
    try {
      await onConfirm()
      setPhrase('')
      onOpenChange(false)
    } catch {
      // The mutation's error handler has already told the member; keep the dialog open.
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        placement={placement}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {/* Empty without a consequence to name: the title already asks the whole question. */}
          <AlertDialogDescription className={description ? 'text-foreground' : 'sr-only'}>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmPhrase ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={phraseId}>
              {phraseLabel ?? t('shared:confirm.type_phrase', { phrase: confirmPhrase })}
            </Label>
            <Input
              id={phraseId}
              value={phrase}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => setPhrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void confirm()
              }}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel ?? t('common:actions.cancel')}
          </AlertDialogCancel>
          <Button
            variant={CONFIRM_VARIANT[tone]}
            disabled={!phraseMatches || !online}
            loading={pending}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
