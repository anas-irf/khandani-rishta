import type { ErrorComponentProps } from '@tanstack/react-router'
import { ErrorComponent, Link, useLocation, useRouter } from '@tanstack/react-router'

const buttonClass = 'rounded-sm bg-gray-700 px-3 py-1 font-semibold text-white'

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const isRoot = useLocation({ select: (location) => location.pathname === '/' })

  console.error('Unhandled route error:', error)

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-4">
      <ErrorComponent error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => router.invalidate()}>
          Try again
        </button>
        {isRoot ? (
          <Link to="/" className={buttonClass}>
            Home
          </Link>
        ) : (
          <Link
            to="/"
            className={buttonClass}
            onClick={(event) => {
              event.preventDefault()
              window.history.back()
            }}
          >
            Go back
          </Link>
        )}
      </div>
    </div>
  )
}
