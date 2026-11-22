import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge knows Tailwind's own scales. The tokens of `src/styles/app.css` are registered
 * here, otherwise `text-body-md` reads as a text colour and is dropped next to `text-foreground`.
 */
const twMerge = extendTailwindMerge<'band'>({
  extend: {
    theme: {
      text: [
        'display-lg',
        'display-md',
        'display-sm',
        'headline-lg-wide',
        'headline-lg',
        'headline-md',
        'headline-sm',
        'title-lg',
        'title-md',
        'title-sm',
        'body-lg',
        'body-md',
        'body-sm',
        'label-lg',
        'label-md',
        'label-sm',
        'emphasis',
        'figure',
        'figure-lg',
        'caption',
        'legal',
        'wordmark',
        'wordmark-lg',
      ],
      radius: [
        'check',
        'item',
        'row',
        'pill',
        'sheet',
        'card',
        'input',
        'arch',
        'arch-inner',
        'arch-sm',
        'arch-lg',
        'arch-step',
      ],
      shadow: ['menu', 'panel', 'bar'],
      spacing: ['touch', 'touch-lg', 'gutter'],
      container: ['content', 'column', 'form', 'measure'],
      font: ['sans', 'display', 'urdu'],
    },
    classGroups: {
      band: ['band-page', 'band-sand', 'band-success', 'band-primary', 'band-inverse'],
    },
  },
})

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

/**
 * The monogram of a name: the first letters of its first and last words (DESIGN.md 6.8), so
 * "Muhammad Abdul Rehman S." gives "MS" and a single word gives one letter.
 */
export function initialsOf(name: string | null | undefined): string {
  const letters = (name ?? '')
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter(Boolean)
  const first = letters[0] ?? ''
  const last = letters.length > 1 ? (letters[letters.length - 1] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** Accepts a redirect target only when it is a same-origin path (17 section 14). */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined
  return value
}
