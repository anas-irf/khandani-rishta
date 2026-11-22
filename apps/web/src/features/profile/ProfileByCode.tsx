// APP-PROFILE by code (16 section 4.1, 17 section 3.4): `/p/$publicCode`
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { NoLongerAvailable } from '~/components/common/NoLongerAvailable'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { isApiError } from '~/lib/api'
import { normalizeProfileCode } from '../discovery/search-params'
import { ProfileTopBar } from './components/ProfileTopBar'
import { ProfileSkeleton, ProfileStateLayout } from './ProfileScreen'
import { useProfileByCode } from './queries'

/**
 * A shared profile code link: `GET /v1/profiles/by-code/{public_code}`, then the URL is
 * replaced with `/profiles/$profileId`. On `404`: "No profile with this code is available to
 * you."
 */
export function ProfileByCode({ publicCode }: { publicCode: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ScreenAccess screen="APP-PROFILE" header={<ProfileTopBar />}>
        <ProfileStateLayout>
          <Resolve publicCode={normalizeProfileCode(publicCode)} />
        </ProfileStateLayout>
      </ScreenAccess>
    </div>
  )
}

function Resolve({ publicCode }: { publicCode: string }) {
  const { t } = useTranslation('profile')
  const navigate = useNavigate()
  const lookup = useProfileByCode(publicCode)
  const profileId = lookup.data?.profile_id

  useEffect(() => {
    if (!profileId) return
    void navigate({ to: '/profiles/$profileId', params: { profileId }, replace: true })
  }, [profileId, navigate])

  if (isApiError(lookup.error) && lookup.error.code === 'not_found') {
    return <NoLongerAvailable message={t('by_code.not_found')} />
  }
  if (lookup.isError) {
    return (
      <ErrorState
        error={lookup.error}
        onRetry={() => void lookup.refetch()}
        retrying={lookup.isFetching}
      />
    )
  }
  return <ProfileSkeleton />
}
