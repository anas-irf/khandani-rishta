import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PhotoViewer } from '~/features/profile/PhotoViewer'

export const Route = createFileRoute('/_authed/_app/profiles/$profileId/photos')({
  validateSearch: z.object({ index: z.coerce.number().int().min(0).optional().catch(undefined) }),
  component: PhotosRoute,
})

function PhotosRoute() {
  const { profileId } = Route.useParams()
  const { index } = Route.useSearch()
  return <PhotoViewer profileId={profileId} index={index} />
}
