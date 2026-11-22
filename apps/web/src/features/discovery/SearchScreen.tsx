// APP-SEARCH (16 section 6.6)
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { RotateCcw, Search as SearchIcon, SlidersHorizontal, UserRoundSearch } from 'lucide-react'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EmptyState } from '~/components/common/EmptyState'
import { FieldError } from '~/components/common/fields/field-shell'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Page } from '~/components/common/Page'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { StickyActionBar } from '~/components/common/StickyActionBar'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { usePreferences } from '~/features/preferences/queries'
import { isApiError } from '~/lib/api'
import type { OwnProfile, SearchFilters, SearchSort } from '~/lib/api-types'
import { serverFieldMessage } from '~/lib/form-context'
import { useCurrentMe } from '~/lib/me'
import { useIsWide } from '~/lib/media'
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
    <ScreenAccess screen="APP-SEARCH">
      <SearchContent {...props} />
    </ScreenAccess>
  )
}

function SearchContent({ q, savedSearchId }: SearchScreenProps) {
  const { t } = useTranslation('discovery')
  const me = useCurrentMe()
  const profileId = me.profile.id
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const wide = useIsWide()
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
  const formId = useId()
  const fieldsRef = useRef<HTMLDivElement | null>(null)
  const filtersRef = useRef<HTMLButtonElement | null>(null)
  // Phones show one view at a time, so the control that switched it is gone: focus moves along.
  const focusView = useRef<'form' | 'results' | null>(null)
  useEffect(() => {
    if (focusView.current !== view) return
    focusView.current = null
    if (view === 'results') filtersRef.current?.focus()
    else focusFirstControl(fieldsRef.current)
  }, [view])

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
    focusView.current = 'results'
    run(cleanFilters(draft))
  }

  const applyPreferences = () => {
    if (preferences.data) setDraft(filtersFromPreferences(preferences.data, me.profile.gender))
  }

  const editFilters = () => {
    focusView.current = 'form'
    setView('form')
    focusFirstControl(fieldsRef.current)
  }

  const activeCount = countActiveFilters(active?.filters ?? {})

  // At the bottom of a phone, after the form and tied to it by `form`: a sticky bar cannot rise
  // above the box it is in, and at large text the form starts too low to hold it above the
  // navigation. On wide screens at the head of the filters, so it covers none of them when the
  // screen opens. It is placed in the document where it is seen.
  const actions = (
    <StickyActionBar
      placement={wide ? 'top' : 'bottom'}
      className="w-auto flex-row flex-wrap max-wide:-mx-gutter wide:-mx-[20px]"
    >
      {/* 22 at the sides, so both share the 280 column at 768. */}
      <Button
        type="submit"
        form={formId}
        size="lg"
        fill="main"
        className="px-[22px]"
        disabled={!online}
      >
        <SearchIcon aria-hidden="true" />
        {t('search.actions.search')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        className="min-h-touch-lg flex-auto"
        onClick={() => setDraft({})}
      >
        <RotateCcw aria-hidden="true" />
        {t('search.actions.reset')}
      </Button>
    </StickyActionBar>
  )

  return (
    <Page title={t('search.title')}>
      <div className="wide:grid wide:grid-cols-[clamp(280px,30vw,352px)_minmax(0,1fr)] wide:items-start wide:gap-x-[clamp(24px,3vw,40px)]">
        <div
          className={cn('flex min-w-0 flex-col gap-6', view === 'results' && 'hidden', 'wide:flex')}
        >
          <SavedSearches
            onRun={(saved) => {
              focusView.current = 'results'
              setDraft(saved.filters)
              run(saved.filters)
            }}
          />
          <CodeFinder />
          <form
            id={formId}
            ref={formRef}
            onSubmit={submit}
            noValidate
            aria-label={t('search.form_label')}
            className="flex min-w-0 flex-col wide:tonal wide:rounded-xl wide:px-[20px] wide:pb-2"
          >
            {wide ? actions : null}
            <div ref={fieldsRef} className="flex min-w-0 flex-col wide:pt-2">
              <Button
                type="button"
                variant="link"
                className="mb-[8px] self-start"
                disabled={!preferences.data}
                onClick={applyPreferences}
              >
                {t('search.actions.use_preferences')}
              </Button>
              <SearchFilterForm
                filters={draft}
                onChange={setDraft}
                errors={fieldErrors}
                viewerGender={me.profile.gender}
                viewerCountry={viewerCountry}
              />
            </div>
          </form>
          {wide ? null : actions}
        </div>
        <div
          className={cn('flex min-w-0 flex-col gap-5', view === 'form' && 'hidden', 'wide:flex')}
        >
          <div className="wide:hidden">
            <Button ref={filtersRef} variant="secondary" onClick={editFilters}>
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
            <EmptyState
              icon={SearchIcon}
              title={t('search.results.start')}
              className="hidden wide:flex"
            />
          )}
        </div>
      </div>
      <SaveSearchDialog open={saving} onOpenChange={setSaving} filters={active?.filters ?? {}} />
    </Page>
  )
}

function focusFirstControl(fields: HTMLElement | null) {
  fields?.querySelector<HTMLElement>('select, input, button:not(:disabled)')?.focus()
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
      className="flex min-w-0 flex-col gap-2"
    >
      <Label htmlFor={inputId}>
        <UserRoundSearch aria-hidden="true" className="size-5 text-primary" />
        {t('search.code_label')}
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          value={code}
          placeholder={t('search.code_placeholder')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="w-auto flex-[1_1_9rem]"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" variant="secondary" loading={find.isPending} disabled={!online}>
          {t('search.find')}
        </Button>
      </div>
      <div role="alert">
        <FieldError id={errorId} message={error ?? undefined} />
      </div>
    </form>
  )
}
