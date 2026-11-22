import { useState } from 'react'
import { usePass, useUndoPass } from '~/features/relations/queries'
import type { ProfileCard } from '~/lib/api-types'

type PassEntry = {
  /** The card as it was, because a pass takes it out of the cached lists (17 section 6.3). */
  card: ProfileCard
  /** Its place in the list. */
  index: number
  /** Its height, so the panel does not pull the list up under the reader. */
  height: number
  state: 'passed' | 'restored'
}

/**
 * "Not interested" on a list (16 section 6.4, 11 section 12): `PUT /v1/passes/{profile_id}`,
 * optimistic. The caches lose the card as before, and this screen keeps a panel with "Undo" in
 * its place until the member leaves, with no time limit. "Undo" shows the card again at once and
 * calls `DELETE`. A failure of either puts back what was there, and the global handler toasts.
 *
 * Give a `listKey` when the same screen can show another list (a new search): panels belong to
 * the list they were made in.
 */
export function usePassInPlace(listKey = '') {
  const [{ key, entries }, setPassed] = useState<{ key: string; entries: PassEntry[] }>({
    key: listKey,
    entries: [],
  })
  if (key !== listKey) setPassed({ key: listKey, entries: [] })

  const passMutation = usePass()
  const undoMutation = useUndoPass()

  const update = (change: (current: PassEntry[]) => PassEntry[]) =>
    setPassed((current) =>
      current.key === listKey ? { key: listKey, entries: change(current.entries) } : current,
    )
  const setState = (id: string, state: PassEntry['state']) =>
    update((current) =>
      current.map((entry) => (entry.card.id === id ? { ...entry, state } : entry)),
    )

  return {
    entryOf: (id: string) => entries.find((entry) => entry.card.id === id),

    /** The list with the passed cards where they were. */
    arrange(cards: ProfileCard[]): ProfileCard[] {
      if (entries.length === 0) return cards
      const shown = new Set(cards.map((card) => card.id))
      const result = [...cards]
      for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
        if (!shown.has(entry.card.id)) {
          result.splice(Math.min(entry.index, result.length), 0, entry.card)
        }
      }
      return result
    },

    pass(card: ProfileCard, index: number, height: number) {
      const others = (current: PassEntry[]) => current.filter((entry) => entry.card.id !== card.id)
      update((current) => [...others(current), { card, index, height, state: 'passed' }])
      // A promise per call: `mutate` only reports on the latest of two quick passes.
      passMutation.mutateAsync(card.id).catch(() => update(others))
    },

    undo(id: string) {
      setState(id, 'restored')
      undoMutation.mutateAsync(id).catch(() => setState(id, 'passed'))
    },
  }
}

export type PassInPlace = ReturnType<typeof usePassInPlace>
