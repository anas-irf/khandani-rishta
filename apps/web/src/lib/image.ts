/**
 * Client-side photo preparation and direct uploads (17 section 11, 08 sections 5.1 and 5.2).
 *
 * `prepareImage` checks a picked file, corrects its orientation, scales it so the long side is
 * at most 2,048 pixels (never enlarging) and re-encodes it as JPEG at quality 90, which also
 * drops embedded metadata such as the GPS location. `uploadWithProgress` sends the result to
 * a presigned URL with `XMLHttpRequest`, so a progress bar can follow the upload.
 */

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number]

/** Value for the `accept` attribute of a file input that picks a photo. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

/** Neither side of a profile photo may be under this many pixels (08 section 5.1). */
export const MIN_IMAGE_SIDE = 400
/** The long side of a prepared profile photo (08 section 5.1). */
export const MAX_LONG_SIDE = 2048
/** The long side of a prepared verification selfie (12 section 4.3). */
export const SELFIE_LONG_SIDE = 1600
/** Largest file sent to storage, after preparation (08 section 5.1, 12 section 5.2). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
/** Largest file accepted from the picker before preparation (08 section 5.1). */
export const MAX_PICKED_BYTES = 30 * 1024 * 1024
export const JPEG_QUALITY = 0.9

export type ImageErrorCode = 'unsupported_type' | 'too_small' | 'too_large' | 'decode_failed'

/**
 * A file that cannot be used. For `too_large`, `phase` tells whether the picked file was over
 * 30 MB (`picked`) or the prepared file is still over 10 MB (`prepared`): 08 section 5.1 has a
 * different message for each.
 */
export class ImageError extends Error {
  readonly code: ImageErrorCode
  readonly phase: 'picked' | 'prepared' | null

  constructor(code: ImageErrorCode, phase: 'picked' | 'prepared' | null = null) {
    super(`Image rejected: ${code}`)
    this.name = 'ImageError'
    this.code = code
    this.phase = phase
  }
}

export function isImageError(error: unknown): error is ImageError {
  return error instanceof ImageError
}

export type PreparedImage = { blob: Blob; width: number; height: number }

export type PrepareOptions = {
  /** Long side after scaling (default 2,048). */
  maxLongSide?: number
  /** Minimum width and height in pixels (default 400); 0 switches the check off. */
  minSide?: number
}

/**
 * The size an image is drawn at: the long side scaled down to `maxLongSide` when it is
 * larger, keeping the aspect ratio; never enlarged.
 */
export function targetSize(
  width: number,
  height: number,
  maxLongSide: number = MAX_LONG_SIDE,
): { width: number; height: number } {
  const longSide = Math.max(width, height)
  if (longSide <= maxLongSide) return { width, height }
  const scale = maxLongSide / longSide
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function isAcceptedImageType(type: string): type is AcceptedImageType {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Checks and prepares a photo before upload (08 section 5.1, 17 section 11).
 *
 * Throws `ImageError` with `unsupported_type` (not JPEG, PNG or WebP), `too_large` (over
 * 30 MB as picked, or over 10 MB once prepared), `decode_failed` (the browser cannot read
 * it) or `too_small` (a side under `minSide`). When drawing or encoding fails on the device,
 * the original file is used if it passes the checks (08 section 5.1).
 */
export async function prepareImage(
  file: Blob,
  options: PrepareOptions = {},
): Promise<PreparedImage> {
  const maxLongSide = options.maxLongSide ?? MAX_LONG_SIDE
  const minSide = options.minSide ?? MIN_IMAGE_SIDE

  if (!isAcceptedImageType(file.type)) throw new ImageError('unsupported_type')
  if (file.size > MAX_PICKED_BYTES) throw new ImageError('too_large', 'picked')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageError('decode_failed')
  }

  try {
    const { width: sourceWidth, height: sourceHeight } = bitmap
    if (minSide > 0 && (sourceWidth < minSide || sourceHeight < minSide)) {
      throw new ImageError('too_small')
    }
    const size = targetSize(sourceWidth, sourceHeight, maxLongSide)

    let blob: Blob | null = null
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (context) {
      // JPEG has no transparency: composite transparent pixels over white (08 section 5.3).
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, size.width, size.height)
      context.drawImage(bitmap, 0, 0, size.width, size.height)
      blob = await canvasToJpeg(canvas)
    }

    if (!blob) {
      // Preparation failed on the device: upload the original when it passes the checks.
      if (file.size > MAX_UPLOAD_BYTES) throw new ImageError('too_large', 'prepared')
      return { blob: file, width: sourceWidth, height: sourceHeight }
    }
    if (blob.size > MAX_UPLOAD_BYTES) throw new ImageError('too_large', 'prepared')
    return { blob, width: size.width, height: size.height }
  } finally {
    bitmap.close?.()
  }
}

// ---------------------------------------------------------------------------
// Upload to a presigned URL
// ---------------------------------------------------------------------------

export type UploadErrorKind = 'network' | 'http' | 'aborted'

/** A failed `PUT` to storage. `status` is the HTTP status for `http`, otherwise 0. */
export class UploadError extends Error {
  readonly kind: UploadErrorKind
  readonly status: number

  constructor(kind: UploadErrorKind, status = 0) {
    super(`Upload failed: ${kind}${status ? ` ${status}` : ''}`)
    this.name = 'UploadError'
    this.kind = kind
    this.status = status
  }
}

export function isUploadError(error: unknown): error is UploadError {
  return error instanceof UploadError
}

/**
 * `PUT url` with the blob as the body and exactly `headers` (08 section 5.2 step 4). No
 * `Authorization` header is sent: the URL carries its own signature. `onProgress` receives
 * a fraction from 0 to 1. Rejects with `UploadError` (`aborted` when `signal` fires).
 */
export function uploadWithProgress(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError('aborted'))
      return
    }
    const request = new XMLHttpRequest()
    const onAbort = () => request.abort()
    const cleanUp = () => signal?.removeEventListener('abort', onAbort)

    request.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value)

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
    }
    request.onload = () => {
      cleanUp()
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1)
        resolve()
      } else {
        reject(new UploadError('http', request.status))
      }
    }
    request.onerror = () => {
      cleanUp()
      reject(new UploadError('network'))
    }
    request.ontimeout = request.onerror
    request.onabort = () => {
      cleanUp()
      reject(new UploadError('aborted'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    onProgress?.(0)
    request.send(blob)
  })
}
