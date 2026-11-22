import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

/** What staff should weigh before they confirm. */
export function DialogNote({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="rounded-md bg-warning-soft px-4 py-3 text-body-sm">
      {children}
    </p>
  )
}

export type ActionDialogProps = {
  title: string
  description?: ReactNode
  submitLabel: string
  destructive?: boolean
  /** Extra condition for the submit button (the form's own validation shows its messages). */
  canSubmit?: boolean
  /**
   * Runs on submit. The dialog stays open with a spinner until it settles, closes when it
   * resolves, and stays open when it throws (the caller shows the error).
   */
  onSubmit: () => Promise<unknown>
  onClose: () => void
  /** A summary of server errors, shown above the fields. */
  error?: ReactNode
  children?: ReactNode
  className?: string
}

/**
 * A dialog with a small form: the staff console's reason, note and confirmation dialogs
 * (18 sections 4 and 5). Mount it only while it is open, so its form starts empty each time.
 */
export function ActionDialog({
  title,
  description,
  submitLabel,
  destructive = false,
  canSubmit = true,
  onSubmit,
  onClose,
  error,
  children,
  className,
}: ActionDialogProps) {
  const { t } = useTranslation('admin')
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending || !canSubmit) return
    setPending(true)
    try {
      await onSubmit()
      onClose()
    } catch {
      // The caller has shown the error; the dialog stays open for another try.
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={t('actions.close')} className={className}>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{title}</DialogDescription>
            )}
          </DialogHeader>
          {error}
          {children}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'destructive' : 'default'}
              loading={pending}
              disabled={!canSubmit}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
