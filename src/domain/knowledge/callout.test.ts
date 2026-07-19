import { describe, expect, it } from 'vitest'
import { parseCalloutHeader } from './callout'

describe('parseCalloutHeader', () => {
  it('parses type and title', () => {
    expect(parseCalloutHeader('[!note] Hello')).toEqual({
      type: 'note',
      title: 'Hello',
    })
  })

  it('parses type only', () => {
    expect(parseCalloutHeader('[!WARNING]')).toEqual({
      type: 'warning',
      title: null,
    })
  })

  it('rejects unknown types', () => {
    expect(parseCalloutHeader('[!banana]')).toBeNull()
  })
})
