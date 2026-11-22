import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleAlert, PartyPopper } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArchIcon } from '~/components/common/Arch'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { displayHeadingVariants } from '~/components/common/DisplayHeading'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Diamond, OrnamentRule } from '~/components/common/Ornament'
import { RadioCard } from '~/components/common/RadioCard'
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
import { RadioGroup } from '~/components/ui/radio-group'
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
      className="flex max-h-[35dvh] flex-wrap items-center gap-2 overflow-y-auto border-b border-border bg-warning-soft px-[16px] py-2 text-body-sm [--tonal:var(--color-background)]"
    >
      <p className="flex min-w-[min(100%,14rem)] flex-1 items-start gap-2">
        <span aria-hidden="true" className="flex h-[1lh] items-center">
          <CircleAlert className="size-4 text-warning" />
        </span>
        <span className="min-w-0">
          {proposal.proposed_by === 'them'
            ? t('stage.they_suggest', { name, stage })
            : t('stage.you_suggested_short', { name, stage })}
        </span>
      </p>
      {proposal.proposed_by === 'them' ? (
        <div className="flex max-w-full flex-wrap gap-2">
          <Button
            loading={busy && action.variables?.kind === 'confirm'}
            disabled={busy || !online}
            onClick={() =>
              action.mutate({ kind: 'confirm', id: connection.id, proposalId: proposal.id })
            }
          >
            {t('stage.confirm')}
          </Button>
          <Button
            variant="secondary"
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
          variant="secondary"
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
      <p className="flex items-start gap-2 text-title-sm">
        <span aria-hidden="true" className="flex h-[1lh] items-center">
          <PartyPopper className="size-5 text-primary" />
        </span>
        <span className="min-w-0">
          {t('stage.done', { stage: stageName(t, connection.stage) })}
        </span>
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
      <ol
        aria-label={t('stage.tracker_label')}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-x-[8px] gap-y-3"
      >
        {STAGES.map((stage, index) => {
          const reached = index <= current
          return (
            <li key={stage} className="flex flex-col items-center gap-2 text-center">
              {/* An arch per step, filled once reached. No tick: that means verified (6.6). */}
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-[44px] w-[36px] items-center justify-center rounded-arch-sm border-[1.5px] text-label-md tabular-nums',
                  reached
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input text-muted-foreground',
                )}
              >
                {reached ? <Diamond className="bg-primary-foreground" /> : index + 1}
              </span>
              <span
                className={cn(
                  'max-w-full text-caption',
                  reached ? 'font-bold' : 'text-muted-foreground',
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
        >
          <span id={legend} className="sr-only">
            {t('chat:stage.choose_label')}
          </span>
          {options.map((option) => (
            <RadioCard
              key={option}
              id={`${legend}-${option}`}
              value={option}
              label={stageName(t, option)}
              description={t(`chat:stage.explain.${option}`)}
            />
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
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
        <AlertDialogContent className="max-wide:h-dvh max-wide:max-h-none max-wide:justify-center max-wide:rounded-none">
          <AlertDialogHeader className="items-center gap-4 text-center">
            <ArchIcon icon={PartyPopper} size="lg" tone="outline" />
            <OrnamentRule centered />
            <AlertDialogTitle className={displayHeadingVariants({ size: 'sm' })}>
              {muslim ? t('stage.nikah_title') : t('stage.nikah_title_other')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-foreground">
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
