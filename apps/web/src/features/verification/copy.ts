import { useTranslation } from 'react-i18next'
import { useCurrentMe } from '~/lib/me'

/**
 * Every check is about the candidate (12 section 1.3). `{name}` in the copy of 12 section 8 is
 * the candidate's first name; a profile managed by the candidate uses "you" forms instead.
 */
export function useCandidate(): { self: boolean; name: string } {
  const me = useCurrentMe()
  const self = me.profile.managed_by === null || me.profile.managed_by === 'self'
  return { self, name: me.profile.first_name ?? '' }
}

/** The member-facing message for a verification `rejection_reason` (12 section 8.3). */
export function useRejectionText(): (reason: string | null) => string {
  const { t } = useTranslation('verification')
  const me = useCurrentMe()
  const candidate = useCandidate()
  return (reason) => {
    const key = reason && t(`reason.${reason}`, { defaultValue: '' }) ? reason : 'other'
    return t(`reason.${key}`, {
      name: candidate.name,
      support_email: me.config.support_email,
      context: key === 'face_mismatch' && candidate.self ? 'self' : undefined,
    })
  }
}

/** "Not approved: {reason text}. You can try again." without a doubled full stop. */
export function withoutFinalStop(text: string): string {
  return text.replace(/[.\s]+$/, '')
}
