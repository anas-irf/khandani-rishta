// SET-BLOCKED (16 section 6.29)
import { useQueryClient } from '@tanstack/react-query'
import { UserX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MonogramArch } from '~/components/common/Arch'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { PageHeader } from '~/components/common/PageHeader'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Button } from '~/components/ui/button'
import { useUnblockMember } from '~/features/relations/queries'
import { isApiError } from '~/lib/api'
import type { BlockEntry } from '~/lib/api-types'
import { formatRelative } from '~/lib/format'
import { qk } from '~/lib/query'
import { useBlocks } from './queries'

export function BlockedMembersScreen() {
  const { t } = useTranslation('settings')
  return (
    <ScreenAccess
      screen="SET-BLOCKED"
      panelTitleAs="h2"
      header={<PageHeader title={t('blocked.title')} backTo="/settings" width="column" />}
    >
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
    <Page
      title={t('blocked.title')}
      description={t('blocked.text')}
      backTo="/settings"
      width="column"
    >
      <InfiniteList
        query={query}
        label={t('blocked.list_label')}
        getKey={(entry) => entry.profile_id}
        renderItem={(entry) => (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <MonogramArch name={entry.display_name} size="sm" />
            <div className="flex min-w-[min(100%,10rem)] flex-1 flex-col gap-1">
              <p dir="auto" className="text-title-md">
                {entry.display_name}
              </p>
              <p className="text-caption text-muted-foreground tabular-nums">
                {t('blocked.code', { code: entry.public_code })}
              </p>
              <p className="text-caption text-muted-foreground">
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
    </Page>
  )
}
