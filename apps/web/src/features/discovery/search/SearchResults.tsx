import { BookmarkPlus, SearchX, X } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList, type InfiniteListQuery } from '~/components/common/InfiniteList'
import { ListSkeleton } from '~/components/common/ListSkeleton'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import type { ProfileCard, SearchFilters, SearchPage, SearchSort } from '~/lib/api-types'
import { DiscoveryCard } from '../components/DiscoveryCard'
import { SEARCH_SORTS, type SearchState } from '../search-params'
import { useFilterChips } from './useFilterChips'

/**
 * The results view of 16 section 6.6: the count ("{n} profiles", or "More than 500 profiles"
 * when `total_estimate` is null), a chip per active filter whose close control removes it and
 * searches again, the sort select, and the cards with the card actions of `APP-HOME`.
 */
export function SearchResults({
  state,
  query,
  onRemoveFilter,
  onSortChange,
  onEditFilters,
  onSave,
}: {
  state: SearchState
  query: InfiniteListQuery<ProfileCard> & { data: { pages: readonly SearchPage[] } | undefined }
  onRemoveFilter: (keys: (keyof SearchFilters)[]) => void
  onSortChange: (sort: SearchSort) => void
  onEditFilters: () => void
  onSave: () => void
}) {
  const { t } = useTranslation('discovery')
  const online = useOnlineStatus()
  const chips = useFilterChips(state.filters)
  const sortId = useId()
  const first = query.data?.pages[0]

  return (
    <section aria-label={t('search.results.label')} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          {first ? (
            <p className="text-lg font-semibold" role="status" data-total="">
              {first.total_estimate === null
                ? t('search.results.many')
                : t('search.results.count', { count: first.total_estimate })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={sortId} className="text-sm text-muted-foreground">
              {t('search.sort.label')}
            </Label>
            <NativeSelect
              id={sortId}
              value={state.sort}
              onChange={(event) => onSortChange(event.target.value as SearchSort)}
              wrapperClassName="w-auto"
            >
              {SEARCH_SORTS.map((sort) => (
                <NativeSelectOption key={sort} value={sort}>
                  {t(`search.sort.${sort}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button variant="secondary" onClick={onSave} disabled={!online}>
            <BookmarkPlus aria-hidden="true" />
            {t('search.actions.save')}
          </Button>
        </div>
      </div>
      {chips.length > 0 ? (
        <ul aria-label={t('search.results.active_filters')} className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li
              key={chip.keys.join('-')}
              className="inline-flex min-h-11 max-w-full items-center rounded-full border border-border bg-surface ps-3 text-sm"
            >
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                aria-label={t('search.results.remove_filter', { label: chip.label })}
                onClick={() => onRemoveFilter(chip.keys)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <InfiniteList
        query={query}
        getKey={(card) => card.id}
        label={t('search.results.label')}
        refreshable={false}
        listClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        skeleton={<ListSkeleton size="full" count={6} />}
        renderItem={(card) => <DiscoveryCard card={card} headingLevel="h2" className="h-full" />}
        empty={
          <EmptyState
            icon={SearchX}
            title={t('search.results.empty_title')}
            text={t('search.results.empty_text')}
            action={<Button onClick={onEditFilters}>{t('search.actions.edit_filters')}</Button>}
          />
        }
      />
    </section>
  )
}
