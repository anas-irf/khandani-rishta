import { useSyncExternalStore } from 'react'

/**
 * A tiny external store for UI-only state that is not server data: typing indicators,
 * presence, the global limit dialog, connectivity (17 section 1 principle 4).
 */
export type Store<T> = {
  get: () => T
  set: (next: T | ((previous: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Reads a slice of a store and re-renders when that slice changes. */
export function useStore<T, S = T>(
  store: Store<T>,
  selector: (state: T) => S = (s) => s as unknown as S,
): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  )
}
