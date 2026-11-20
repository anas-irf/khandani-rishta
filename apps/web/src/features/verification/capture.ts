/**
 * How the selfie is captured on the web (12 section 4.3, 17 section 11): a phone opens its
 * front camera through `<input type="file" accept="image/*" capture="user">`; a desktop shows
 * a live `getUserMedia` preview with a capture button. Neither offers a gallery picker.
 */
export type CaptureMode = 'phone' | 'desktop'

export function detectCaptureMode(): CaptureMode {
  if (typeof navigator === 'undefined') return 'desktop'
  const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData
  if (userAgentData?.mobile) return 'phone'
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return 'phone'
  // iPadOS reports a desktop user agent but has touch and a coarse pointer.
  const coarse =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  return coarse && navigator.maxTouchPoints > 1 ? 'phone' : 'desktop'
}

/** The reason a live camera cannot be used: refused by the member, or not there at all. */
export type CameraProblem = 'denied' | 'unavailable'

export function cameraProblemOf(error: unknown): CameraProblem {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : ''
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable'
}

/** Grabs the current video frame as a JPEG (quality 90). */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return Promise.resolve(null)
  context.drawImage(video, 0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9))
}
