import { avatarVariants } from '~/components/ui/avatar'
import { cn } from '~/lib/utils'
import { MemberPhoto, type MemberPhotoProps } from './MemberPhoto'

/** The arch sizes of DESIGN.md 5.2, width by height. */
const SIZES = {
  xs: [40, 50],
  sm: [46, 58],
  md: [56, 70],
  lg: [64, 80],
  xl: [96, 120],
} as const

/**
 * A member's small arch in a row or a bar (notifications, chats, a connection): the thumb with
 * the private treatment, or the monogram. Never a circle (DESIGN.md 4.1, 6.8).
 */
export function MemberAvatar({
  size = 'sm',
  className,
  ...props
}: Omit<MemberPhotoProps, 'size' | 'width' | 'height' | 'variant'> & {
  size?: keyof typeof SIZES
}) {
  const [width, height] = SIZES[size]
  return (
    <MemberPhoto
      size="thumb"
      width={width}
      height={height}
      className={cn(avatarVariants({ size }), className)}
      {...props}
    />
  )
}
