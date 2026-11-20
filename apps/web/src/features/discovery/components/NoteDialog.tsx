import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { usePutShortlistNote } from '../queries'

/** At most 300 characters (16 sections 6.7 and 6.13). */
export const NOTE_MAX = 300

/** "Edit note": a text field of at most 300 characters, saved with `PUT /v1/shortlist/{id}`. */
export type NoteTarget = { profileId: string; note: string | null; name: string }

export function NoteDialog({ entry, onClose }: { entry: NoteTarget | null; onClose: () => void }) {
  const { t } = useTranslation(['discovery', 'common'])
  const putNote = usePutShortlistNote()
  const fieldId = useId()
  const [note, setNote] = useState('')
  const [seen, setSeen] = useState<typeof entry>(null)
  if (entry !== seen) {
    setSeen(entry)
    setNote(entry?.note ?? '')
  }
  const name = entry?.name ?? ''

  const save = () => {
    if (!entry) return
    const trimmed = note.trim()
    putNote.mutate(
      { profileId: entry.profileId, note: trimmed || null },
      {
        onSuccess: () => {
          toast.success(t('discovery:shortlist.note_saved'))
          onClose()
        },
      },
    )
  }

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('discovery:shortlist.note_title', { name })}</DialogTitle>
          <DialogDescription>{t('discovery:shortlist.note_help')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={fieldId}>{t('discovery:shortlist.note_label')}</Label>
          <Textarea
            id={fieldId}
            dir="auto"
            value={note}
            maxLength={NOTE_MAX}
            rows={4}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={`${fieldId}-count`}
          />
          <p id={`${fieldId}-count`} className="text-end text-sm text-muted-foreground">
            {t('discovery:shortlist.note_count', { count: note.length, max: NOTE_MAX })}
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={save} loading={putNote.isPending}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
