import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, PartyPopper } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
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
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { usePauseProfile } from '~/features/settings/queries'
import type { Connection, OwnProfile, ProposableStage } from '~/lib/api-types'
import { invalidateMe, qk } from '~/lib/query'
import { cn } from '~/lib/utils'
import { useStageAction } from './queries'
import { laterStages, otherName, STAGES, stageIndex, stageName } from './text'

// ---------------------------------------------------------------------------------------------
// "Families usually exchange contact details" card, once per connection (16 section 6.12)
// ---------------------------------------------------------------------------------------------

function shareHintKey(connectionId: string) {
  return `kr.chat.share_hint.${connectionId}`
}

export function readShareHint(connectionId: string): 'pending' | 'done' | null {
  try {
    const value = window.localStorage.getItem(shareHintKey(connectionId))
    return value === 'pending' || value === 'done' ? value : null
  } catch {
    return null
  }
}

export function writeShareHint(connectionId: string, value: 'pending' | 'done') {
  try {
    window.localStorage.setItem(shareHintKey(connectionId), value)
  } catch {
    // Without storage the hint is simply not remembered.
  }
}

// ---------------------------------------------------------------------------------------------
// Suggestion banner in APP-CHAT (16 section 6.11 block 2)
// ---------------------------------------------------------------------------------------------

export function ProposalBanner({ connection }: { connection: Connection }) {
  const { t } = useTranslation('chat')
  const action = useStageAction()
  const online = useOnlineStatus()
  const proposal = connection.pending_stage_proposal
  if (!proposal || connection.status !== 'active') return null
  const name = otherName(t, connection)
  const stage = stageName(t, proposal.stage)
  const busy = action.isPending

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-border bg-warning-soft px-4 py-2 text-sm"
    >
      <p className="min-w-0 flex-1">
        {proposal.proposed_by === 'them'
          ? t('stage.they_suggest', { name, stage })
          : t('stage.you_suggested_short', { name, stage })}
      </p>
      {proposal.proposed_by === 'them' ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-11"
            loading={busy && action.variables?.kind === 'confirm'}
            disabled={busy || !online}
            onClick={() =>
              action.mutate({ kind: 'confirm', id: connection.id, proposalId: proposal.id })
            }
          >
            {t('stage.confirm')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-11"
            loading={busy && action.variables?.kind === 'decline'}
            disabled={busy || !online}
            onClick={() =>
              action.mutate({ kind: 'decline', id: connection.id, proposalId: proposal.id })
            }
          >
            {t('stage.not_yet')}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="h-11"
          loading={busy}
          disabled={!online}
          onClick={() =>
            action.mutate({ kind: 'cancel', id: connection.id, proposalId: proposal.id })
          }
        >
          {t('stage.withdraw')}
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Stage block in APP-CONNECTION (16 section 6.12)
// ---------------------------------------------------------------------------------------------

export function StageBlock({
  connection,
  canEngage,
}: {
  connection: Connection
  canEngage: boolean
}) {
  const { t } = useTranslation('chat')
  const action = useStageAction()
  const online = useOnlineStatus()
  const [choosing, setChoosing] = useState(false)
  const current = stageIndex(connection.stage)
  const proposal = connection.pending_stage_proposal
  const name = otherName(t, connection)

  let controls: ReactNode = null
  if (connection.stage === 'nikah_done') {
    controls = (
      <p className="flex items-center gap-2 font-medium">
        <PartyPopper aria-hidden="true" className="size-5 text-accent" />
        {t('stage.done', { stage: stageName(t, connection.stage) })}
      </p>
    )
  } else if (proposal?.proposed_by === 'me') {
    controls = (
      <div className="flex flex-col gap-2">
        <p>{t('stage.you_suggested', { stage: stageName(t, proposal.stage), name })}</p>
        {canEngage ? (
          <Button
            variant="secondary"
            className="self-start"
            loading={action.isPending}
            disabled={!online}
            onClick={() =>
              action.mutate({ kind: 'cancel', id: connection.id, proposalId: proposal.id })
            }
          >
            {t('stage.withdraw')}
          </Button>
        ) : null}
      </div>
    )
  } else if (proposal?.proposed_by === 'them') {
    controls = (
      <div className="flex flex-col gap-2">
        <p>{t('stage.they_suggest', { name, stage: stageName(t, proposal.stage) })}</p>
        {canEngage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              loading={action.isPending && action.variables?.kind === 'confirm'}
              disabled={action.isPending || !online}
              onClick={() =>
                action.mutate({ kind: 'confirm', id: connection.id, proposalId: proposal.id })
              }
            >
              {t('stage.confirm')}
            </Button>
            <Button
              variant="secondary"
              loading={action.isPending && action.variables?.kind === 'decline'}
              disabled={action.isPending || !online}
              onClick={() =>
                action.mutate({ kind: 'decline', id: connection.id, proposalId: proposal.id })
              }
            >
              {t('stage.not_yet')}
            </Button>
          </div>
        ) : null}
      </div>
    )
  } else if (canEngage) {
    controls = (
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => setChoosing(true)}
        disabled={!online}
      >
        {t('stage.suggest')}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={t('stage.tracker_label')} className="grid grid-cols-4 gap-1">
        {STAGES.map((stage, index) => {
          const reached = index <= current
          return (
            <li key={stage} className="flex flex-col items-center gap-1 text-center">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold',
                  reached
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-surface text-muted-foreground',
                )}
              >
                {reached ? <Check className="size-4" /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-sm leading-tight',
                  reached ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                <span className="sr-only">
                  {t(reached ? 'stage.step_reached' : 'stage.step_not_reached', {
                    stage: stageName(t, stage),
                  })}
                </span>
                <span aria-hidden="true">{stageName(t, stage)}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {controls}
      {choosing ? (
        <SuggestStageDialog connection={connection} onClose={() => setChoosing(false)} />
      ) : null}
    </div>
  )
}

function SuggestStageDialog({
  connection,
  onClose,
}: {
  connection: Connection
  onClose: () => void
}) {
  const { t } = useTranslation(['chat', 'common'])
  const action = useStageAction()
  const online = useOnlineStatus()
  const legend = useId()
  const options = laterStages(connection.stage)
  const [stage, setStage] = useState<ProposableStage | ''>(options[0] ?? '')

  const submit = async () => {
    if (!stage) return
    try {
      await action.mutateAsync({ kind: 'propose', id: connection.id, stage })
    } catch {
      // Refetch or the cooldown toast happened in the hook.
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common:actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('chat:stage.suggest')}</DialogTitle>
          <DialogDescription className="sr-only">{t('chat:stage.choose_label')}</DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={stage}
          onValueChange={(value) => {
            const picked = options.find((option) => option === value)
            if (picked) setStage(picked)
          }}
          aria-labelledby={legend}
          className="gap-1"
        >
          <span id={legend} className="sr-only">
            {t('chat:stage.choose_label')}
          </span>
          {options.map((option) => (
            <Label
              key={option}
              className="min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-input)] p-2 font-normal hover:bg-muted"
            >
              <RadioGroupItem value={option} className="mt-1" />
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-medium">{stageName(t, option)}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`chat:stage.explain.${option}`)}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={action.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            loading={action.isPending}
            disabled={!stage || !online}
          >
            {t('chat:stage.suggest_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Follow-ups after a stage is reached (11 section 9.4, 16 section 6.12)
// ---------------------------------------------------------------------------------------------

/**
 * Watches the connection's stage and shows the follow-up when it moves forward: for the member
 * who confirmed (the response) and for the other member (the `connection.updated` event).
 */
export function StageFollowUps({ connection }: { connection: Connection }) {
  const { t } = useTranslation('chat')
  const queryClient = useQueryClient()
  const pause = usePauseProfile()
  const previous = useRef(connection.stage)
  const [dialog, setDialog] = useState<'engaged' | 'nikah' | null>(null)

  useEffect(() => {
    const before = previous.current
    previous.current = connection.stage
    if (stageIndex(connection.stage) <= stageIndex(before)) return
    if (connection.stage === 'families_talking') {
      toast.success(t('stage.marked', { stage: stageName(t, connection.stage) }))
      if (readShareHint(connection.id) === null) writeShareHint(connection.id, 'pending')
    } else if (connection.stage === 'engaged') {
      setDialog('engaged')
    } else if (connection.stage === 'nikah_done') {
      setDialog('nikah')
      void invalidateMe(queryClient)
    }
  }, [connection.stage, connection.id, queryClient, t])

  const religion = queryClient.getQueryData<OwnProfile>(qk.ownProfile())?.community.religion_code
  const muslim = !religion || religion === 'islam'

  return (
    <>
      <ConfirmDialog
        open={dialog === 'engaged'}
        onOpenChange={(open) => setDialog(open ? 'engaged' : null)}
        title={t('stage.engaged_title')}
        description={t('stage.engaged_text')}
        confirmLabel={t('stage.engaged_pause')}
        cancelLabel={t('stage.engaged_not_now')}
        onConfirm={() => pause.mutateAsync()}
      />
      <AlertDialog
        open={dialog === 'nikah'}
        onOpenChange={(open) => setDialog(open ? 'nikah' : null)}
      >
        <AlertDialogContent className="max-md:h-dvh max-md:max-w-none max-md:rounded-none">
          <AlertDialogHeader className="items-center text-center">
            <PartyPopper aria-hidden="true" className="size-12 text-accent" />
            <AlertDialogTitle className="text-2xl">
              {muslim ? t('stage.nikah_title') : t('stage.nikah_title_other')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground">
              {t('stage.nikah_text')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Link to="/nikah-guide">{t('stage.nikah_guide')}</Link>
            </AlertDialogCancel>
            <AlertDialogAction>{t('stage.nikah_close')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
