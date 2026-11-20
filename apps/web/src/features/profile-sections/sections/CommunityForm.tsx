// ONB-03 (07 section 5) and ME-EDIT `community` (08 section 2).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchOption } from '~/components/common/fields'
import { useCastes, useOptions, useReference } from '~/lib/reference'
import { FormShell, useLatest, useManagedForm } from '../form-shell'
import { useSaveSection } from '../queries'
import {
  type CommunityContext,
  communityFromProfile,
  communitySchema,
  communityToBody,
  NOT_SPECIFIED,
  SECTION_NS,
  subCasteControl,
} from '../schemas'
import type { SectionFormInnerProps } from './types'

export function CommunityForm({
  profile,
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
}: SectionFormInnerProps) {
  const { t, i18n } = useTranslation('profile_sections')
  const reference = useReference()
  const castes = useCastes()
  const languages = useOptions('languages')
  const save = useSaveSection('community')

  const context = useLatest<CommunityContext>({
    sectCount: (religion) =>
      reference.religions.find((entry) => entry.code === religion)?.sects.length ?? 0,
    hasSubCastes: (code) =>
      (castes.find((caste) => caste.code === code)?.sub_castes.length ?? 0) > 0,
  })
  const [schema] = useState(() => communitySchema(() => context.current))
  const [defaultValues] = useState(() => communityFromProfile(profile, context.current))

  const managed = useManagedForm({
    namespace: SECTION_NS,
    mode,
    step: 'community',
    defaultValues,
    schema,
    initialErrors,
    onDirtyChange,
    submit: async (values) => {
      const saved = await save.mutateAsync(communityToBody(values, context.current))
      await onSaved?.(saved)
    },
  })
  const { form } = managed

  const localName = (item: { name: string; name_ur: string | null }) =>
    i18n.language === 'ur' && item.name_ur ? item.name_ur : item.name

  // "Prefer not to say" first, then the castes in their sort order; aliases are searchable.
  const language = i18n.language
  const casteOptions = useMemo<SearchOption[]>(
    () => [
      { code: NOT_SPECIFIED, label: t('community.caste_none') },
      ...castes.map((caste) => ({
        code: caste.code,
        label: language === 'ur' && caste.name_ur ? caste.name_ur : caste.name,
        aliases: caste.aliases,
      })),
    ],
    [castes, t, language],
  )

  const clearSubCaste = () => {
    form.setFieldValue('sub_caste_code', null)
    form.setFieldValue('sub_caste_other', null)
    form.setFieldValue('sub_caste_mode', 'list')
  }

  return (
    <FormShell
      form={form}
      controls={managed.controls}
      unmatched={managed.unmatched}
      failure={managed.failure}
      submitLabel={submitLabel}
      footer={footer}
      failureText={t(mode === 'onboarding' ? 'form.failed_onboarding' : 'form.failed')}
    >
      <form.AppField
        name="religion_code"
        listeners={{
          // Changing the religion clears the sect (07 section 5.1).
          onChange: () => form.setFieldValue('sect_code', null),
        }}
      >
        {(field) => (
          <field.SelectField label={t('community.religion_label')} list="religions" required />
        )}
      </form.AppField>

      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const religion = reference.religions.find((entry) => entry.code === values.religion_code)
          const sects = (religion?.sects ?? []).map((sect) => ({
            code: sect.code,
            label: localName(sect),
          }))
          const caste = castes.find((entry) => entry.code === values.caste_code)
          const subControl = subCasteControl(values, context.current)
          const subOptions: SearchOption[] = [
            { code: NOT_SPECIFIED, label: t('community.sub_caste_none') },
            ...(caste?.sub_castes ?? []).map((sub) => ({ code: sub.code, label: localName(sub) })),
          ]
          return (
            <>
              {sects.length > 0 ? (
                <form.AppField name="sect_code">
                  {(field) => (
                    <field.SelectField label={t('community.sect_label')} options={sects} required />
                  )}
                </form.AppField>
              ) : null}

              <form.AppField
                name="caste_code"
                listeners={{
                  // Changing the caste clears both sub-caste fields (07 section 5.2).
                  onChange: ({ value }) => {
                    if (value != null) {
                      form.setFieldValue('caste_mode', 'list')
                      form.setFieldValue('caste_other', null)
                    }
                    clearSubCaste()
                  },
                }}
              >
                {(field) => (
                  <field.SearchSelectField
                    label={t('community.caste_label')}
                    helpText={t('community.caste_help')}
                    options={casteOptions}
                    otherOption={{
                      label: t('community.caste_other_option'),
                      onSelect: (typed) => {
                        form.setFieldValue('caste_code', null)
                        form.setFieldValue('caste_mode', 'other')
                        form.setFieldValue('caste_other', typed || null)
                        clearSubCaste()
                      },
                    }}
                    displayText={
                      values.caste_mode === 'other' ? t('community.caste_other_option') : undefined
                    }
                    onClear={() => {
                      form.setFieldValue('caste_code', null)
                      form.setFieldValue('caste_mode', 'list')
                      form.setFieldValue('caste_other', null)
                      clearSubCaste()
                    }}
                  />
                )}
              </form.AppField>

              {values.caste_mode === 'other' ? (
                <form.AppField name="caste_other">
                  {(field) => (
                    <field.TextField
                      label={t('community.caste_other_label')}
                      maxLength={60}
                      required
                    />
                  )}
                </form.AppField>
              ) : null}

              {subControl === 'select' ? (
                <form.AppField name="sub_caste_code">
                  {(field) => (
                    <field.SearchSelectField
                      label={t('community.sub_caste_label')}
                      options={subOptions}
                      otherOption={{
                        label: t('community.sub_caste_other_option'),
                        onSelect: (typed) => {
                          form.setFieldValue('sub_caste_code', null)
                          form.setFieldValue('sub_caste_mode', 'other')
                          form.setFieldValue('sub_caste_other', typed || null)
                        },
                      }}
                      displayText={
                        values.sub_caste_mode === 'other'
                          ? t('community.sub_caste_other_option')
                          : undefined
                      }
                      onClear={() => clearSubCaste()}
                    />
                  )}
                </form.AppField>
              ) : null}
              {subControl === 'text' ||
              (subControl === 'select' && values.sub_caste_mode === 'other') ? (
                <form.AppField name="sub_caste_other">
                  {(field) => (
                    <field.TextField
                      label={t('community.sub_caste_label')}
                      maxLength={60}
                      required={subControl === 'select'}
                    />
                  )}
                </form.AppField>
              ) : null}

              <form.AppField name="mother_tongue_code">
                {(field) => (
                  <field.SearchSelectField
                    label={t('community.mother_tongue_label')}
                    list="languages"
                    required
                  />
                )}
              </form.AppField>
              <form.AppField name="language_codes">
                {(field) => (
                  <field.MultiSelectField
                    label={t('community.languages_label')}
                    options={languages.filter(
                      (option) => option.code !== values.mother_tongue_code,
                    )}
                    max={6}
                  />
                )}
              </form.AppField>
            </>
          )
        }}
      </form.Subscribe>
    </FormShell>
  )
}
