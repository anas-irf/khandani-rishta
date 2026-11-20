import { createFileRoute } from '@tanstack/react-router'
import { PhotosScreen } from '~/features/admin/PhotosScreen'
import { photosSearch } from '~/features/admin/search-schemas'

export const Route = createFileRoute('/_authed/admin/photos')({
  validateSearch: photosSearch,
  component: PhotosScreen,
})
