import type { AnyHandler } from 'msw'

/**
 * Every mock API handler. Each file in this folder exports `handlers: AnyHandler[]` for one
 * product area (reference.ts, account.ts, discovery.ts, ...); this module collects them, so a
 * new area only adds a file.
 */
const modules = import.meta.glob<{ handlers?: AnyHandler[] }>(
  ['./*.ts', '!./index.ts', '!./*.test.ts'],
  { eager: true },
)

export const handlers: AnyHandler[] = Object.keys(modules)
  .sort()
  .flatMap((path) => modules[path]?.handlers ?? [])
