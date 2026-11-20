// ADM-RELEASES: Android release records (18 section 7.2).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { EmptyState } from '~/components/common/EmptyState'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { RelativeTime } from '~/components/common/RelativeTime'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { RequireAdmin } from './access'
import { type Column, DataTable, TableSkeleton } from './components/DataTable'
import { CountedTextarea, FormField } from './components/FormField'
import { ErrorSummary, useDialogErrors } from './components/useDialogErrors'
import { validate } from './forms'
import { useAdminReleases, useCreateRelease } from './queries'
import { releaseSchema } from './schemas'
import type { AdminRelease, CreateReleaseBody } from './types'

export function ReleasesScreen() {
  return (
    <RequireAdmin>
      <Releases />
    </RequireAdmin>
  )
}

function Releases() {
  const { t } = useTranslation('admin')
  const query = useAdminReleases()
  const releases = query.data ?? []
  // Newest first: the first row holds the highest version code and the current minimum.
  const latestCode = releases.reduce((max, release) => Math.max(max, release.version_code), 0)
  const currentMin = releases.reduce(
    (max, release) => Math.max(max, release.min_supported_version_code),
    0,
  )

  const columns: Column<AdminRelease>[] = [
    { id: 'code', header: t('releases.col.version_code'), cell: (release) => release.version_code },
    { id: 'name', header: t('releases.col.version_name'), cell: (release) => release.version_name },
    {
      id: 'min',
      header: t('releases.col.min_supported'),
      cell: (release) => release.min_supported_version_code,
    },
    {
      id: 'url',
      header: t('releases.col.download'),
      cell: (release) => (
        <a
          href={release.download_url}
          rel="noopener noreferrer"
          className="break-all text-primary hover:underline"
        >
          {release.download_url}
        </a>
      ),
    },
    {
      id: 'notes',
      header: t('releases.col.notes'),
      cell: (release) => (
        <span className="line-clamp-2 max-w-xs" title={release.release_notes ?? undefined}>
          {release.release_notes ?? '-'}
        </span>
      ),
    },
    {
      id: 'created',
      header: t('releases.col.created'),
      cell: (release) => <RelativeTime value={release.released_at} />,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('releases.title')} description={t('releases.description')} />
      {query.isSuccess ? <ReleaseForm latestCode={latestCode} currentMin={currentMin} /> : null}
      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : releases.length === 0 ? (
        <EmptyState title={t('releases.empty')} />
      ) : (
        <DataTable
          caption={t('releases.caption')}
          columns={columns}
          rows={releases}
          getKey={(release) => release.id}
        />
      )}
    </div>
  )
}

const FIELDS = [
  'version_code',
  'version_name',
  'min_supported_version_code',
  'download_url',
  'release_notes',
] as const

function ReleaseForm({ latestCode, currentMin }: { latestCode: number; currentMin: number }) {
  const { t } = useTranslation('admin')
  const create = useCreateRelease()
  const [values, setValues] = useState({
    version_code: String(latestCode + 1),
    version_name: '',
    min_supported_version_code: String(currentMin || 1),
    download_url: 'https://download.',
    release_notes: '',
  })
  const [pending, setPending] = useState<CreateReleaseBody | null>(null)
  const form = useDialogErrors(FIELDS)
  const set = (key: keyof typeof values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }))

  const publish = async (body: CreateReleaseBody) => {
    try {
      await create.mutateAsync(body)
      toast.success(t('releases.published', { name: body.version_name }))
      setValues({
        version_code: String(body.version_code + 1),
        version_name: '',
        min_supported_version_code: String(body.min_supported_version_code),
        download_url: 'https://download.',
        release_notes: '',
      })
      form.clear()
    } catch (error) {
      form.fail(error)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const result = validate(
      releaseSchema,
      {
        ...values,
        version_code: values.version_code === '' ? undefined : Number(values.version_code),
        min_supported_version_code:
          values.min_supported_version_code === ''
            ? undefined
            : Number(values.min_supported_version_code),
      },
      t,
    )
    if (!result.ok) {
      form.setErrors(result.errors)
      return
    }
    const data = result.data
    const errors: Record<string, string> = {}
    if (data.version_code <= latestCode) {
      errors.version_code = t('validation.above_latest', { min: latestCode })
    }
    if (data.min_supported_version_code < currentMin) {
      errors.min_supported_version_code = t('validation.min_below_current', { min: currentMin })
    }
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors)
      return
    }
    form.clear()
    const body: CreateReleaseBody = {
      platform: 'android',
      version_code: data.version_code,
      version_name: data.version_name,
      min_supported_version_code: data.min_supported_version_code,
      download_url: data.download_url,
      ...(data.release_notes ? { release_notes: data.release_notes } : {}),
    }
    // Raising the minimum locks older builds out: ask first, naming how many version codes.
    if (body.min_supported_version_code > currentMin) setPending(body)
    else void publish(body)
  }

  const lockedOut = pending ? pending.min_supported_version_code - currentMin : 0

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="release-form-title"
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div>
        <h2 id="release-form-title" className="text-lg font-semibold">
          {t('releases.form_title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('releases.form_hint')}</p>
      </div>
      <ErrorSummary messages={form.rest} />
      <div className="grid grid-cols-3 gap-4">
        <FormField label={t('releases.version_code')} error={form.errors.version_code}>
          {(props) => (
            <Input
              {...props}
              name="version_code"
              type="number"
              inputMode="numeric"
              value={values.version_code}
              onChange={(event) => set('version_code', event.target.value)}
            />
          )}
        </FormField>
        <FormField
          label={t('releases.version_name')}
          hint={t('releases.version_name_hint')}
          error={form.errors.version_name}
        >
          {(props) => (
            <Input
              {...props}
              name="version_name"
              value={values.version_name}
              onChange={(event) => set('version_name', event.target.value)}
            />
          )}
        </FormField>
        <FormField
          label={t('releases.min_supported')}
          hint={t('releases.min_supported_hint', { min: currentMin })}
          error={form.errors.min_supported_version_code}
        >
          {(props) => (
            <Input
              {...props}
              name="min_supported_version_code"
              type="number"
              inputMode="numeric"
              value={values.min_supported_version_code}
              onChange={(event) => set('min_supported_version_code', event.target.value)}
            />
          )}
        </FormField>
      </div>
      <FormField
        label={t('releases.download_url')}
        hint={t('releases.download_url_hint')}
        error={form.errors.download_url}
      >
        {(props) => (
          <Input
            {...props}
            name="download_url"
            type="url"
            dir="ltr"
            value={values.download_url}
            onChange={(event) => set('download_url', event.target.value)}
          />
        )}
      </FormField>
      <CountedTextarea
        label={t('releases.notes')}
        hint={t('releases.notes_hint')}
        error={form.errors.release_notes}
        value={values.release_notes}
        onChange={(value) => set('release_notes', value)}
        max={1000}
        rows={3}
        name="release_notes"
      />
      <div>
        <Button type="submit" loading={create.isPending}>
          {t('releases.publish')}
        </Button>
      </div>
      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={t('releases.lockout_title')}
          description={t('releases.lockout_text', {
            count: lockedOut,
            from: currentMin,
            to: pending.min_supported_version_code - 1,
            min: pending.min_supported_version_code,
          })}
          confirmLabel={t('releases.publish')}
          destructive
          onConfirm={() => publish(pending)}
        />
      ) : null}
    </form>
  )
}
