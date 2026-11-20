// APP-SHORTLIST (16 section 6.13)
import { Link } from '@tanstack/react-router'
import { Heart, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PageHeader } from '~/components/common/PageHeader'
import { PlainText } from '~/components/common/PlainText'
import { ProfileCard } from '~/components/common/ProfileCard'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Button } from '~/components/ui/button'
import type { ShortlistEntry } from '~/lib/api-types'
import { formatRelative } from '~/lib/format'
import { NoteDialog, type NoteTarget } from './components/NoteDialog'
import { usePutShortlistNote, useRemoveFromShortlist, useShortlist } from './queries'

export function ShortlistScreen() {
  return (
    <div className="container-app">
      <ScreenAccess screen="APP-SHORTLIST">
        <ShortlistContent />
      </ScreenAccess>
    </div>
  )
}

function ShortlistContent() {
  const { t } = useTranslation('discovery')
  const shortlist = useShortlist()
  const [editing, setEditing] = useState<NoteTarget | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('shortlist.title')} description={t('shortlist.intro')} />
      <InfiniteList
        query={shortlist}
        getKey={(entry) => entry.profile_id}
        label={t('shortlist.label')}
        renderItem={(entry) => (
          <ShortlistRow
            entry={entry}
            onEditNote={() =>
              setEditing({
                profileId: entry.profile_id,
                note: entry.note,
                name: entry.profile?.display_name ?? '',
              })
            }
          />
        )}
        empty={
          <EmptyState
            icon={Heart}
            title={t('shortlist.empty_title')}
            text={t('shortlist.empty_text')}
            action={
              <Button asChild>
                <Link to="/matches">{t('shortlist.see_matches')}</Link>
              </Button>
            }
          />
        }
      />
      <NoteDialog entry={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function useRemoveWithUndo() {
  const { t } = useTranslation('discovery')
  const remove = useRemoveFromShortlist()
  const putNote = usePutShortlistNote()
  // Optimistic (G7): the row leaves at once with "Removed. Undo"; on failure it comes back.
  return (entry: ShortlistEntry) => {
    const toastId = toast(t('shortlist.removed'), {
      duration: 5000,
      action: {
        label: t('shortlist.undo'),
        onClick: () => putNote.mutate({ profileId: entry.profile_id, note: entry.note }),
      },
    })
    remove.mutate(entry, { onError: () => toast.dismiss(toastId) })
  }
}

function ShortlistRow({ entry, onEditNote }: { entry: ShortlistEntry; onEditNote: () => void }) {
  const { t } = useTranslation('discovery')
  const online = useOnlineStatus()
  const removeWithUndo = useRemoveWithUndo()

  if (!entry.profile) {
    return (
      <div
        data-unavailable=""
        className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-muted p-4 text-muted-foreground"
      >
        <span>{t('shortlist.unavailable')}</span>
        <Button
          variant="secondary"
          disabled={!online}
          aria-label={t('shortlist.remove_unavailable')}
          onClick={() => removeWithUndo(entry)}
        >
          <Trash2 aria-hidden="true" />
          {t('shortlist.remove')}
        </Button>
      </div>
    )
  }

  return (
    <ProfileCard
      card={entry.profile}
      size="compact"
      actions={
        <div className="flex w-full flex-col gap-2">
          {entry.note ? <PlainText text={entry.note} className="italic" /> : null}
          <p className="text-sm text-muted-foreground">
            {t('shortlist.saved_at', { time: formatRelative(entry.created_at) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!online} onClick={onEditNote}>
              <Pencil aria-hidden="true" />
              {t('shortlist.edit_note')}
            </Button>
            <Button variant="ghost" disabled={!online} onClick={() => removeWithUndo(entry)}>
              <Trash2 aria-hidden="true" />
              {t('shortlist.remove')}
            </Button>
          </div>
        </div>
      }
    />
  )
}
