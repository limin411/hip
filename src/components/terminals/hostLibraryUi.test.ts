import { beforeEach, describe, expect, it } from 'vitest'
import { useHostLibraryUi } from './hostLibraryUi'

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
