import { MemberPhoto, type MemberPhotoSize } from '~/components/common/MemberPhoto'
import type { Gender, PhotoView } from '~/lib/api-types'

/**
 * A photo as staff see it: always the unblurred variant (18 section 4.1). `MemberPhoto` takes
 * a `PhotoView`, so the single URL the admin routes give is used for every size.
 */
function toPhotoView(id: string, isPrimary: boolean, url: string): PhotoView {
  return {
    id,
    is_primary: isPrimary,
    is_blurred: false,
    thumb_url: url,
    medium_url: url,
    large_url: url,
  }
}

export function AdminPhoto({
  photoId,
  url,
  isPrimary = false,
  name,
  gender,
  size,
  width,
  height,
  className,
}: {
  photoId: string
  /** null when the profile has no photo. */
  url: string | null
  isPrimary?: boolean
  /** For the alt text. */
  name: string
  gender: Gender | null
  size: MemberPhotoSize
  width: number
  height: number
  className?: string
}) {
  return (
    <MemberPhoto
      photo={url ? toPhotoView(photoId, isPrimary, url) : null}
      name={name}
      gender={gender ?? 'male'}
      size={size}
      width={width}
      height={height}
      className={className}
    />
  )
}
