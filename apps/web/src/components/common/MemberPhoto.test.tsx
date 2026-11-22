import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makePhotoView } from '~/mocks/factories'
import { renderWithProviders } from '~/test/render'
import { MemberPhoto } from './MemberPhoto'

const photo = makePhotoView({
  thumb_url: 'https://r2.test/thumb.jpg',
  medium_url: 'https://r2.test/medium.jpg',
  large_url: 'https://r2.test/large.jpg',
})

describe('MemberPhoto', () => {
  it('uses the variant for its size, with explicit dimensions and lazy loading', async () => {
    renderWithProviders(() => (
      <MemberPhoto
        photo={photo}
        name="Ayesha K."
        gender="female"
        size="medium"
        width={400}
        height={500}
      />
    ))

    const image = await screen.findByRole('img', { name: 'Photo of Ayesha K.' })
    expect(image).toHaveAttribute('src', 'https://r2.test/medium.jpg')
    expect(image).toHaveAttribute('width', '400')
    expect(image).toHaveAttribute('height', '500')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('data-member-photo')
  })

  it('picks thumb_url for thumb and falls back to medium_url when there is no large variant', async () => {
    const blurred = makePhotoView({
      is_blurred: true,
      thumb_url: 'https://r2.test/blur-thumb.jpg',
      medium_url: 'https://r2.test/blur-medium.jpg',
      large_url: null,
    })
    renderWithProviders(() => (
      <>
        <MemberPhoto photo={photo} name="A" gender="male" size="thumb" width={72} height={72} />
        <MemberPhoto
          photo={blurred}
          name="B"
          gender="male"
          size="large"
          width={800}
          height={1000}
        />
      </>
    ))

    expect(await screen.findByRole('img', { name: 'Photo of A' })).toHaveAttribute(
      'src',
      'https://r2.test/thumb.jpg',
    )
    expect(screen.getByRole('img', { name: 'Photo of B' })).toHaveAttribute(
      'src',
      'https://r2.test/blur-medium.jpg',
    )
  })

  it('cannot be dragged and has no context menu', async () => {
    renderWithProviders(() => (
      <MemberPhoto
        photo={photo}
        name="Ayesha K."
        gender="female"
        size="medium"
        width={400}
        height={500}
      />
    ))

    const image = await screen.findByRole('img', { name: 'Photo of Ayesha K.' })
    expect(image).toHaveAttribute('draggable', 'false')
    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.contextMenu(image)).toBe(false)
    expect(fireEvent.dragStart(image)).toBe(false)
  })

  it('shows a blurred photo as received, with the lock and "Photo is private"', async () => {
    const blurred = makePhotoView({ is_blurred: true, medium_url: 'https://r2.test/blur.jpg' })
    renderWithProviders(() => (
      <MemberPhoto
        photo={blurred}
        name="Ayesha K."
        gender="female"
        size="medium"
        width={400}
        height={500}
      />
    ))

    const image = await screen.findByRole('img', { name: 'Photo of Ayesha K.' })
    expect(image).toHaveAttribute('src', 'https://r2.test/blur.jpg')
    expect(image.className).not.toMatch(/blur/)
    expect(image.getAttribute('style') ?? '').not.toMatch(/blur|filter/)
    expect(screen.getByText('Photo is private')).toBeVisible()
    // The Mehfil layers sit over the received image: the veil and the monogram, nothing on it.
    const veil = document.querySelector('[data-slot="photo-veil"]')
    expect(veil).toHaveTextContent('AK')
    // Without it the 58 px letters sit in a 26 px line, on the diamond and the pill.
    expect(veil?.querySelector('.font-display')).toHaveClass('leading-none')
    expect(veil?.className).not.toMatch(/blur/)
    expect(image).toHaveAttribute('data-member-photo')
  })

  it('shows a lock with the words for screen readers on a thumb', async () => {
    const blurred = makePhotoView({ is_blurred: true })
    renderWithProviders(() => (
      <MemberPhoto
        photo={blurred}
        name="Ayesha K."
        gender="female"
        size="thumb"
        width={60}
        height={76}
      />
    ))

    await screen.findByRole('img', { name: 'Photo of Ayesha K.' })
    expect(screen.getByText('Photo is private')).toHaveClass('sr-only')
    expect(document.querySelector('[data-slot="photo-veil"]')).toBeNull()
  })

  it('draws the monogram when there is no photo', async () => {
    renderWithProviders(() => (
      <>
        <MemberPhoto
          photo={null}
          name="Muhammad Abdul Rehman S."
          gender="male"
          size="thumb"
          width={72}
          height={72}
        />
        <MemberPhoto
          photo={null}
          name="Ayesha K."
          gender="female"
          size="thumb"
          width={72}
          height={72}
        />
      </>
    ))

    const placeholders = await screen.findAllByRole('img', { name: 'No photo added yet' })
    expect(placeholders.map((node) => node.textContent)).toEqual(['MS', 'AK'])
    expect(placeholders.map((node) => node.getAttribute('data-photo-state'))).toEqual([
      'none',
      'none',
    ])
    expect(screen.queryByRole('img', { name: /Photo of/ })).not.toBeInTheDocument()
  })

  it('draws a silhouette by gender when there is no name either', async () => {
    renderWithProviders(() => (
      <>
        <MemberPhoto photo={null} name={null} gender="male" size="thumb" width={60} height={76} />
        <MemberPhoto photo={null} name={null} gender="female" size="thumb" width={60} height={76} />
      </>
    ))

    const placeholders = await screen.findAllByRole('img', { name: 'No photo added yet' })
    expect(placeholders.map((node) => node.getAttribute('data-silhouette'))).toEqual([
      'male',
      'female',
    ])
  })

  it('never says "no photo" for a photo that did not load', async () => {
    renderWithProviders(() => (
      <MemberPhoto
        photo={photo}
        name="Ayesha K."
        gender="female"
        size="medium"
        width={400}
        height={500}
      />
    ))

    fireEvent.error(await screen.findByRole('img', { name: 'Photo of Ayesha K.' }))
    expect(screen.getByRole('img', { name: 'Photo of Ayesha K.' })).toHaveTextContent('AK')
    expect(screen.queryByText('No photo added yet')).not.toBeInTheDocument()
  })
})
