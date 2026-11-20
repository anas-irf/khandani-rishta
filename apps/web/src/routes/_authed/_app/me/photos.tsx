import { createFileRoute } from '@tanstack/react-router'
import { MePhotosScreen } from '~/features/photos/MePhotosScreen'

export const Route = createFileRoute('/_authed/_app/me/photos')({
  component: MePhotosScreen,
})
