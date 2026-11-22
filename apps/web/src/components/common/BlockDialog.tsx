import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useBlockMember } from '~/features/relations/queries'
import { ConfirmDialog } from './ConfirmDialog'
import { useGoBack } from './PageHeader'

export type BlockDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The member to block. */
  profileId: string
  /** Their `display_name`. */
  name: string
  /**
   * Runs after the block succeeded. Default: back to the previous screen (17 section 6.3), or
   * `/home` without history. The chat passes a navigation to `APP-CHATS` (16 section 6.11).
   */
  onBlocked?: () => void
}

/**
 * The block confirmation of 16 section 6.7, shared by the profile and chat screens:
 * "Block {name}?", the consequence, and "Block". Then `PUT /v1/blocks/{profile_id}`, the toast
 * "Blocked." and the way back. Errors get the generic toast of the global handler.
 */
export function BlockDialog({ open, onOpenChange, profileId, name, onBlocked }: BlockDialogProps) {
  const { t } = useTranslation('shared')
  const block = useBlockMember()
  const goBack = useGoBack()

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('block.title', { name })}
      description={t('block.text')}
      confirmLabel={t('block.confirm')}
      tone="danger"
      onConfirm={async () => {
        await block.mutateAsync(profileId)
        toast.success(t('block.success'))
        onOpenChange(false)
        ;(onBlocked ?? goBack)()
      }}
    />
  )
}
