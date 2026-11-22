import type { ReactNode } from 'react'

/** When it happened and where it stands, on one wrapping line under a compact card. */
export function RowMeta({ children }: { children: ReactNode }) {
  return <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
}

/**
 * The two answers of a row (DESIGN.md 6.12): `fill="side"`, then `fill="main"`. At large text
 * each takes a line of its own. On phones both are 56 tall, with the large label.
 */
export function RowAnswers({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-wrap gap-3 max-wide:*:min-h-touch-lg max-wide:*:text-emphasis wide:max-w-[420px]">
      {children}
    </div>
  )
}
