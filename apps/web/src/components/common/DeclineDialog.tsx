import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '~/components/ui/checkbox'
import { Label } from '~/components/ui/label'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * The decline dialog of DESIGN.md 6.13 and 16 section 6.7, shared by the profile and Interests:
 * a bottom sheet on phones and the side panel on wide screens, a 48 tall "Also block" row, and
 * Decline in ink. Declining is quiet, so the text says the other member is not told.
 */
export function DeclineDialog({
  open,
  onOpenChange,
  name,
  namespace,
  onDecline,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The member's `display_name`. */
  name: string
  /** Both screens keep the dialog's copy under `decline.*` of their own namespace. */
  namespace: 'profile' | 'interests'
  onDecline: (alsoBlock: boolean) => Promise<void>
}) {
  const { t } = useTranslation(namespace)
  const [alsoBlock, setAlsoBlock] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setAlsoBlock(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      placement="rail"
      tone="ink"
      title={t('decline.title')}
      description={t('decline.text', { name })}
      confirmLabel={t('decline.confirm')}
      onConfirm={() => onDecline(alsoBlock)}
    >
      <Label variant="option">
        <Checkbox
          checked={alsoBlock}
          onCheckedChange={(checked) => setAlsoBlock(checked === true)}
        />
        <span className="min-w-0">{t('decline.also_block', { name })}</span>
      </Label>
    </ConfirmDialog>
  )
}
