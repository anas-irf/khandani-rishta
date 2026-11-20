import type { FaqEntry } from './seo'

/**
 * The questions of the FAQ page (16 section 7.10), in order. The texts are in
 * `locales/en/public.json` under `faq.items.<id>`, the group titles under `faq.groups.<id>`.
 */
export const FAQ_GROUPS = [
  {
    id: 'getting_started',
    items: ['free', 'who_can_create', 'for_family', 'why_cnic', 'who_sees_cnic'],
  },
  {
    id: 'privacy',
    items: ['photos', 'hide_name', 'phone', 'hide_profile', 'screenshots'],
  },
  {
    id: 'matches',
    items: ['how_matches', 'must_have', 'how_many_interests', 'decline_known', 'cannot_send'],
  },
  {
    id: 'safety',
    items: ['id_verified', 'how_verify', 'document_photos', 'report', 'bureaus'],
  },
  {
    id: 'account',
    items: ['pause_close', 'delete_account', 'data_copy', 'found_match'],
  },
] as const

/** The four questions on the landing page (16 section 7.1, section 9). */
export const HOME_FAQ_IDS = ['free', 'for_family', 'photos', 'how_matches'] as const

type Translate = (key: string) => string

/** One question with its answer. */
export function faqEntry(t: Translate, id: string): FaqEntry {
  return {
    question: t(`faq.items.${id}.question`),
    answer: t(`faq.items.${id}.answer`),
  }
}

/** Every question and answer in page order, for the page and for `FAQPage` structured data. */
export function allFaqEntries(t: Translate): FaqEntry[] {
  return FAQ_GROUPS.flatMap((group) => group.items.map((id) => faqEntry(t, id)))
}
