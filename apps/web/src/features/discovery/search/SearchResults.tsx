import { BookmarkPlus, SearchX } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { RemovableChip } from '~/components/common/Chip'
import { EmptyState } from '~/components/common/EmptyState'
import { InfiniteList, type InfiniteListQuery } from '~/components/common/InfiniteList'
import { ListSkeleton } from '~/components/common/ListSkeleton'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { profileCardCellClass } from '~/components/common/ProfileCard'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import type { ProfileCard, SearchFilters, SearchPage, SearchSort } from '~/lib/api-types'
import { cn } from '~/lib/utils'
import { DiscoveryCard } from '../components/DiscoveryCard'
import { usePassInPlace } from '../components/usePassInPlace'
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
  const passing = usePassInPlace(JSON.stringify(state))
  const sortId = useId()
  const first = query.data?.pages[0]

  return (
    <section aria-label={t('search.results.label')} className="flex flex-col gap-4">
      {first ? (
        <p className="text-title-lg tabular-nums" role="status" data-total="">
          {first.total_estimate === null
            ? t('search.results.many')
            : t('search.results.count', { count: first.total_estimate })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 max-w-[20rem] flex-[1_1_12rem] flex-col gap-2">
          <Label htmlFor={sortId}>{t('search.sort.label')}</Label>
          <NativeSelect
            id={sortId}
            value={state.sort}
            onChange={(event) => onSortChange(event.target.value as SearchSort)}
          >
            {SEARCH_SORTS.map((sort) => (
              <NativeSelectOption key={sort} value={sort}>
                {t(`search.sort.${sort}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button variant="quiet" onClick={onSave} disabled={!online}>
          <BookmarkPlus aria-hidden="true" />
          {t('search.actions.save')}
        </Button>
      </div>
      {chips.length > 0 ? (
        <ul aria-label={t('search.results.active_filters')} className="flex flex-wrap gap-2 pb-2">
          {chips.map((chip) => (
            <li key={chip.keys.join('-')} className="max-w-full">
              <RemovableChip
                removeLabel={t('search.results.remove_filter', { label: chip.label })}
                onRemove={() => onRemoveFilter(chip.keys)}
              >
                {chip.label}
              </RemovableChip>
            </li>
          ))}
        </ul>
      ) : null}
      <InfiniteList
        query={query}
        getKey={(card) => card.id}
        label={t('search.results.label')}
        refreshable={false}
        arrange={passing.arrange}
        listClassName="card-grid"
        itemClassName={cn(profileCardCellClass, 'wide:mb-10')}
        skeleton={<ListSkeleton size="full" count={6} />}
        renderItem={(card, index) => (
          <DiscoveryCard card={card} index={index} passing={passing} headingLevel="h2" />
        )}
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
