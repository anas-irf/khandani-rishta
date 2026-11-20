import type { Subject } from './wording'

/**
 * The "Help me write" starter of 07 section 9.3: a draft for `about_me` built on the device
 * from the answers already given, with fixed sentences. It never calls the API.
 */
export type DraftInput = {
  subject: Subject
  firstName: string | null
  age: number | null
  /** `job_title`, or the name of the profession category (lowercased here). */
  job: string | null
  /** The city name, or `city_other`. */
  city: string | null
  educationLevel: string | null
  educationField: string | null
  religiosity: string | null
  /** The saved `family_type`. */
  familyType: string | null
  /** Names of the selected hobbies, in order. */
  hobbies: string[]
}

/** A translate function (`t` from `useTranslation`, or `i18n.t`). */
export type Translate = (key: string, options?: Record<string, unknown>) => string

const RELIGIOSITY_SENTENCES: Record<string, string> = {
  very_practising: 'faith_very',
  practising: 'faith_practising',
  moderately_practising: 'faith_moderate',
}

const FAMILY_SENTENCES: Record<string, string> = {
  joint: 'family_joint',
  nuclear: 'family_nuclear',
}

/** "a", "a and b" or "a, b and c": the first three hobbies in lower case. */
export function hobbyList(names: string[], t: Translate): string | null {
  const [a, b, c] = names.slice(0, 3).map((name) => name.toLowerCase())
  if (!a) return null
  if (!b) return a
  if (!c) return t('profile_sections:help_me_write.list_two', { a, b })
  return t('profile_sections:help_me_write.list_three', { a, b, c })
}

export function buildAboutMeDraft(input: DraftInput, t: Translate): string {
  // Third-person sentences exist for a known gender; `self` and `unknown` use the base form.
  const context = input.subject === 'male' || input.subject === 'female' ? input.subject : undefined
  const say = (key: string, values: Record<string, unknown> = {}) =>
    t(`profile_sections:help_me_write.${key}`, { ...values, context })
  const sentences: string[] = []
  const name = input.firstName ?? ''

  if (input.age != null && input.city) {
    sentences.push(
      input.job
        ? say('intro_job', { age: input.age, job: input.job.toLowerCase(), city: input.city, name })
        : say('intro', { age: input.age, city: input.city, name }),
    )
  }
  if (input.educationLevel) {
    sentences.push(
      input.educationField
        ? say('education_field', { level: input.educationLevel, field: input.educationField })
        : say('education', { level: input.educationLevel }),
    )
  }
  const faith = input.religiosity ? RELIGIOSITY_SENTENCES[input.religiosity] : undefined
  if (faith) sentences.push(say(faith))
  const family = input.familyType ? FAMILY_SENTENCES[input.familyType] : undefined
  if (family) sentences.push(say(family))
  const hobbies = hobbyList(input.hobbies, t)
  if (hobbies) sentences.push(say('hobbies', { hobbies }))
  sentences.push(say('closing'))
  return sentences.join(' ')
}
