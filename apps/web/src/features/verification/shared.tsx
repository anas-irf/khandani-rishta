import { Link } from '@tanstack/react-router'
import { CircleX, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArchIcon } from '~/components/common/Arch'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { type ApiError, isApiError } from '~/lib/api'
import type { ImageError } from '~/lib/image'
import { cn } from '~/lib/utils'

/** A centred block for one step of a verification flow. */
export function StepPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'tonal flex flex-col items-center gap-4 rounded-xl px-[20px] py-8 text-center',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A closed profile can view the verification state but not submit (03 section 5, 16 6.21). */
export function ClosedNotice() {
  const { t } = useTranslation('verification')
  return (
    <StepPanel>
      <ArchIcon icon={CircleX} size="lg" tone="tonal" />
      <p>{t('centre.closed')}</p>
      <Button asChild variant="secondary">
        <Link to="/settings/account">{t('centre.closed_action')}</Link>
      </Button>
    </StepPanel>
  )
}

/** What went wrong, or changed, in a step: read out at once, with an icon beside the words. */
export function FlowAlert({
  tone = 'danger',
  children,
}: {
  tone?: 'warning' | 'danger'
  children: ReactNode
}) {
  return (
    <Alert variant={tone} role="alert" className="text-start">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription className="text-body-md">
        <span>{children}</span>
      </AlertDescription>
    </Alert>
  )
}

/** The message key of the `verification` namespace for a photo that cannot be used. */
export function imageErrorKey(error: ImageError): string {
  if (error.code === 'unsupported_type') return 'errors.unsupported_type'
  if (error.code === 'too_large') return 'errors.too_large'
  return 'errors.unreadable'
}

/** `validation_failed` on `gesture` with code `mismatch` (16 section 6.22). */
export function isGestureMismatch(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.code === 'validation_failed' &&
    error.fields.some((field) => field.field === 'gesture' && field.code === 'mismatch')
  )
}

/** The failing field of a `validation_failed` answer, when it is one of `fields`. */
export function failingField(error: ApiError, fields: readonly string[]): string | null {
  return error.fields.find((field) => fields.includes(field.field))?.field ?? null
}
