import { createFileRoute } from '@tanstack/react-router'
import { ProfileByCode } from '~/features/profile/ProfileByCode'

export const Route = createFileRoute('/_authed/_app/p/$publicCode')({
  component: ProfileByCodeRoute,
})

function ProfileByCodeRoute() {
  const { publicCode } = Route.useParams()
  return <ProfileByCode publicCode={publicCode} />
}
