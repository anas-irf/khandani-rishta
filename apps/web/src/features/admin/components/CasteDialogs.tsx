import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Textarea } from '~/components/ui/textarea'
import { isApiError } from '~/lib/api'
import { validate } from '../forms'
import { useCreateCaste, usePromoteSuggestion, useUpdateCaste } from '../queries'
import { createCasteSchema, editCasteSchema, promoteSuggestionSchema } from '../schemas'
import type { AdminCaste, CasteSuggestionItem } from '../types'
import { ActionDialog } from './ActionDialog'
import { FormField } from './FormField'
import { ErrorSummary, useDialogErrors } from './useDialogErrors'

/** Splits aliases typed one per line or separated by commas. */
export function parseAliases(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,]/)
        .map((alias) => alias.trim())
        .filter(Boolean),
    ),
  )
}

/** A suggestion's normalised name as a code: lowercase letters, digits and underscores. */
export function suggestCode(normalizedName: string, parentCode: string): string {
  const base = normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const code = parentCode && !base.startsWith(`${parentCode}_`) ? `${parentCode}_${base}` : base
  return /^[a-z]/.test(code) ? code : `c_${code}`
}

function ParentSelect({
  value,
  onChange,
  parents,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  parents: { code: string; name: string }[]
  disabled?: boolean
}) {
  const { t } = useTranslation('admin')
  return (
    <FormField label={t('castes.parent')}>
      {(props) => (
        <NativeSelect
          {...props}
          name="parent_code"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <NativeSelectOption value="">{t('castes.top_level')}</NativeSelectOption>
          {parents.map((parent) => (
            <NativeSelectOption key={parent.code} value={parent.code}>
              {parent.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}

/** Promotes a suggestion to a caste row (admin, 18 section 6.1). */
export function PromoteDialog({
  suggestion,
  parents,
  onClose,
}: {
  suggestion: CasteSuggestionItem
  parents: { code: string; name: string }[]
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const promote = usePromoteSuggestion()
  const initialParent = suggestion.parent_code ?? ''
  const [values, setValues] = useState({
    code: suggestCode(suggestion.normalized_name, initialParent),
    name: suggestion.name,
    name_ur: '',
    parent_code: initialParent,
  })
  const form = useDialogErrors(['code', 'name', 'name_ur', 'parent_code'])
  const set = (key: keyof typeof values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }))

  const submit = async () => {
    const result = validate(promoteSuggestionSchema, values, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    const data = result.data
    try {
      await promote.mutateAsync({
        id: suggestion.id,
        code: data.code,
        name: data.name,
        ...(data.name_ur ? { name_ur: data.name_ur } : {}),
        ...(data.parent_code ? { parent_code: data.parent_code } : {}),
      })
    } catch (error) {
      if (isApiError(error) && error.code === 'already_exists') {
        form.setErrors({ code: t('castes.code_taken') })
      } else {
        form.fail(error)
      }
      throw error
    }
  }

  return (
    <ActionDialog
      title={t('castes.promote_title', { name: suggestion.name })}
      description={t('castes.promote_description', { count: suggestion.usage_count })}
      submitLabel={t('castes.promote')}
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      {suggestion.similar.length > 0 ? (
        <p role="note" className="rounded-md bg-warning-soft p-2 text-sm">
          {t('castes.similar_warning', {
            names: suggestion.similar.map((item) => item.name).join(', '),
          })}
        </p>
      ) : null}
      <ParentSelect
        value={values.parent_code}
        onChange={(value) => set('parent_code', value)}
        parents={parents}
      />
      <FormField label={t('castes.code')} hint={t('castes.code_hint')} error={form.errors.code}>
        {(props) => (
          <Input
            {...props}
            name="code"
            autoComplete="off"
            value={values.code}
            onChange={(event) => set('code', event.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('castes.name')} error={form.errors.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('castes.name_ur')} error={form.errors.name_ur}>
        {(props) => (
          <Input
            {...props}
            name="name_ur"
            dir="rtl"
            value={values.name_ur}
            onChange={(event) => set('name_ur', event.target.value)}
          />
        )}
      </FormField>
    </ActionDialog>
  )
}

/** Adds a caste or sub-caste (admin, 18 section 6.2). */
export function CreateCasteDialog({
  parents,
  onClose,
}: {
  parents: { code: string; name: string }[]
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const create = useCreateCaste()
  const [values, setValues] = useState({
    code: '',
    name: '',
    name_ur: '',
    parent_code: '',
    aliases: '',
    sort_order: '',
  })
  const form = useDialogErrors(['code', 'name', 'name_ur', 'parent_code', 'aliases', 'sort_order'])
  const set = (key: keyof typeof values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }))

  const submit = async () => {
    const result = validate(
      createCasteSchema,
      {
        ...values,
        sort_order: values.sort_order === '' ? undefined : Number(values.sort_order),
      },
      t,
    )
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    const data = result.data
    const aliases = parseAliases(data.aliases)
    try {
      await create.mutateAsync({
        code: data.code,
        name: data.name,
        ...(data.name_ur ? { name_ur: data.name_ur } : {}),
        ...(data.parent_code ? { parent_code: data.parent_code } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(data.sort_order === undefined ? {} : { sort_order: data.sort_order }),
      })
    } catch (error) {
      if (isApiError(error) && error.code === 'already_exists') {
        form.setErrors({ code: t('castes.code_taken') })
      } else {
        form.fail(error)
      }
      throw error
    }
  }

  return (
    <ActionDialog
      title={t('castes.add_title')}
      description={t('castes.add_description')}
      submitLabel={t('castes.add')}
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      <ParentSelect
        value={values.parent_code}
        onChange={(value) => set('parent_code', value)}
        parents={parents}
      />
      <FormField label={t('castes.code')} hint={t('castes.code_hint')} error={form.errors.code}>
        {(props) => (
          <Input
            {...props}
            name="code"
            autoComplete="off"
            value={values.code}
            onChange={(event) => set('code', event.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('castes.name')} error={form.errors.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('castes.name_ur')} error={form.errors.name_ur}>
        {(props) => (
          <Input
            {...props}
            name="name_ur"
            dir="rtl"
            value={values.name_ur}
            onChange={(event) => set('name_ur', event.target.value)}
          />
        )}
      </FormField>
      <FormField
        label={t('castes.aliases')}
        hint={t('castes.aliases_hint')}
        error={form.errors.aliases}
      >
        {(props) => (
          <Textarea
            {...props}
            name="aliases"
            rows={3}
            value={values.aliases}
            onChange={(event) => set('aliases', event.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('castes.sort_order')} error={form.errors.sort_order} className="w-40">
        {(props) => (
          <Input
            {...props}
            name="sort_order"
            type="number"
            min={0}
            inputMode="numeric"
            value={values.sort_order}
            onChange={(event) => set('sort_order', event.target.value)}
          />
        )}
      </FormField>
    </ActionDialog>
  )
}

/** Renames a caste, edits aliases and order, or deactivates it. The code cannot change. */
export function EditCasteDialog({ caste, onClose }: { caste: AdminCaste; onClose: () => void }) {
  const { t } = useTranslation('admin')
  const update = useUpdateCaste()
  const [values, setValues] = useState({
    name: caste.name,
    name_ur: caste.name_ur ?? '',
    aliases: caste.aliases.join('\n'),
    sort_order: String(caste.sort_order),
    is_active: caste.is_active,
  })
  const form = useDialogErrors(['name', 'name_ur', 'aliases', 'sort_order', 'is_active'])

  const submit = async () => {
    const result = validate(
      editCasteSchema,
      { ...values, sort_order: Number(values.sort_order) },
      t,
    )
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    const data = result.data
    const aliases = parseAliases(data.aliases)
    const changes = {
      ...(data.name !== caste.name ? { name: data.name } : {}),
      ...(data.name_ur !== (caste.name_ur ?? '') ? { name_ur: data.name_ur || null } : {}),
      ...(aliases.join('\n') !== caste.aliases.join('\n') ? { aliases } : {}),
      ...(data.sort_order !== caste.sort_order ? { sort_order: data.sort_order } : {}),
      ...(data.is_active !== caste.is_active ? { is_active: data.is_active } : {}),
    }
    if (Object.keys(changes).length === 0) return
    try {
      await update.mutateAsync({ code: caste.code, ...changes })
    } catch (error) {
      if (isApiError(error) && error.code === 'invalid_state') {
        form.setErrors({ is_active: t('castes.deactivate_refused') })
      } else {
        form.fail(error)
      }
      throw error
    }
  }

  return (
    <ActionDialog
      title={t('castes.edit_title', { name: caste.name })}
      description={t('castes.edit_description', { code: caste.code })}
      submitLabel={t('actions.save')}
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      <FormField label={t('castes.name')} error={form.errors.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        )}
      </FormField>
      <FormField label={t('castes.name_ur')} error={form.errors.name_ur}>
        {(props) => (
          <Input
            {...props}
            name="name_ur"
            dir="rtl"
            value={values.name_ur}
            onChange={(event) => setValues({ ...values, name_ur: event.target.value })}
          />
        )}
      </FormField>
      <FormField
        label={t('castes.aliases')}
        hint={t('castes.aliases_hint')}
        error={form.errors.aliases}
      >
        {(props) => (
          <Textarea
            {...props}
            name="aliases"
            rows={3}
            value={values.aliases}
            onChange={(event) => setValues({ ...values, aliases: event.target.value })}
          />
        )}
      </FormField>
      <FormField label={t('castes.sort_order')} error={form.errors.sort_order} className="w-40">
        {(props) => (
          <Input
            {...props}
            name="sort_order"
            type="number"
            min={0}
            inputMode="numeric"
            value={values.sort_order}
            onChange={(event) => setValues({ ...values, sort_order: event.target.value })}
          />
        )}
      </FormField>
      <div className="grid gap-1.5">
        <label htmlFor="caste-active" className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox
            id="caste-active"
            checked={values.is_active}
            onCheckedChange={(checked) => setValues({ ...values, is_active: checked === true })}
          />
          {t('castes.active')}
        </label>
        {form.errors.is_active ? (
          <p role="alert" className="text-sm text-danger">
            {form.errors.is_active}
          </p>
        ) : null}
      </div>
    </ActionDialog>
  )
}
