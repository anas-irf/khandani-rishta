import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BackArrow, useGoBack } from '~/components/common/PageHeader'
import { Button } from '~/components/ui/button'
import { useBarHeight } from '~/lib/media'

/** The back control of `APP-PROFILE`. */
export function ProfileBackButton({ className }: { className?: string }) {
  const { t } = useTranslation('shared')
  const goBack = useGoBack()
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={t('header.back')}
      onClick={goBack}
    >
      <BackArrow />
    </Button>
  )
}

/**
 * The phone top bar of `APP-PROFILE` (DESIGN.md 6.16): Back, the name, then Shortlist and More
 * as icon-and-label buttons. It is the only place a name is cut, because the full name is right
 * below. Without a profile (loading, errors) it is the back row at every width.
 */
export function ProfileTopBar({ name, children }: { name?: string; children?: ReactNode }) {
  const ref = useBarHeight('--screen-bar')
  return (
    <div
      ref={ref}
      data-slot="profile-top-bar"
      className="sticky top-0 z-20 border-b border-border bg-background wide:static wide:border-b-0"
    >
      <div className="flex min-h-[64px] items-center gap-1 px-1 py-1 wide:container-app">
        <ProfileBackButton className="wide:-ms-3" />
        <span aria-hidden="true" className="min-w-0 flex-1 truncate text-title-md font-bold">
          {name}
        </span>
        {/* 8 between neighbours (DESIGN.md 8.1). */}
        {children ? <div className="flex items-center gap-[8px]">{children}</div> : null}
      </div>
    </div>
  )
}
