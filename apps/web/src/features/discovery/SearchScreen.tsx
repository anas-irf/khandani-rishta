// APP-SEARCH (16 section 6.6)
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { RotateCcw, Search as SearchIcon, SlidersHorizontal, UserRoundSearch } from 'lucide-react'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PageHeader } from '~/components/common/PageHeader'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { usePreferences } from '~/features/preferences/queries'
import { isApiError } from '~/lib/api'
import type { OwnProfile, SearchFilters, SearchSort } from '~/lib/api-types'
import { serverFieldMessage } from '~/lib/form-context'
import { useCurrentMe } from '~/lib/me'
import { errorMessage, qk } from '~/lib/query'
import { cn } from '~/lib/utils'
import { useFindProfileCode, useSavedSearches, useSearch } from './queries'
import { SavedSearches, SaveSearchDialog } from './search/SavedSearches'
import { type FilterErrors, SearchFilterForm } from './search/SearchFilterForm'
import { SearchResults } from './search/SearchResults'
import { saveSession, sessionFor } from './search/search-session'
import {
  cleanFilters,
  countActiveFilters,
  decodeSearchQuery,
  encodeSearchQuery,
  filtersFromPreferences,
  isProfileCode,
  normalizeProfileCode,
  withoutFilter,
} from './search-params'

export type SearchScreenProps = {
  /** URL-safe base64 JSON of `{ filters, sort }` (17 section 3.3). */
  q?: string
  /** Load and run this saved search (16 section 4.1). */
  savedSearchId?: string
}

export function SearchScreen(props: SearchScreenProps) {
  return (
    <div className="container-app">
      <ScreenAccess screen="APP-SEARCH">
        <SearchContent {...props} />
      </ScreenAccess>
    </div>
  )
}

function SearchContent({ q, savedSearchId }: SearchScreenProps) {
  const { t } = useTranslation('discovery')
  const me = useCurrentMe()
  const profileId = me.profile.id
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const viewerCountry =
    queryClient.getQueryData<OwnProfile>(qk.ownProfile())?.location.country_code ?? 'PK'

  /** The search shown in the results, from the URL. */
  const active = useMemo(() => decodeSearchQuery(q), [q])
  const initialSession = useMemo(() => sessionFor(profileId), [profileId])

  const [draft, setDraft] = useState<SearchFilters>(() => active?.filters ?? initialSession.filters)
  const [sort, setSort] = useState<SearchSort>(() => active?.sort ?? initialSession.sort)
  const [initialized, setInitialized] = useState(
    () => active !== null || (initialSession.initialized && !savedSearchId),
  )
  const [view, setView] = useState<'form' | 'results'>(active ? 'results' : 'form')
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  const preferences = usePreferences()
  const savedSearches = useSavedSearches()
  const results = useSearch(active)

  // The form is kept for the rest of the session, in memory only.
  useEffect(() => {
    if (initialized) saveSession(profileId, { initialized: true, filters: draft, sort })
  }, [profileId, initialized, draft, sort])

  // A search in the URL (a preset, a bookmark, a chip) replaces the form.
  useEffect(() => {
    if (!active) return
    setDraft(active.filters)
    setSort(active.sort)
    setInitialized(true)
    setView('results')
  }, [active])

  const run = (filters: SearchFilters, nextSort: SearchSort = sort) => {
    const encoded = encodeSearchQuery({ filters, sort: nextSort })
    setView('results')
    if (encoded === q) {
      void results.refetch()
      return
    }
    void navigate({ to: '/search', search: { q: encoded }, replace: true })
  }

  // `saved_search_id`: load and run it; when it no longer exists, the empty form (16 section 4.1).
  useEffect(() => {
    if (!savedSearchId || active) return
    if (savedSearches.isPending) return
    const saved = savedSearches.data?.find((item) => item.id === savedSearchId)
    if (saved) {
      setDraft(saved.filters)
      setInitialized(true)
      void navigate({
        to: '/search',
        search: { q: encodeSearchQuery({ filters: saved.filters, sort }) },
        replace: true,
      })
    } else {
      setDraft({})
      setInitialized(true)
      void navigate({ to: '/search', search: {}, replace: true })
    }
  }, [savedSearchId, active, savedSearches.isPending, savedSearches.data, navigate, sort])

  // First open in the session: fill the form from the partner preferences, without searching.
  useEffect(() => {
    if (initialized || savedSearchId || active) return
    if (preferences.data) {
      setDraft(filtersFromPreferences(preferences.data, me.profile.gender))
      setInitialized(true)
    } else if (preferences.isError) {
      setInitialized(true)
    }
  }, [initialized, savedSearchId, active, preferences.data, preferences.isError, me.profile.gender])

  // Errors of the search: `validation_failed` on the form, `rate_limited` as a toast.
  const fieldErrors = useMemo<FilterErrors>(() => {
    const error = results.error
    if (!isApiError(error) || error.code !== 'validation_failed') return {}
    const out: FilterErrors = {}
    for (const field of error.fields) {
      const key = field.field.replace(/^filters\./, '') as keyof SearchFilters
      out[key] = serverFieldMessage('discovery', { ...field, field: key })
    }
    return out
  }, [results.error])
  const hasFieldErrors = Object.keys(fieldErrors).length > 0
  useEffect(() => {
    if (hasFieldErrors) setView('form')
  }, [hasFieldErrors])
  useEffect(() => {
    const error = results.error
    if (isApiError(error) && error.code === 'rate_limited') toast.error(errorMessage(error))
  }, [results.error])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    run(cleanFilters(draft))
  }

  const applyPreferences = () => {
    if (preferences.data) setDraft(filtersFromPreferences(preferences.data, me.profile.gender))
  }

  const editFilters = () => {
    setView('form')
    formRef.current?.querySelector<HTMLElement>('select, input, button')?.focus()
  }

  const activeCount = countActiveFilters(active?.filters ?? {})

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('search.title')} />
      <div className="md:grid md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start md:gap-6">
        <div className={cn('flex flex-col gap-4', view === 'results' && 'hidden', 'md:flex')}>
          <SavedSearches
            onRun={(saved) => {
              setDraft(saved.filters)
              run(saved.filters)
            }}
          />
          <CodeFinder />
          <form
            ref={formRef}
            onSubmit={submit}
            noValidate
            aria-label={t('search.form_label')}
            className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-2 shadow-sm"
          >
            <SearchFilterForm
              filters={draft}
              onChange={setDraft}
              errors={fieldErrors}
              viewerGender={me.profile.gender}
              viewerCountry={viewerCountry}
            />
            <div className="sticky bottom-20 z-10 -mx-4 flex flex-wrap gap-2 border-t border-border bg-surface px-4 py-3 md:bottom-0">
              <Button type="submit" className="flex-1" disabled={!online}>
                <SearchIcon aria-hidden="true" />
                {t('search.actions.search')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDraft({})}>
                <RotateCcw aria-hidden="true" />
                {t('search.actions.reset')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="text-primary"
                disabled={!preferences.data}
                onClick={applyPreferences}
              >
                {t('search.actions.use_preferences')}
              </Button>
            </div>
          </form>
        </div>
        <div className={cn('flex flex-col gap-4', view === 'form' && 'hidden', 'md:flex')}>
          <div className="md:hidden">
            <Button variant="secondary" onClick={() => setView('form')}>
              <SlidersHorizontal aria-hidden="true" />
              {activeCount > 0
                ? t('search.actions.filters_count', { count: activeCount })
                : t('search.actions.filters')}
            </Button>
          </div>
          {active ? (
            <SearchResults
              state={active}
              query={results}
              onRemoveFilter={(keys) => run(withoutFilter(active.filters, keys), active.sort)}
              onSortChange={(next) => {
                setSort(next)
                run(active.filters, next)
              }}
              onEditFilters={editFilters}
              onSave={() => setSaving(true)}
            />
          ) : (
            <p className="hidden py-10 text-center text-muted-foreground md:block">
              {t('search.results.start')}
            </p>
          )}
        </div>
      </div>
      <SaveSearchDialog open={saving} onOpenChange={setSaving} filters={active?.filters ?? {}} />
    </div>
  )
}

/**
 * "Profile code" quick find (16 section 6.6): trimmed and in capitals, `KR` and 8 characters,
 * then `GET /v1/profiles/by-code/{public_code}` and `APP-PROFILE`; `404` shows "No profile with
 * this code is available to you."
 */
function CodeFinder() {
  const { t } = useTranslation('discovery')
  const navigate = useNavigate()
  const find = useFindProfileCode()
  const online = useOnlineStatus()
  const inputId = useId()
  const errorId = useId()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = normalizeProfileCode(code)
    if (!isProfileCode(normalized)) {
      setError(t('search.code_invalid'))
      return
    }
    setError(null)
    find.mutate(normalized, {
      onSuccess: ({ profile_id }) =>
        void navigate({ to: '/profiles/$profileId', params: { profileId: profile_id } }),
      onError: (failure) => {
        if (isApiError(failure) && failure.code === 'not_found') {
          setError(t('search.code_not_found'))
        }
      },
    })
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t('search.quick_find')}
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm"
    >
      <Label htmlFor={inputId} className="flex items-center gap-2">
        <UserRoundSearch aria-hidden="true" className="size-4 text-primary" />
        {t('search.code_label')}
      </Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={code}
          placeholder={t('search.code_placeholder')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" variant="secondary" loading={find.isPending} disabled={!online}>
          {t('search.find')}
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}
