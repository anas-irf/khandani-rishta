import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function NotFound({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-3 p-4">
      <div className="text-gray-600 dark:text-gray-400">
        {children ?? <p>The page you are looking for does not exist.</p>}
      </div>
      <p className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-sm bg-gray-700 px-3 py-1 font-semibold text-white"
        >
          Go back
        </button>
        <Link to="/" className="rounded-sm bg-gray-700 px-3 py-1 font-semibold text-white">
          Home
        </Link>
      </p>
    </div>
  )
}
