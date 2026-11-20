import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Joins class names and resolves conflicting Tailwind classes (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Converts an API key with underscores to its URL slug (`education_career` to `education-career`). */
export function toSlug(key: string): string {
  return key.replaceAll('_', '-')
}

/** Converts a URL slug back to the API key (`education-career` to `education_career`). */
export function fromSlug(slug: string): string {
  return slug.replaceAll('-', '_')
}

/** Shows counts above 99 as "99+" (16 section 2.4). Zero gives an empty string. */
export function badgeCount(count: number): string {
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}

/** Accepts a redirect target only when it is a same-origin path (17 section 14). */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined
  return value
}
