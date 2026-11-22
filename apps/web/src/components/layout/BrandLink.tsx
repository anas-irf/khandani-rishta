import { Link } from '@tanstack/react-router'
import { cn } from '~/lib/utils'
import { logoLinkClass, Wordmark } from './Logo'

/** The logo in the app's top bar; opens APP-HOME (16 section 2.1). */
export function BrandLink({ className }: { className?: string }) {
  return (
    <Link to="/home" className={cn(logoLinkClass, className)}>
      <Wordmark />
    </Link>
  )
}
