import type { ReactNode } from 'react'
import type { ApiFieldError, OwnProfile } from '~/lib/api-types'
import type { FormMode } from '../schemas'

/** Props every section form receives from `SectionForm`. */
export type SectionFormInnerProps = {
  profile: OwnProfile
  mode: FormMode
  submitLabel: string
  /** Called after a successful save; a returned promise keeps the form submitting. */
  onSaved?: (profile: OwnProfile) => unknown
  footer?: ReactNode
  initialErrors?: ApiFieldError[]
  onDirtyChange?: (dirty: boolean) => void
}
