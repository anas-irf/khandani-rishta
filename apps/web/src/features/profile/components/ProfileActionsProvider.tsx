import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BlockDialog } from '~/components/common/BlockDialog'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { DeclineDialog } from '~/components/common/DeclineDialog'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { useGoBack } from '~/components/common/PageHeader'
import { ReportDialog } from '~/components/common/ReportDialog'
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
import { NoteDialog, type NoteTarget } from '~/features/discovery/components/NoteDialog'
import { usePassWithUndo } from '~/features/discovery/components/usePassWithUndo'
import {
  useAcceptInterest,
  useDeclineInterest,
  useWithdrawInterest,
} from '~/features/interests/queries'
import { isApiError } from '~/lib/api'
import type { ProfileDetail } from '~/lib/api-types'
import { showLimitDialog } from '~/lib/dialogs'
import { qk } from '~/lib/query'
import { actionBarState, type ProfileActions, ProfileActionsContext } from './actions'
import { SendInterestDialog, type SendOutcome } from './SendInterestDialog'

type DialogName =
  | 'send'
  | 'withdraw'
  | 'decline'
  | 'report'
  | 'block'
  | 'open_interest'
  | 'mutual'
  | 'not_permitted'
  | null

/**
 * The mutations and dialogs behind the actions of `APP-PROFILE` (16 section 6.7), kept in one
 * place: the top bar, the phone bar and the side rail only open them.
 */
export function ProfileActionsProvider({
  detail,
  children,
}: {
  detail: ProfileDetail
  children: ReactNode
}) {
  const { t } = useTranslation('profile')
  const navigate = useNavigate()
  const goBack = useGoBack()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const { card, relation } = detail
  const name = card.display_name
  const profileId = card.id
  const [dialog, setDialog] = useState<DialogName>(null)
  const [mutualConnection, setMutualConnection] = useState<string | null>(null)
  const [notPermitted, setNotPermitted] = useState<'verified_only' | 'preference_match'>(
    'verified_only',
  )
  const [note, setNote] = useState<NoteTarget | null>(null)

  const accept = useAcceptInterest({ limitText: 'profile:accept.limit_you' })
  const decline = useDeclineInterest()
  const withdraw = useWithdrawInterest()
  const pass = usePassWithUndo()

  const refetchProfile = () => queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })
  const close = () => setDialog(null)
  const toggle = (which: DialogName) => (open: boolean) => setDialog(open ? which : null)

  const onSendOutcome = (outcome: SendOutcome) => {
    if (outcome.kind === 'connected') {
      setMutualConnection(outcome.connectionId)
      setDialog('mutual')
    } else if (outcome.kind === 'not_permitted') {
      setNotPermitted(outcome.reason)
      setDialog('not_permitted')
    }
  }

  const actions: ProfileActions = {
    detail,
    state: actionBarState(relation),
    online,
    accepting: accept.isPending,
    accept: () => {
      if (!relation.interest) return
      accept.mutate(
        { id: relation.interest.id, profileId },
        {
          onSuccess: (result) => {
            toast.success(t('accept.done'))
            void navigate({
              to: '/chats/$connectionId',
              params: { connectionId: result.connection.id },
            })
          },
          onError: (error) => {
            if (!isApiError(error)) return
            if (error.code === 'limit_reached' && error.details.side === 'them') {
              showLimitDialog({ textKey: 'profile:accept.limit_them', details: error.details })
            }
            if (error.code === 'invalid_state') void refetchProfile()
          },
        },
      )
    },
    openSend: () => setDialog('send'),
    openDecline: () => setDialog('decline'),
    openWithdraw: () => setDialog('withdraw'),
    openReport: () => setDialog('report'),
    openBlock: () => setDialog('block'),
    pass: () => {
      pass(profileId, { message: t('pass.done') })
      if (relation.interest?.direction === 'sent') setDialog('open_interest')
      else goBack()
    },
    shortlisted: () => {
      toast(t('actions.shortlisted'), {
        action: {
          label: t('actions.add_note'),
          onClick: () => setNote({ profileId, note: relation.shortlist_note, name }),
        },
      })
    },
  }

  return (
    <ProfileActionsContext.Provider value={actions}>
      {children}

      <SendInterestDialog
        open={dialog === 'send'}
        onOpenChange={toggle('send')}
        profileId={profileId}
        name={name}
        onOutcome={onSendOutcome}
      />
      <ConfirmDialog
        open={dialog === 'withdraw'}
        onOpenChange={toggle('withdraw')}
        placement="rail"
        tone="ink"
        title={t('withdraw.title')}
        description={t('withdraw.text')}
        confirmLabel={t('withdraw.confirm')}
        onConfirm={async () => {
          if (!relation.interest) return
          try {
            await withdraw.mutateAsync({ id: relation.interest.id, profileId })
            toast.success(t('withdraw.done'))
          } catch (error) {
            if (isApiError(error) && error.code === 'invalid_state') void refetchProfile()
            throw error
          }
        }}
      />
      <DeclineDialog
        open={dialog === 'decline'}
        onOpenChange={toggle('decline')}
        name={name}
        namespace="profile"
        onDecline={async (alsoBlock) => {
          if (!relation.interest) return
          try {
            await decline.mutateAsync({ id: relation.interest.id, profileId, alsoBlock })
            toast.success(t('decline.done'))
            close()
            goBack()
          } catch (error) {
            if (isApiError(error) && error.code === 'invalid_state') void refetchProfile()
            throw error
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'open_interest'}
        onOpenChange={(open) => {
          if (!open) {
            close()
            goBack()
          }
        }}
        placement="rail"
        tone="ink"
        title={t('pass.open_interest', { name })}
        description=""
        confirmLabel={t('pass.withdraw')}
        cancelLabel={t('pass.keep')}
        onConfirm={async () => {
          if (relation.interest) {
            await withdraw.mutateAsync({ id: relation.interest.id, profileId })
            toast.success(t('withdraw.done'))
          }
        }}
      />
      <AlertDialog open={dialog === 'mutual'} onOpenChange={(open) => (open ? null : close())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('send.mutual_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('send.mutual_text')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('send.later')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mutualConnection) {
                  void navigate({
                    to: '/chats/$connectionId',
                    params: { connectionId: mutualConnection },
                  })
                }
              }}
            >
              {t('send.start_chatting')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={dialog === 'not_permitted'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`cannot_send.${notPermitted}`)}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t(`cannot_send.${notPermitted}`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('load.ok')}</AlertDialogCancel>
            {notPermitted === 'verified_only' ? (
              <AlertDialogAction onClick={() => void navigate({ to: '/me/verification' })}>
                {t('send.verify_now')}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReportDialog
        open={dialog === 'report'}
        onOpenChange={toggle('report')}
        profileId={profileId}
        name={name}
      />
      <BlockDialog
        open={dialog === 'block'}
        onOpenChange={toggle('block')}
        profileId={profileId}
        name={name}
      />
      <NoteDialog entry={note} onClose={() => setNote(null)} />
    </ProfileActionsContext.Provider>
  )
}
