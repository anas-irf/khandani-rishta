import { type InfiniteData, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useShortcuts } from './shortcuts'

/**
 * Which item of a review queue is open (photos and texts, 18 sections 4.2 and 4.3). When the
 * open item leaves the list after a decision, the item that takes its place (the same position,
 * or the last one) opens. `next` and `previous` serve the `J` and `K` shortcuts.
 */
export function useQueueSelection<T>(items: readonly T[], getId: (item: T) => string) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lastIndex = useRef(0)

  const found = selectedId === null ? -1 : items.findIndex((item) => getId(item) === selectedId)
  const index = found !== -1 ? found : Math.min(lastIndex.current, items.length - 1)
  const selected = index >= 0 ? (items[index] ?? null) : null

  useEffect(() => {
    if (index >= 0) lastIndex.current = index
  }, [index])

  const move = useCallback(
    (delta: number) => {
      const target = items[Math.min(Math.max(index + delta, 0), items.length - 1)]
      if (target) setSelectedId(getId(target))
    },
    [items, index, getId],
  )

  return {
    selected,
    index,
    select: (item: T) => setSelectedId(getId(item)),
    next: () => move(1),
    previous: () => move(-1),
    isSelected: (item: T) => selected !== null && getId(item) === getId(selected),
  }
}

/**
 * `J` and `K` on a detail screen open the next and previous item of the queue the member came
 * from (18 section 3). The queue is read from the cache of the list screen, so nothing is
 * requested; with no cached list the keys do nothing. `neighbours()` reads at call time, so a
 * decision can note where to go next before the item leaves the cache.
 */
export function useQueueNeighbours<T>(options: {
  /** Prefix of the list's query key. */
  listKey: readonly unknown[]
  getId: (item: T) => string
  currentId: string
  open: (id: string) => void
}) {
  const queryClient = useQueryClient()

  const neighbours = useCallback((): { next: string | null; previous: string | null } => {
    const lists = queryClient.getQueriesData<InfiniteData<{ items: T[] }>>({
      queryKey: options.listKey,
    })
    const pages = lists.find(([, data]) => data?.pages?.length)?.[1]?.pages ?? []
    const ids = pages.flatMap((page) => page.items.map(options.getId))
    const index = ids.indexOf(options.currentId)
    if (index === -1) return { next: null, previous: null }
    return { next: ids[index + 1] ?? null, previous: ids[index - 1] ?? null }
  }, [queryClient, options.listKey, options.getId, options.currentId])

  useShortcuts({
    j: () => {
      const { next } = neighbours()
      if (next) options.open(next)
    },
    k: () => {
      const { previous } = neighbours()
      if (previous) options.open(previous)
    },
  })

  return neighbours
}
