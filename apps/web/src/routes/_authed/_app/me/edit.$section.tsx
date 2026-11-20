import { createFileRoute } from '@tanstack/react-router'
import { MeEditScreen } from '~/features/me/MeEditScreen'

export const Route = createFileRoute('/_authed/_app/me/edit/$section')({
  component: MeEditRoute,
})

function MeEditRoute() {
  const { section } = Route.useParams()
  return <MeEditScreen section={section} />
}
