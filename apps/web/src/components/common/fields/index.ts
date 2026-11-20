/**
 * Shared form field components (17 section 8.2). Use them through `useAppForm` from
 * `~/lib/form`: `<form.AppField name="first_name">{(field) => <field.TextField ... />}</form.AppField>`.
 */

export {
  CheckboxField,
  ConsentCheckbox,
  type ConsentCheckboxProps,
  ConsentLink,
} from './checkbox-field'
export { type ChoiceOption, fitsSegmented } from './choice-controls'
export {
  CITY_SEARCH_DEBOUNCE_MS,
  CityPickerField,
  type CityPickerFieldProps,
  type CityValue,
  cityValueFromSection,
  cityValueToSection,
  EMPTY_CITY_VALUE,
} from './city-picker-field'
export {
  composeDate,
  DateOfBirthField,
  type DateOfBirthFieldProps,
} from './date-of-birth-field'
export type { BaseFieldProps } from './field-shell'
export {
  FormErrorSummary,
  type FormErrorSummaryProps,
  SubmitButton,
  type SubmitButtonProps,
  useOnlineStatus,
} from './form-components'
export { HEIGHT_FEET, HeightField, inchesFor } from './height-field'
export {
  formatIdentityNumber,
  type IdentityDocumentType,
  IdentityNumberField,
  type IdentityNumberFieldProps,
  normalizeIdentityNumber,
} from './identity-number-field'
export { IMPORTANCE_VALUES, ImportanceField, type ImportanceFieldProps } from './importance-field'
export { MultiSelectField, type MultiSelectFieldProps } from './multi-select-field'
export {
  filterOptions,
  normalizeSearch,
  type OtherOption,
  type SearchOption,
} from './option-search'
export {
  E164_PATTERN,
  formatNational,
  PhoneField,
  type PhoneFieldProps,
  splitE164,
  toE164,
} from './phone-field'
export { RadioCardsField, type RadioCardsFieldProps } from './radio-cards-field'
export {
  AgeRangeField,
  HEIGHT_RANGE_OPTIONS,
  HeightRangeField,
  RangeField,
  type RangeFieldProps,
  type RangeValue,
} from './range-field'
export { SearchSelectField, type SearchSelectFieldProps } from './search-select-field'
export {
  resolveSelectVariant,
  SelectField,
  type SelectFieldProps,
  type SelectVariant,
} from './select-field'
export { SwitchField, type SwitchFieldProps } from './switch-field'
export {
  NumberField,
  type NumberFieldProps,
  TextAreaField,
  type TextAreaFieldProps,
  TextField,
  type TextFieldProps,
} from './text-field'
