import { beforeEach, describe, expect, it } from 'vitest'
import { useHostLibraryUi } from './hostLibraryUi'

describe('hostLibraryUi one-shot create signal', () => {
  beforeEach(() => {
    useHostLibraryUi.setState({
      pendingCreateHost: false,
      quickConnectOpenTick: 0,
    })
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

describe('hostLibraryUi quick connect signal', () => {
  beforeEach(() => {
    useHostLibraryUi.setState({
      pendingCreateHost: false,
      quickConnectOpenTick: 0,
    })
  })

  it('requestOpenQuickConnect bumps tick', () => {
    expect(useHostLibraryUi.getState().quickConnectOpenTick).toBe(0)
    useHostLibraryUi.getState().requestOpenQuickConnect()
    expect(useHostLibraryUi.getState().quickConnectOpenTick).toBe(1)
    useHostLibraryUi.getState().requestOpenQuickConnect()
    expect(useHostLibraryUi.getState().quickConnectOpenTick).toBe(2)
  })
})
