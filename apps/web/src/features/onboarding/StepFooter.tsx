import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { useFormControls } from '~/features/profile-sections/form-shell'
import { isApiError } from '~/lib/api'
import { previousStep } from './steps'
import { useStepFlow } from './useStepFlow'

/**
 * The controls under the primary button of a step (07 section 2.6): "Skip for now" on
 * skippable steps (with "Save what you entered?" when the form has input, 07 2.5), then "Back"
 * (hidden on ONB-01). Rendered inside the step's form, so it reads the form's state.
 */
export function StepFooter({
  skippable = false,
  skipNote,
  extra,
}: {
  skippable?: boolean
  /** A line shown with the skip control (ONB-10, 07 section 13.6). */
  skipNote?: string
  /** A step-specific control in place of "Skip for now" (ONB-08's "Add photos later"). */
  extra?: ReactNode
}) {
  const { t } = useTranslation('onboarding')
  const flow = useStepFlow()
  const controls = useFormControls()
  const online = useOnlineStatus()
  const [askSave, setAskSave] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const busy = controls.isSubmitting || skipping
  const showSkip = skippable && !flow.edit
  const showBack = flow.edit || previousStep(flow.step) != null

  const skipWithoutSaving = async () => {
    setAskSave(false)
    setSkipping(true)
    try {
      await flow.skip()
    } catch (error) {
      if (!isApiError(error) || error.code !== 'validation_failed') toast.error(t('failed'))
    } finally {
      setSkipping(false)
    }
  }

  return (
    <>
      {showSkip ? (
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="secondary"
            className="w-full md:w-auto md:self-start"
            disabled={busy || !online}
            loading={skipping}
            onClick={() => {
              if (controls.isDirty) setAskSave(true)
              else void skipWithoutSaving()
            }}
          >
            {t('actions.skip')}
          </Button>
          {skipNote ? <p className="text-sm text-muted-foreground">{skipNote}</p> : null}
        </div>
      ) : null}
      {extra}
      {showBack ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full md:w-auto md:self-start"
          disabled={busy}
          onClick={() => flow.back()}
        >
          {t('actions.back')}
        </Button>
      ) : null}

      <Dialog open={askSave} onOpenChange={setAskSave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('skip_dialog.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('skip_dialog.title')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => void skipWithoutSaving()}>
              {t('skip_dialog.skip')}
            </Button>
            <Button
              type="button"
              disabled={!online}
              onClick={() => {
                setAskSave(false)
                void controls.submit()
              }}
            >
              {t('skip_dialog.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
