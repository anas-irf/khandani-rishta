import { type ComponentType, type ReactNode, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { FormSkeleton } from '~/components/common/FormSkeleton'
import type { ApiFieldError, OwnProfile } from '~/lib/api-types'
import { useOwnProfile } from './queries'
import type { FormMode } from './schemas'
import { AccountForForm } from './sections/AccountForForm'
import { BasicsForm } from './sections/BasicsForm'
import { CommunityForm } from './sections/CommunityForm'
import { EducationCareerForm } from './sections/EducationCareerForm'
import { FamilyForm } from './sections/FamilyForm'
import { LifestyleForm } from './sections/LifestyleForm'
import { LocationForm } from './sections/LocationForm'
import type { SectionFormInnerProps } from './sections/types'

/**
 * The form of one profile section, shared by onboarding (ONB-01 to ONB-07, 07 sections 3 to 9)
 * and ME-EDIT (08 section 2): same fields, labels, conditional logic and messages.
 *
 * It loads `GET /v1/me/profile` fresh every time it opens (a skeleton until then), fills the
 * form, validates on the device, saves with `PUT /v1/me/profile/sections/{section}` and then
 * awaits `onSaved` (onboarding continues and navigates there; the button keeps its spinner and
 * every input stays disabled until it settles). `validation_failed` from the save, or thrown by
 * `onSaved` (a failed `continue`), is shown under the fields with a summary at the top.
 * Fields in `locked_fields` are read-only with the correction note of 08 section 2.2.
 *
 * Components passed as `footer` can read the dirty state and submit through
 * `useFormControls()`.
 */
export type SectionKey =
  | 'account_for'
  | 'basics'
  | 'community'
  | 'location'
  | 'education_career'
  | 'family'
  | 'lifestyle'

export type SectionFormProps = {
  section: SectionKey
  mode: FormMode
  /** Default: "Continue" in onboarding, "Save" when editing. */
  submitLabel?: string
  onSaved?: (profile: OwnProfile) => void | Promise<void>
  /** Rendered under the submit button, inside the form. */
  footer?: ReactNode
  /** API field errors to show when the form opens (a failed completion, 07 section 14.2). */
  initialErrors?: ApiFieldError[]
  /** Told whenever the form gains or loses unsaved input ("Discard changes?", 07 2.5). */
  onDirtyChange?: (dirty: boolean) => void
}

const FORMS: Record<SectionKey, ComponentType<SectionFormInnerProps>> = {
  account_for: AccountForForm,
  basics: BasicsForm,
  community: CommunityForm,
  location: LocationForm,
  education_career: EducationCareerForm,
  family: FamilyForm,
  lifestyle: LifestyleForm,
}

export function SectionForm({ section, mode, submitLabel, ...rest }: SectionFormProps) {
  const { t } = useTranslation('common')
  const profile = useOwnProfile()
  // Once filled, a failed background refetch never replaces the form and its input.
  const filled = useRef(false)
  if (profile.isFetchedAfterMount && profile.isSuccess) filled.current = true

  if (!filled.current && profile.isError) {
    return (
      <ErrorState
        error={profile.error}
        onRetry={() => void profile.refetch()}
        retrying={profile.isFetching}
      />
    )
  }
  // Never fill the form from a cached copy (08 section 2).
  if (!filled.current || !profile.data) return <FormSkeleton fields={5} />

  const Form = FORMS[section]
  return (
    <Form
      key={section}
      profile={profile.data}
      mode={mode}
      submitLabel={
        submitLabel ?? (mode === 'onboarding' ? t('actions.continue') : t('actions.save'))
      }
      {...rest}
    />
  )
}
