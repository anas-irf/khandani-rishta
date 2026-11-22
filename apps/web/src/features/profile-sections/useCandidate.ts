import { useMe } from '~/lib/me'
import { subjectOf, wordingContext } from './wording'

/**
 * How to talk about the candidate, the person the signed-in member's profile is for
 * (07 section 3.2, 16 section 1.1):
 *
 * - `context` picks the pronoun form of a string: "your city", "his city", "her city".
 * - `named` picks the form of a heading that names them ("Near Ayesha", "Ayesha's matches");
 *   pass it with `name`.
 */
export function useCandidate() {
  // Read from the cache without throwing: shared components also render outside AuthGate.
  const profile = useMe({ enabled: false }).data?.profile
  const subject = subjectOf(profile?.managed_by, profile?.gender)
  const managed = subject !== 'self'
  const name = profile?.first_name ?? ''
  return {
    managed,
    name,
    context: wordingContext(subject),
    named: managed && name ? 'named' : undefined,
  }
}
