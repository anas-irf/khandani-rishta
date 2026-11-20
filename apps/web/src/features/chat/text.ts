import type { TFunction } from 'i18next'
import type { Connection, Message, Stage } from '~/lib/api-types'

/** The stages in order (11 section 9.1). Stages only move forward and may skip. */
export const STAGES: readonly Stage[] = ['chatting', 'families_talking', 'engaged', 'nikah_done']

export function stageIndex(stage: string): number {
  return STAGES.indexOf(stage as Stage)
}

/** The stages a member may suggest from the current one. */
export function laterStages(current: Stage): Stage[] {
  return STAGES.filter((stage) => stageIndex(stage) > stageIndex(current))
}

/** "{stage name}" (11 section 9.1, owned there and quoted in 16 section 1.6). */
export function stageName(t: TFunction<'chat'>, stage: string): string {
  return t(`stage.name.${stage}`, { defaultValue: stage.replaceAll('_', ' ') })
}

/** The other member's name, or "Member no longer available" when `other` is null. */
export function otherName(t: TFunction<'chat'>, connection: Pick<Connection, 'other'>): string {
  return connection.other?.display_name ?? t('member_unavailable')
}

const KNOWN_EVENTS = new Set([
  'connected',
  'contact_shared',
  'contact_share_revoked',
  'stage_proposed',
  'stage_confirmed',
  'stage_declined',
  'connection_ended',
])

/**
 * The text of a system message (11 section 6.8): "You" wording when the member is the actor,
 * otherwise the "They" wording with {name}. Unknown events return null and are not shown.
 */
export function systemMessageText(
  t: TFunction<'chat'>,
  message: Pick<Message, 'system_event' | 'system_data'>,
  ownProfileId: string,
  name: string,
): string | null {
  const event = message.system_event
  if (!event || !KNOWN_EVENTS.has(event)) return null
  if (event === 'connection_ended') return t('system.connection_ended')
  const data = message.system_data ?? {}
  const side = data.actor_profile_id === ownProfileId ? 'me' : 'them'
  const stage = typeof data.stage === 'string' ? stageName(t, data.stage) : ''
  const key = event === 'stage_declined' && data.cancelled === true ? 'stage_cancelled' : event
  return t(`system.${key}.${side}`, { name, stage })
}

/** "Say salaam" when only the `connected` line exists (11 section 5.1, 16 section 6.10). */
export function hasNoTextMessages(connection: Connection): boolean {
  if (connection.last_message_at === null) return true
  const last = new Date(connection.last_message_at).getTime()
  const created = new Date(connection.created_at).getTime()
  return last - created < 1000
}

const WEEK_MS = 7 * 86_400_000

/** The quiet-chat hint (11 section 6.10), computed on the client. */
export function isQuiet(connection: Connection, now = Date.now()): boolean {
  if (connection.status !== 'active' || connection.stage !== 'chatting') return false
  const last = connection.last_message_at ?? connection.created_at
  return now - new Date(last).getTime() > WEEK_MS
}
