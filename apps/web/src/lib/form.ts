import { type AnyFormApi, createFormHook } from '@tanstack/react-form'
import {
  AgeRangeField,
  CheckboxField,
  CityPickerField,
  ConsentCheckbox,
  DateOfBirthField,
  FormErrorSummary,
  HeightField,
  HeightRangeField,
  IdentityNumberField,
  ImportanceField,
  MultiSelectField,
  NumberField,
  PhoneField,
  RadioCardsField,
  RangeField,
  SearchSelectField,
  SelectField,
  SubmitButton,
  SwitchField,
  TextAreaField,
  TextField,
} from '~/components/common/fields'
import { revealAndFocus } from './focus'
import { fieldContext, formContext } from './form-context'

/**
 * Forms (17 section 8): TanStack Form with Zod schemas and the shared field components.
 *
 * ```tsx
 * const form = useAppForm({
 *   defaultValues,
 *   validators: { onSubmit: basicsSchema },
 *   onSubmitInvalid: focusFirstInvalid,
 *   onSubmit: async ({ value }) => save.mutateAsync(value),
 * })
 * <form.AppField name="first_name">{(field) => <field.TextField label={t('...')} required />}</form.AppField>
 * <form.AppForm><form.SubmitButton label={t('common:actions.continue')} /></form.AppForm>
 * ```
 */
export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextAreaField,
    NumberField,
    SelectField,
    SearchSelectField,
    MultiSelectField,
    CityPickerField,
    DateOfBirthField,
    HeightField,
    PhoneField,
    IdentityNumberField,
    RangeField,
    AgeRangeField,
    HeightRangeField,
    ImportanceField,
    RadioCardsField,
    CheckboxField,
    ConsentCheckbox,
    SwitchField,
  },
  formComponents: {
    SubmitButton,
    FormErrorSummary,
  },
})

/**
 * Moves focus to the first invalid field in page order after a failed submit (07 section 2.4
 * step 3). Pass it as `onSubmitInvalid` to `useAppForm`.
 */
export function focusFirstInvalid({ formApi }: { formApi: AnyFormApi }) {
  if (typeof document === 'undefined') return
  const names = Object.entries(formApi.state.fieldMeta)
    .filter(([, meta]) => (meta?.errors?.length ?? 0) > 0)
    .map(([name]) => name)
  if (names.length === 0) return
  requestAnimationFrame(() => {
    const elements = names
      .map((name) => document.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`))
      .filter((element): element is HTMLElement => element != null)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    const first = elements[0]
    if (!first) return
    revealAndFocus(first)
  })
}
