import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '~/test/render'
import { NotFound } from './NotFound'

describe('NotFound', () => {
  it('explains that the page does not exist and links home', async () => {
    renderWithRouter(() => <NotFound />)

    expect(
      await screen.findByText('The page you are looking for does not exist.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
  })

  it('shows custom content instead of the default message', async () => {
    renderWithRouter(() => <NotFound>This profile is no longer available.</NotFound>)

    expect(await screen.findByText('This profile is no longer available.')).toBeInTheDocument()
    expect(
      screen.queryByText('The page you are looking for does not exist.'),
    ).not.toBeInTheDocument()
  })
})
