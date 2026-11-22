import { createContext, useContext } from 'react'
import type { ProfileDetail, Relation } from '~/lib/api-types'

/** Which row of the action bar table of 16 section 6.7 applies, top to bottom. */
export type ActionBarState = 'connection' | 'received' | 'sent' | 'can_send' | 'cannot_send'

export function actionBarState(relation: Relation): ActionBarState {
  if (relation.tier === 'connection') return 'connection'
  if (relation.tier === 'interest_from_owner') return 'received'
  if (relation.tier === 'interest_to_owner') return 'sent'
  return relation.can_send_interest ? 'can_send' : 'cannot_send'
}

/** The button text for a `cannot_send_reason` (16 section 6.7, row 5). */
export function cannotSendButtonKey(reason: Relation['cannot_send_reason']): string {
  if (reason === 'already_pending') return 'actions.interest_sent'
  if (reason === 'already_connected') return 'actions.connected'
  return 'actions.send_interest'
}

export type ProfileActions = {
  detail: ProfileDetail
  state: ActionBarState
  online: boolean
  accepting: boolean
  accept: () => void
  openSend: () => void
  openDecline: () => void
  openWithdraw: () => void
  openReport: () => void
  openBlock: () => void
  /** "Not interested". */
  pass: () => void
  /** After Shortlist added the profile: the toast that offers "Add a note". */
  shortlisted: () => void
}

export const ProfileActionsContext = createContext<ProfileActions | null>(null)

export function useProfileActions(): ProfileActions {
  const actions = useContext(ProfileActionsContext)
  if (!actions) throw new Error('useProfileActions needs a ProfileActionsProvider')
  return actions
}
