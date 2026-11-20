import { createFileRoute } from '@tanstack/react-router'
import { ProfileScreen } from '~/features/profile/ProfileScreen'

export const Route = createFileRoute('/_authed/_app/profiles/$profileId/')({
  component: ProfileRoute,
})

function ProfileRoute() {
  const { profileId } = Route.useParams()
  // A new profile id remounts the screen, so no state carries over between profiles.
  return <ProfileScreen key={profileId} profileId={profileId} />
}
