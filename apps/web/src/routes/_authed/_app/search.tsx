import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SearchScreen } from '~/features/discovery/SearchScreen'

export const Route = createFileRoute('/_authed/_app/search')({
  validateSearch: z.object({
    q: z.string().optional().catch(undefined),
    saved_search_id: z.string().optional().catch(undefined),
  }),
  component: SearchRoute,
})

function SearchRoute() {
  const { q, saved_search_id } = Route.useSearch()
  return <SearchScreen q={q} savedSearchId={saved_search_id} />
}
