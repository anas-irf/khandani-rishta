import { useQueryClient } from '@tanstack/react-query'
import type { OwnProfile, ProfileCard } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { useLabelOf } from '~/lib/reference'

/**
 * The facts of a member's meta line (16 section 1.5): the location, with the country when it is
 * not the viewer's own, the work, and the marital status when it is not "Never married".
 *
 * `viewerCountryCode` defaults to the country of the cached own profile; when neither is known
 * the country is not shown.
 */
export function useCardFacts(card: ProfileCard, viewerCountryCode?: string | null) {
  const label = useLabelOf()
  const queryClient = useQueryClient()

  const viewerCountry =
    viewerCountryCode !== undefined
      ? viewerCountryCode
      : (queryClient.getQueryData<OwnProfile>(qk.ownProfile())?.location.country_code ?? null)

  return {
    /** Null when the city alone says it. */
    country:
      viewerCountry && card.country_code !== viewerCountry
        ? label('countries', card.country_code)
        : null,
    work: card.profession_code
      ? label('profession_categories', card.profession_code)
      : label('employment_type', card.employment_type),
    maritalStatus:
      card.marital_status !== 'never_married' ? label('marital_status', card.marital_status) : null,
  }
}
