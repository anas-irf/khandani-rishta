// ADM-SETTINGS: the `app_settings` editor (18 section 7.1).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Switch } from '~/components/ui/switch'
import { formatDate } from '~/lib/format'
import { RequireAdmin } from './access'
import { TableSkeleton } from './components/DataTable'
import { FormField } from './components/FormField'
import { serverFieldErrors } from './forms'
import { useAdminSettings, useSaveSetting } from './queries'
import {
  SETTING_GROUPS,
  SETTING_RULES,
  type SettingRule,
  sameValue,
  settingGroup,
  settingWarning,
  validateSetting,
} from './settings-spec'
import type { AdminSetting } from './types'

export function SettingsScreen() {
  return (
    <RequireAdmin>
      <SettingsEditor />
    </RequireAdmin>
  )
}

function SettingsEditor() {
  const { t } = useTranslation('admin')
  const query = useAdminSettings()

  if (query.isPending) return <TableSkeleton rows={8} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const settings = query.data
  const saved = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]))
  const groups = SETTING_GROUPS.map((group) => ({
    group,
    items: settings.filter((setting) => settingGroup(setting.key) === group),
  })).filter((entry) => entry.items.length > 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      {groups.map(({ group, items }) => (
        <section
          key={group}
          aria-labelledby={`settings-${group}`}
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
        >
          <h2 id={`settings-${group}`} className="text-lg font-semibold">
            {t(`settings.group.${group}`)}
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {items.map((setting) => (
              <li key={`${setting.key}-${JSON.stringify(setting.value)}`} className="py-3">
                <SettingRow setting={setting} saved={saved} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

type Draft = string | boolean | { text_en: string; text_ur: string; url: string }

function toDraft(rule: SettingRule | undefined, value: unknown): Draft {
  switch (rule?.kind) {
    case 'bool':
      return value === true
    case 'banner': {
      const banner = (value ?? {}) as { text_en?: string; text_ur?: string; url?: string }
      return { text_en: banner.text_en ?? '', text_ur: banner.text_ur ?? '', url: banner.url ?? '' }
    }
    default:
      return value === null || value === undefined ? '' : String(value)
  }
}

function fromDraft(rule: SettingRule | undefined, draft: Draft): unknown {
  switch (rule?.kind) {
    case 'int':
      return typeof draft === 'string' && draft.trim() !== '' ? Number(draft) : Number.NaN
    case 'bool':
      return draft === true
    case 'banner': {
      const banner = draft as { text_en: string; text_ur: string; url: string }
      return {
        text_en: banner.text_en.trim(),
        ...(banner.text_ur.trim() ? { text_ur: banner.text_ur.trim() } : {}),
        ...(banner.url.trim() ? { url: banner.url.trim() } : {}),
      }
    }
    case 'email':
      return typeof draft === 'string' ? draft.trim() : draft
    default:
      return draft
  }
}

function display(value: unknown): string {
  if (value === null) return 'null'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function SettingRow({ setting, saved }: { setting: AdminSetting; saved: Record<string, unknown> }) {
  const { t } = useTranslation('admin')
  const save = useSaveSetting()
  const rule = SETTING_RULES[setting.key]
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule, setting.value))
  const [error, setError] = useState<string>()
  const [confirm, setConfirm] = useState<{ value: unknown; warning: string } | null>(null)

  const next = fromDraft(rule, draft)
  const changed = !sameValue(next, setting.value)
  const isDefault = sameValue(setting.value, setting.default)

  const write = async (value: unknown): Promise<void> => {
    try {
      await save.mutateAsync({ key: setting.key, value })
      toast.success(t('settings.saved', { key: setting.key }))
    } catch (failure) {
      const mapped = serverFieldErrors(failure, ['value'])
      setError(mapped.fields.value ?? mapped.rest[0])
    }
  }

  const attempt = (value: unknown) => {
    const problem = validateSetting(setting.key, value, saved)
    if (problem) {
      setError(
        t(`validation.${problem.code}`, {
          min: problem.min,
          max: problem.max,
          defaultValue: problem.code,
        }),
      )
      return
    }
    setError(undefined)
    const warning = settingWarning(setting.key, value)
    if (warning) setConfirm({ value, warning })
    else void write(value)
  }

  const reset = () => {
    setDraft(toDraft(rule, setting.default))
    attempt(setting.default)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm font-semibold">{setting.key}</p>
        <p className="text-sm">{t(`settings.meaning.${setting.key}`, { defaultValue: '' })}</p>
        <p className="text-sm text-muted-foreground">
          {t('settings.default', { value: display(setting.default) })}
        </p>
        {setting.updated_at ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.updated', {
              email: setting.updated_by_email ?? t('common.none'),
              date: formatDate(setting.updated_at),
            })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <SettingInput
          rule={rule}
          settingKey={setting.key}
          draft={draft}
          error={error}
          onChange={(value) => {
            setDraft(value)
            setError(undefined)
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            loading={save.isPending}
            disabled={!changed}
            onClick={() => attempt(next)}
            aria-label={t('settings.save_named', { key: setting.key })}
          >
            {t('actions.save')}
          </Button>
          <Button
            variant="secondary"
            disabled={isDefault && !changed}
            onClick={reset}
            aria-label={t('settings.reset_named', { key: setting.key })}
          >
            {t('settings.reset')}
          </Button>
        </div>
      </div>
      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t('settings.warning_title', { key: setting.key })}
          description={t(`settings.warning.${confirm.warning}`)}
          confirmLabel={t('settings.confirm_save')}
          onConfirm={() => write(confirm.value)}
        />
      ) : null}
    </div>
  )
}

function SettingInput({
  rule,
  settingKey,
  draft,
  error,
  onChange,
}: {
  rule: SettingRule | undefined
  settingKey: string
  draft: Draft
  error?: string
  onChange: (draft: Draft) => void
}) {
  const { t } = useTranslation('admin')
  switch (rule?.kind) {
    case 'bool':
      return (
        <label
          htmlFor={`${settingKey}-switch`}
          className="flex min-h-11 items-center gap-3 text-sm"
        >
          <Switch
            id={`${settingKey}-switch`}
            checked={draft === true}
            onCheckedChange={(checked) => onChange(checked)}
            aria-label={settingKey}
          />
          {draft === true ? t('settings.on') : t('settings.off')}
        </label>
      )
    case 'moderation':
      return (
        <FormField label={settingKey} hideLabel error={error}>
          {(props) => (
            <NativeSelect
              {...props}
              value={String(draft)}
              onChange={(event) => onChange(event.target.value)}
            >
              <NativeSelectOption value="auto">{t('settings.auto')}</NativeSelectOption>
              <NativeSelectOption value="manual">{t('settings.manual')}</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
      )
    case 'banner': {
      const banner = draft as { text_en: string; text_ur: string; url: string }
      const set = (patch: Partial<typeof banner>) => onChange({ ...banner, ...patch })
      return (
        <div className="grid gap-2">
          <FormField label={t('settings.banner.text_en')} error={error}>
            {(props) => (
              <Input
                {...props}
                value={banner.text_en}
                onChange={(event) => set({ text_en: event.target.value })}
              />
            )}
          </FormField>
          <FormField label={t('settings.banner.text_ur')}>
            {(props) => (
              <Input
                {...props}
                dir="rtl"
                value={banner.text_ur}
                onChange={(event) => set({ text_ur: event.target.value })}
              />
            )}
          </FormField>
          <FormField label={t('settings.banner.url')} hint={t('settings.banner.url_hint')}>
            {(props) => (
              <Input
                {...props}
                type="url"
                value={banner.url}
                onChange={(event) => set({ url: event.target.value })}
              />
            )}
          </FormField>
        </div>
      )
    }
    case 'date':
      return (
        <FormField label={settingKey} hideLabel error={error}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={String(draft)}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </FormField>
      )
    case 'email':
      return (
        <FormField label={settingKey} hideLabel error={error}>
          {(props) => (
            <Input
              {...props}
              type="email"
              value={String(draft)}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </FormField>
      )
    default:
      return (
        <FormField
          label={settingKey}
          hideLabel
          hint={
            rule?.kind === 'int' ? t('settings.range', { min: rule.min, max: rule.max }) : undefined
          }
          error={error}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={rule?.kind === 'int' ? rule.min : undefined}
              max={rule?.kind === 'int' ? rule.max : undefined}
              value={String(draft)}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </FormField>
      )
  }
}
