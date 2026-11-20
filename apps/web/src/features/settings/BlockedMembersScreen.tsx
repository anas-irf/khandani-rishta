// SET-BLOCKED (16 section 6.29)
import { useQueryClient } from '@tanstack/react-query'
import { UserX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PageHeader } from '~/components/common/PageHeader'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Button } from '~/components/ui/button'
import { useUnblockMember } from '~/features/relations/queries'
import { isApiError } from '~/lib/api'
import type { BlockEntry } from '~/lib/api-types'
import { formatRelative } from '~/lib/format'
import { qk } from '~/lib/query'
import { SettingsPage } from './controls'
import { useBlocks } from './queries'

export function BlockedMembersScreen() {
  return (
    <ScreenAccess screen="SET-BLOCKED">
      <BlockedMembersContent />
    </ScreenAccess>
  )
}

function BlockedMembersContent() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const query = useBlocks()
  const unblock = useUnblockMember()
  const [target, setTarget] = useState<BlockEntry | null>(null)

  const confirmUnblock = async () => {
    if (!target) return
    try {
      await unblock.mutateAsync(target.profile_id)
      toast.success(t('blocked.unblocked'))
    } catch (error) {
      // Already unblocked elsewhere: the row is stale, so refresh the list and close the dialog.
      if (isApiError(error) && error.code === 'not_found') {
        void queryClient.invalidateQueries({ queryKey: qk.blocks() })
        return
      }
      throw error
    }
  }

  return (
    <SettingsPage>
      <PageHeader title={t('blocked.title')} backTo="/settings" />
      <p className="text-muted-foreground">{t('blocked.text')}</p>
      <InfiniteList
        query={query}
        label={t('blocked.list_label')}
        getKey={(entry) => entry.profile_id}
        renderItem={(entry) => (
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p dir="auto" className="truncate font-semibold">
                {entry.display_name}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('blocked.code', { code: entry.public_code })}
              </p>
              <p className="text-sm text-muted-foreground">
                <time dateTime={entry.created_at}>
                  {t('blocked.since', { when: formatRelative(entry.created_at) })}
                </time>
              </p>
            </div>
            <Button variant="secondary" disabled={!online} onClick={() => setTarget(entry)}>
              {t('blocked.unblock')}
            </Button>
          </div>
        )}
        empty={<EmptyState icon={UserX} title={t('blocked.empty')} />}
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title={t('blocked.unblock_dialog.title', { name: target?.display_name ?? '' })}
        description={t('blocked.unblock_dialog.text')}
        confirmLabel={t('blocked.unblock')}
        onConfirm={confirmUnblock}
      />
    </SettingsPage>
  )
}
