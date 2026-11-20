import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '~/mocks/server'
import {
  ImageError,
  MAX_PICKED_BYTES,
  MAX_UPLOAD_BYTES,
  prepareImage,
  targetSize,
  UploadError,
  uploadWithProgress,
} from './image'

type DrawCall = { width: number; height: number }

/** Fakes the browser's decoder and canvas: `createImageBitmap` gives a bitmap of `size`. */
function fakeImagePipeline({
  width,
  height,
  outputBytes = 500_000,
  decodeFails = false,
  noContext = false,
}: {
  width: number
  height: number
  outputBytes?: number | null
  decodeFails?: boolean
  noContext?: boolean
}) {
  const close = vi.fn()
  const decode = vi.fn(async () => {
    if (decodeFails) throw new Error('cannot decode')
    return { width, height, close } as unknown as ImageBitmap
  })
  vi.stubGlobal('createImageBitmap', decode)

  const draws: DrawCall[] = []
  const fills: string[] = []
  const context = {
    fillStyle: '',
    fillRect: vi.fn(function (this: { fillStyle: string }) {
      fills.push(this.fillStyle)
    }),
    drawImage: vi.fn((_image: unknown, _x: number, _y: number, w: number, h: number) => {
      draws.push({ width: w, height: h })
    }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => (noContext ? null : context) as never,
  )
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
    quality,
  ) {
    expect(type).toBe('image/jpeg')
    expect(quality).toBe(0.9)
    callback(outputBytes === null ? null : new Blob([new Uint8Array(outputBytes)], { type }))
  })
  return { decode, draws, fills, toBlob, close }
}

function file(type: string, bytes = 1000) {
  return new File([new Uint8Array(bytes)], 'photo', { type })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('targetSize', () => {
  it('keeps images whose long side is at most 2,048 pixels', () => {
    expect(targetSize(2048, 1536)).toEqual({ width: 2048, height: 1536 })
    expect(targetSize(400, 400)).toEqual({ width: 400, height: 400 })
  })

  it('scales the long side to 2,048 and keeps the aspect ratio', () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 2048, height: 1536 })
    expect(targetSize(3000, 6000)).toEqual({ width: 1024, height: 2048 })
  })

  it('accepts another long side (selfies use 1,600)', () => {
    expect(targetSize(1920, 1080, 1600)).toEqual({ width: 1600, height: 900 })
  })
})

describe('prepareImage', () => {
  it('rejects types other than JPEG, PNG and WebP before decoding', async () => {
    const pipeline = fakeImagePipeline({ width: 1000, height: 1000 })
    await expect(prepareImage(file('image/heic'))).rejects.toMatchObject({
      code: 'unsupported_type',
    })
    await expect(prepareImage(file('image/gif'))).rejects.toBeInstanceOf(ImageError)
    expect(pipeline.decode).not.toHaveBeenCalled()
  })

  it('rejects a picked file over 30 MB', async () => {
    fakeImagePipeline({ width: 1000, height: 1000 })
    const big = { type: 'image/jpeg', size: MAX_PICKED_BYTES + 1 } as Blob
    await expect(prepareImage(big)).rejects.toMatchObject({ code: 'too_large', phase: 'picked' })
  })

  it('decodes with the EXIF orientation applied', async () => {
    const pipeline = fakeImagePipeline({ width: 800, height: 600 })
    await prepareImage(file('image/png'))
    expect(pipeline.decode).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: 'from-image',
    })
    expect(pipeline.close).toHaveBeenCalled()
  })

  it('rejects images under 400 by 400 pixels', async () => {
    fakeImagePipeline({ width: 399, height: 1200 })
    await expect(prepareImage(file('image/jpeg'))).rejects.toMatchObject({ code: 'too_small' })
    fakeImagePipeline({ width: 1200, height: 300 })
    await expect(prepareImage(file('image/jpeg'))).rejects.toMatchObject({ code: 'too_small' })
  })

  it('accepts exactly 400 by 400 pixels', async () => {
    fakeImagePipeline({ width: 400, height: 400 })
    await expect(prepareImage(file('image/jpeg'))).resolves.toMatchObject({
      width: 400,
      height: 400,
    })
  })

  it('scales a large photo to 2,048 on the long side and re-encodes it as JPEG 90', async () => {
    const pipeline = fakeImagePipeline({ width: 4000, height: 3000, outputBytes: 900_000 })
    const result = await prepareImage(file('image/webp'))
    expect(result.width).toBe(2048)
    expect(result.height).toBe(1536)
    expect(result.blob.type).toBe('image/jpeg')
    expect(result.blob.size).toBe(900_000)
    expect(pipeline.draws).toEqual([{ width: 2048, height: 1536 }])
    // Transparent PNG pixels become white, not black.
    expect(pipeline.fills).toEqual(['#ffffff'])
  })

  it('never enlarges a small photo but still re-encodes it', async () => {
    const pipeline = fakeImagePipeline({ width: 900, height: 1200 })
    const result = await prepareImage(file('image/png'))
    expect(result).toMatchObject({ width: 900, height: 1200 })
    expect(pipeline.toBlob).toHaveBeenCalledTimes(1)
  })

  it('rejects a prepared file that is still over 10 MB', async () => {
    fakeImagePipeline({ width: 2000, height: 2000, outputBytes: MAX_UPLOAD_BYTES + 1 })
    await expect(prepareImage(file('image/jpeg'))).rejects.toMatchObject({
      code: 'too_large',
      phase: 'prepared',
    })
  })

  it('accepts a prepared file of exactly 10 MB', async () => {
    fakeImagePipeline({ width: 2000, height: 2000, outputBytes: MAX_UPLOAD_BYTES })
    await expect(prepareImage(file('image/jpeg'))).resolves.toBeTruthy()
  })

  it('reports a file the browser cannot decode', async () => {
    fakeImagePipeline({ width: 0, height: 0, decodeFails: true })
    await expect(prepareImage(file('image/jpeg'))).rejects.toMatchObject({
      code: 'decode_failed',
    })
  })

  it('falls back to the original file when encoding fails and it is small enough', async () => {
    fakeImagePipeline({ width: 1000, height: 800, outputBytes: null })
    const original = file('image/png', 5000)
    const result = await prepareImage(original)
    expect(result.blob).toBe(original)
    expect(result).toMatchObject({ width: 1000, height: 800 })
  })

  it('falls back to the original file when the canvas has no 2D context', async () => {
    fakeImagePipeline({ width: 1000, height: 800, noContext: true })
    const original = file('image/jpeg', 2000)
    await expect(prepareImage(original)).resolves.toMatchObject({ blob: original })
  })

  it('uses the options for selfies: 1,600 pixels and no minimum', async () => {
    const pipeline = fakeImagePipeline({ width: 3200, height: 1800 })
    const result = await prepareImage(file('image/jpeg'), { maxLongSide: 1600, minSide: 0 })
    expect(result).toMatchObject({ width: 1600, height: 900 })
    expect(pipeline.draws).toEqual([{ width: 1600, height: 900 }])
    fakeImagePipeline({ width: 320, height: 240 })
    await expect(prepareImage(file('image/jpeg'), { minSide: 0 })).resolves.toBeTruthy()
  })
})

describe('uploadWithProgress', () => {
  const url = 'https://r2.mock.local/uploads/test-key'
  let received: { contentType: string | null; authorization: string | null; size: number }[]

  beforeEach(() => {
    received = []
    server.use(
      http.put(url, async ({ request }) => {
        const body = await request.arrayBuffer()
        received.push({
          contentType: request.headers.get('content-type'),
          authorization: request.headers.get('authorization'),
          size: body.byteLength,
        })
        return new HttpResponse(null, { status: 200 })
      }),
    )
  })

  it('sends the blob with exactly the given headers and reports completion', async () => {
    const progress: number[] = []
    const blob = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' })
    await uploadWithProgress(url, blob, { 'Content-Type': 'image/jpeg' }, (value) =>
      progress.push(value),
    )
    expect(received).toEqual([{ contentType: 'image/jpeg', authorization: null, size: 2048 }])
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
  })

  it('rejects with the HTTP status when storage refuses the upload', async () => {
    server.use(http.put(url, () => new HttpResponse(null, { status: 403 })))
    const error = await uploadWithProgress(url, new Blob(['x']), {}).catch((caught) => caught)
    expect(error).toBeInstanceOf(UploadError)
    expect(error).toMatchObject({ kind: 'http', status: 403 })
  })

  it('rejects with a network error when the request fails', async () => {
    server.use(http.put(url, () => HttpResponse.error()))
    await expect(uploadWithProgress(url, new Blob(['x']), {})).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      uploadWithProgress(url, new Blob(['x']), {}, undefined, controller.signal),
    ).rejects.toMatchObject({ kind: 'aborted' })
    expect(received).toHaveLength(0)
  })
})
