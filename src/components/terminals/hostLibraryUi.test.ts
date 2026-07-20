import { describe, it, expect, beforeEach } from 'vitest'
import { useHostLibraryUi } from './hostLibraryUi'

describe('hostLibraryUi one-shot create signal', () => {
  beforeEach(() => {
    useHostLibraryUi.setState({ pendingCreateHost: false })
  })

  it('requestCreateHost sets pending; consume clears and returns true once', () => {
    expect(useHostLibraryUi.getState().pendingCreateHost).toBe(false)
    useHostLibraryUi.getState().requestCreateHost()
    expect(useHostLibraryUi.getState().pendingCreateHost).toBe(true)

    expect(useHostLibraryUi.getState().consumeCreateHostRequest()).toBe(true)
    expect(useHostLibraryUi.getState().pendingCreateHost).toBe(false)
    expect(useHostLibraryUi.getState().consumeCreateHostRequest()).toBe(false)
  })
})
