import type * as React from 'react'
import { cn } from '~/lib/utils'

/** A flat sand panel: no border and no shadow (DESIGN.md 5.3). */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('band-sand flex flex-col gap-4 rounded-card py-6 text-foreground', className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-[20px] has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] sm:px-6',
        className,
      )}
      {...props}
    />
  )
}

type CardTitleProps = React.ComponentProps<'h3'> & {
  /** Heading level to render. Pick the one that fits the page outline. */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
}

function CardTitle({ as: Heading = 'h3', className, ...props }: CardTitleProps) {
  return <Heading data-slot="card-title" className={cn('text-title-lg', className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-body-sm text-foreground-secondary', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-[20px] sm:px-6', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex flex-wrap items-center gap-3 px-[20px] sm:px-6', className)}
      {...props}
    />
  )
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
