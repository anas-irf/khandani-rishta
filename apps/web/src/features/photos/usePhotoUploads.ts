import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '~/lib/api'
import { isAcceptedImageType, isImageError, MAX_PICKED_BYTES } from '~/lib/image'
import { MAX_PARALLEL_UPLOADS, type UploadStage, useUploadPhoto } from './queries'

/**
 * The upload slots of the photo grid (08 section 5.2): each picked file gets a slot that shows
 * the local image, waits while two uploads run ("Waiting..."), uploads with progress
 * ("Uploading..."), confirms ("Processing...") and then gives way to the confirmed photo in
 * the list. After three failed rounds the slot shows "Upload failed" with "Try again".
 */

export type UploadSlotState = 'waiting' | 'uploading' | 'confirming' | 'failed'

export type UploadSlot = {
  id: string
  file: File
  /** Object URL of the picked file, shown in the slot right away. */
  previewUrl: string | null
  state: UploadSlotState
  progress: number
}

/** A message for the member: an i18n key of the `photos` namespace and its values. */
export type UploadMessage = { key: string; values?: Record<string, unknown> }

/** The message of 08 sections 5.1 and 5.2 for a failure that retrying cannot fix, or null. */
export function uploadErrorMessage(error: unknown, photosMax: number): UploadMessage | null {
  if (isImageError(error)) {
    if (error.code === 'too_large') {
      return {
        key: error.phase === 'picked' ? 'errors.picked_too_large' : 'errors.prepared_too_large',
      }
    }
    return { key: `errors.${error.code}` }
  }
  if (isApiError(error)) {
    if (error.code === 'payload_too_large') return { key: 'errors.prepared_too_large' }
    if (error.code === 'limit_reached') return { key: 'errors.limit', values: { max: photosMax } }
    if (error.code === 'rate_limited') return { key: 'errors.rate_limited' }
  }
  return null
}

/** Checks that need no decoding, done when the files are picked (08 section 5.1). */
export function pickCheck(file: File): UploadMessage | null {
  if (!isAcceptedImageType(file.type)) return { key: 'errors.unsupported_type' }
  if (file.size > MAX_PICKED_BYTES) return { key: 'errors.picked_too_large' }
  return null
}

function objectUrl(file: File): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
  } catch {
    return null
  }
}

function revoke(url: string | null) {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

let slotCounter = 0

export function usePhotoUploads({
  photosMax,
  onMessage,
}: {
  photosMax: number
  /** Shows a message about a file that cannot be uploaded (a toast). */
  onMessage: (message: UploadMessage) => void
}) {
  const upload = useUploadPhoto()
  const [slots, setSlots] = useState<UploadSlot[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const started = useRef(new Set<string>())
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const mutateAsync = upload.mutateAsync

  const patch = useCallback((id: string, changes: Partial<UploadSlot>) => {
    setSlots((current) => current.map((slot) => (slot.id === id ? { ...slot, ...changes } : slot)))
  }, [])

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
    controllers.current.delete(id)
    started.current.delete(id)
    setSlots((current) => {
      const slot = current.find((entry) => entry.id === id)
      if (slot) revoke(slot.previewUrl)
      return current.filter((entry) => entry.id !== id)
    })
  }, [])

  const run = useCallback(
    (slot: UploadSlot) => {
      const controller = new AbortController()
      controllers.current.set(slot.id, controller)
      patch(slot.id, { state: 'uploading', progress: 0 })
      mutateAsync({
        file: slot.file,
        signal: controller.signal,
        onProgress: (fraction) => patch(slot.id, { progress: fraction }),
        onStage: (stage: UploadStage) => {
          if (stage === 'confirming') patch(slot.id, { state: 'confirming', progress: 1 })
        },
      }).then(
        // The confirmed photo is now in the cached list; the slot gives way to it.
        () => remove(slot.id),
        (error: unknown) => {
          if (controller.signal.aborted) return
          controllers.current.delete(slot.id)
          const message = uploadErrorMessage(error, photosMax)
          if (message) {
            onMessageRef.current(message)
            remove(slot.id)
            return
          }
          started.current.delete(slot.id)
          patch(slot.id, { state: 'failed', progress: 0 })
        },
      )
    },
    [mutateAsync, patch, remove, photosMax],
  )

  // Starts waiting slots while fewer than two uploads run (08 section 5.2 rule 1).
  useEffect(() => {
    let active = slots.filter(
      (slot) => started.current.has(slot.id) && slot.state !== 'failed',
    ).length
    for (const slot of slots) {
      if (active >= MAX_PARALLEL_UPLOADS) break
      if (slot.state !== 'waiting' || started.current.has(slot.id)) continue
      started.current.add(slot.id)
      active += 1
      run(slot)
    }
  }, [slots, run])

  // Leaving the screen keeps running uploads going (08 section 5.2 rule 5); only previews go.
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  useEffect(
    () => () => {
      for (const slot of slotsRef.current) revoke(slot.previewUrl)
    },
    [],
  )

  /** Adds picked files, at most `freeSlots` of them; returns how many were added. */
  const addFiles = useCallback(
    (files: readonly File[], freeSlots: number) => {
      const accepted: UploadSlot[] = []
      for (const file of files) {
        const problem = pickCheck(file)
        if (problem) {
          onMessageRef.current(problem)
          continue
        }
        if (accepted.length >= freeSlots) {
          onMessageRef.current({ key: 'errors.limit', values: { max: photosMax } })
          break
        }
        slotCounter += 1
        accepted.push({
          id: `upload-${slotCounter}`,
          file,
          previewUrl: objectUrl(file),
          state: 'waiting',
          progress: 0,
        })
      }
      if (accepted.length > 0) setSlots((current) => [...current, ...accepted])
      return accepted.length
    },
    [photosMax],
  )

  /** "Try again" on a failed slot: it starts again from a new upload URL. */
  const retry = useCallback((id: string) => patch(id, { state: 'waiting', progress: 0 }), [patch])

  return { slots, addFiles, cancel: remove, retry, dismiss: remove }
}
