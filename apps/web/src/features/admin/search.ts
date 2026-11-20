import { useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import type { z } from 'zod'

/**
 * List filters live in the URL as the route's `validateSearch` schema (17 section 3). A screen
 * parses the current search with the same schema, so it works for a typed route and for the
 * in-memory router of the tests alike. Empty values are dropped from the URL.
 */
export function useSearchFilters<TSchema extends z.ZodType<Record<string, unknown>>>(
  schema: TSchema,
) {
  const raw = useSearch({ strict: false }) as unknown
  const navigate = useNavigate()
  const filters = useMemo(() => schema.parse(raw ?? {}) as z.infer<TSchema>, [raw, schema])

  const setFilters = useCallback(
    (patch: Partial<z.infer<TSchema>>) => {
      void navigate({
        search: ((previous: Record<string, unknown>) => {
          const next: Record<string, unknown> = { ...previous, ...patch }
          for (const key of Object.keys(next)) {
            if (next[key] === undefined || next[key] === '' || next[key] === null) delete next[key]
          }
          return next
        }) as never,
        replace: true,
      })
    },
    [navigate],
  )

  return [filters, setFilters] as const
}

/**
 * A path parameter of the current admin route (`profileId`, `requestId`, ...). The last path
 * segment is the fallback, so a screen also works under the in-memory router of the tests.
 */
export function useRouteId(name: string): string {
  const params = useParams({ strict: false }) as Record<string, string | undefined>
  const { pathname } = useLocation()
  return params[name] ?? decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '')
}
