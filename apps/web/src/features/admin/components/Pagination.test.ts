import { describe, expect, it } from 'vitest'
import { pageLinks } from './Pagination'

/** The links as text: page numbers, and "…" for a gap. */
function shown(page: number, pageCount: number) {
  return pageLinks(page, pageCount).map((link) => (link.kind === 'gap' ? '…' : String(link.page)))
}

describe('pageLinks', () => {
  it('shows every page of a short list', () => {
    expect(shown(1, 1)).toEqual(['1'])
    expect(shown(2, 4)).toEqual(['1', '2', '3', '4'])
  })

  it('keeps the first, the last and the neighbours of the current page', () => {
    expect(shown(1, 10)).toEqual(['1', '2', '…', '10'])
    expect(shown(6, 10)).toEqual(['1', '…', '5', '6', '7', '…', '10'])
    expect(shown(10, 10)).toEqual(['1', '…', '9', '10'])
  })

  it('shows a single hidden page instead of an ellipsis', () => {
    expect(shown(4, 10)).toEqual(['1', '2', '3', '4', '5', '…', '10'])
    expect(shown(7, 10)).toEqual(['1', '…', '6', '7', '8', '9', '10'])
  })
})
