import { createLink, type LinkComponent } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

/** A link inside a sentence: the gold underline without the 48 tall box of `TextLink`. */
export const inlineLinkClass = 'link-gold font-semibold text-foreground hover:text-primary'

function TextAnchor({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot="text-link"
      className={cn(buttonVariants({ variant: 'link' }), className)}
      {...props}
    />
  )
}

const TextLinkRoute = createLink(TextAnchor)

/**
 * A link that stands on its own ("See all", "Read the safety tips"): 17 / 600 with the gold
 * underline and a 48 tall hit area (DESIGN.md 6.2). For a button that looks the same, use
 * `<Button variant="link">`.
 */
export const TextLink: LinkComponent<typeof TextAnchor> = (props) => <TextLinkRoute {...props} />
