import type { Privacy } from '~/lib/api-types'

/**
 * The examples under "Name shown to members" (16 section 6.25, 09 section 4.1): each option
 * rendered with the member's own name and profile code, as a member who is not a connection
 * would see it.
 */

type NameDisplay = Privacy['name_display']

/** The first extended grapheme cluster, upper-cased where the script has case (09 section 4.3). */
function firstLetter(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const firstWord = trimmed.split(/\s+/)[0] ?? ''
  let letter: string
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    letter = segmenter.segment(firstWord)[Symbol.iterator]().next().value?.segment ?? ''
  } else {
    letter = Array.from(firstWord)[0] ?? ''
  }
  return letter.toLocaleUpperCase()
}

export function nameExamples(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  publicCode: string,
): Record<NameDisplay, string> {
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  const f = firstLetter(first)
  const l = firstLetter(last)
  return {
    full_name: [first, last].filter(Boolean).join(' '),
    first_name_last_initial: l ? `${first} ${l}.` : first,
    first_name_only: first,
    initials: l ? `${f}. ${l}.` : f ? `${f}.` : '',
    code_only: publicCode,
  }
}
